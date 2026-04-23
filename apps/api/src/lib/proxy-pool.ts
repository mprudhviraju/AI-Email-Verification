/**
 * proxy-pool.ts
 *
 * F1: Manages a pool of SOCKS5 proxies for outbound SMTP connections.
 *
 * Each `assignProxy(providerKey)` call returns the most suitable proxy for a
 * given mail provider using consistent hashing (SHA-256 of the provider key,
 * mod pool size). This keeps the same domain/provider consistently on the same
 * proxy, which avoids "new sender" reputation penalties. If the primary proxy
 * is throttled or health-degraded, the call scans forward to the next healthy
 * proxy in rotation.
 *
 * Health state is tracked in Redis per proxy (keyed by a 12-char SHA-256
 * prefix of the full proxy URL):
 *   proxy:{id}:ok_hour       — ZSET: uuid → ms timestamp, sliding 1-hour window
 *   proxy:{id}:fail_hour     — ZSET: uuid → ms timestamp, sliding 1-hour window
 *   proxy:{id}:throttled_until — STRING: unix ms timestamp
 *   proxy:{id}:block_count   — INT: lifetime detected IP blocks
 *
 * Noop mode: when SMTP_PROXY_LIST is empty (default in dev), `isNoop` is true,
 * `assignProxy()` returns null, and every call to the pool is a no-op. The
 * SMTP layer treats null proxy as "use direct connection or source IP binding" —
 * behaviour identical to pre-Phase-F.
 *
 * Precedence in smtp-verifier.ts: proxy > source IP (SMTP_SOURCE_IPS) > OS default.
 */

import { createHash, randomUUID } from 'node:crypto';
import { redis } from './redis.js';
import { ipBlocksTotal } from './metrics.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProxyOutcome = 'ok' | 'fail' | 'block';

export interface ParsedProxy {
  host: string;
  port: number;
  type: 5;              // SOCKS5 only
  userId?: string;
  password?: string;
  /** SHA-256(url)[:12] — used as Redis key namespace and consistent hash input */
  id: string;
}

export interface ProxyStats {
  id: string;
  host: string;
  port: number;
  /** Unix ms timestamp if currently throttled, null otherwise */
  throttledUntil: number | null;
  /** Successful SMTP attempts in the last hour */
  okCount: number;
  /** Failed SMTP attempts in the last hour */
  failCount: number;
  /** okCount / (okCount + failCount), null if no data */
  successRate: number | null;
  /** Lifetime count of detected proxy-level blocks */
  blockCount: number;
  /** false when throttled OR successRate < 70% */
  isHealthy: boolean;
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parse a socks5://[user:pass@]host:port URL into a ParsedProxy.
 * Throws on invalid URLs so misconfiguration is caught at startup.
 */
export function parseProxyUrl(url: string): ParsedProxy {
  const u = new URL(url);
  if (!['socks5:', 'socks5h:'].includes(u.protocol)) {
    throw new Error(`proxy-pool: unsupported protocol "${u.protocol}" in "${url}" (expected socks5://)`);
  }
  const port = parseInt(u.port || '1080', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`proxy-pool: invalid port in "${url}"`);
  }
  return {
    host: u.hostname,
    port,
    type: 5,
    userId:   u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    id: createHash('sha256').update(url).digest('hex').slice(0, 12),
  };
}

// ── ProxyPool ─────────────────────────────────────────────────────────────────

export class ProxyPool {
  private readonly proxies: ParsedProxy[];

  constructor(proxies: ParsedProxy[] = []) {
    this.proxies = proxies;
  }

  /**
   * True when no proxies are configured. Every method becomes a no-op;
   * `assignProxy` returns null (fall through to source IP or OS default).
   */
  get isNoop(): boolean {
    return this.proxies.length === 0;
  }

  /**
   * F1: Assign a proxy for a given provider key.
   *
   * Strategy (in priority order):
   *  1. Primary: SHA-256 consistent hash of providerKey → stable index
   *  2. Rotate forward through pool skipping throttled / degraded proxies
   *  3. If ALL proxies are throttled/degraded, return the primary anyway —
   *     better to try a degraded proxy than hard-fail verification.
   *
   * Returns null when isNoop (SMTP_PROXY_LIST not configured).
   */
  async assignProxy(providerKey: string): Promise<ParsedProxy | null> {
    if (this.isNoop) return null;

    const primaryIdx = this.hashIndex(providerKey);
    const now = Date.now();

    for (let i = 0; i < this.proxies.length; i++) {
      const proxy = this.proxies[(primaryIdx + i) % this.proxies.length];

      const until = await this.getThrottledUntil(proxy.id);
      if (until !== null && until > now) continue; // still in cooldown

      const rate = await this.getSuccessRate(proxy.id);
      if (rate !== null && rate < 0.70) continue; // degraded — soft skip

      return proxy;
    }

    // All proxies are throttled or degraded — fall back to primary.
    return this.proxies[primaryIdx];
  }

  /**
   * F1: Record the outcome of an SMTP attempt through a given proxy.
   *
   * 'ok'    → increment the sliding ok window
   * 'fail'  → increment the sliding fail window
   * 'block' → increment the sliding fail window + set a 30-minute throttle
   *            + increment the lifetime block counter
   *
   * Uses a Redis pipeline (single round-trip). Non-fatal — never throws.
   */
  async recordOutcome(proxyId: string, outcome: ProxyOutcome): Promise<void> {
    if (this.isNoop) return;

    try {
      const now = Date.now();
      const id = randomUUID();
      const hourAgo = now - 3_600_000;

      const p = redis.pipeline();

      if (outcome === 'ok') {
        const key = `proxy:${proxyId}:ok_hour`;
        p.zadd(key, now, id);
        p.zremrangebyscore(key, 0, hourAgo);
        p.expire(key, 3700);
      } else {
        // 'fail' and 'block' both count as failures
        const key = `proxy:${proxyId}:fail_hour`;
        p.zadd(key, now, id);
        p.zremrangebyscore(key, 0, hourAgo);
        p.expire(key, 3700);
      }

      if (outcome === 'block') {
        // 30-minute cooldown — most providers lift temporary throttles in 10–60 min.
        const until = now + 30 * 60_000;
        p.set(`proxy:${proxyId}:throttled_until`, String(until), 'PX', 30 * 60_000);
        p.incr(`proxy:${proxyId}:block_count`);
        p.expire(`proxy:${proxyId}:block_count`, 7 * 24 * 3600); // 7-day rolling
        // Reuse the existing Prometheus IP block counter (proxy id as 'ip' label).
        ipBlocksTotal.inc({ ip: proxyId });
      }

      await p.exec();
    } catch {
      // Non-fatal — health tracking must not crash the verification path.
    }
  }

  /**
   * F1: Admin health snapshot for all proxies in the pool.
   */
  async getStats(): Promise<ProxyStats[]> {
    if (this.isNoop) return [];

    const now = Date.now();
    const hourAgo = now - 3_600_000;

    return Promise.all(
      this.proxies.map(async (proxy): Promise<ProxyStats> => {
        try {
          const [throttledUntilRaw, okCount, failCount, blockCountRaw] = await Promise.all([
            redis.get(`proxy:${proxy.id}:throttled_until`),
            redis.zcount(`proxy:${proxy.id}:ok_hour`, hourAgo, '+inf'),
            redis.zcount(`proxy:${proxy.id}:fail_hour`, hourAgo, '+inf'),
            redis.get(`proxy:${proxy.id}:block_count`),
          ]);

          const throttledUntil = throttledUntilRaw ? Number(throttledUntilRaw) : null;
          const blockCount = blockCountRaw ? Number(blockCountRaw) : 0;
          const total = okCount + failCount;
          const successRate = total > 0 ? okCount / total : null;
          const isThrottled = throttledUntil !== null && throttledUntil > now;
          const isDegraded = successRate !== null && successRate < 0.70;

          return {
            id: proxy.id,
            host: proxy.host,
            port: proxy.port,
            throttledUntil: isThrottled ? throttledUntil : null,
            okCount,
            failCount,
            successRate,
            blockCount,
            isHealthy: !isThrottled && !isDegraded,
          };
        } catch {
          return {
            id: proxy.id,
            host: proxy.host,
            port: proxy.port,
            throttledUntil: null,
            okCount: 0,
            failCount: 0,
            successRate: null,
            blockCount: 0,
            isHealthy: false,
          };
        }
      }),
    );
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * SHA-256-based consistent hash. Deterministic across restarts.
   */
  private hashIndex(key: string): number {
    const buf = createHash('sha256').update(key).digest();
    const n = buf.readUInt32BE(0);
    return n % this.proxies.length;
  }

  private async getThrottledUntil(id: string): Promise<number | null> {
    try {
      const v = await redis.get(`proxy:${id}:throttled_until`);
      return v ? Number(v) : null;
    } catch {
      return null; // Redis error → treat as not throttled
    }
  }

  private async getSuccessRate(id: string): Promise<number | null> {
    try {
      const now = Date.now();
      const hourAgo = now - 3_600_000;
      const [ok, fail] = await Promise.all([
        redis.zcount(`proxy:${id}:ok_hour`, hourAgo, '+inf'),
        redis.zcount(`proxy:${id}:fail_hour`, hourAgo, '+inf'),
      ]);
      const total = ok + fail;
      return total > 0 ? ok / total : null;
    } catch {
      return null; // Redis error → treat as unknown (don't penalise)
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

/**
 * F1: Load SOCKS5 proxies from the SMTP_PROXY_LIST environment variable
 * (comma-separated URLs). Empty/unset → noop pool (dev default).
 *
 * Production example:
 *   SMTP_PROXY_LIST=socks5://user:pass@203.0.113.10:1080,socks5://user:pass@203.0.113.11:1080
 *
 * Recommended providers for email verification:
 *   - Residential proxies (Bright Data, Smartproxy, Oxylabs) — best reputation
 *   - Business ISP proxies — good reputation, cheaper than residential
 *   - Avoid datacenter proxies — same problem as AWS IPs
 */
const rawProxies: ParsedProxy[] = (process.env.SMTP_PROXY_LIST ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .flatMap((url) => {
    try {
      return [parseProxyUrl(url)];
    } catch (err) {
      // Log misconfigured URLs at startup but don't crash the server.
      console.warn(`[proxy-pool] Skipping invalid proxy URL "${url}": ${err instanceof Error ? err.message : err}`);
      return [];
    }
  });

export const proxyPool = new ProxyPool(rawProxies);
