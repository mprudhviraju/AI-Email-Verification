/**
 * ip-pool.ts
 *
 * C1–C3: Manages a pool of source IPs for outbound SMTP connections.
 *
 * Each `assignIp(providerKey)` call returns the most suitable source IP for
 * a given mail provider using consistent hashing (SHA-256 of the provider
 * key, mod pool size). This keeps the same domain/provider consistently on
 * the same IP, which avoids "new sender" reputation penalties. If the primary
 * IP is throttled or health-degraded, the call scans forward to the next
 * healthy IP in rotation.
 *
 * Health state is tracked in Redis per IP:
 *   ip:{addr}:ok_hour       — ZSET: uuid → ms timestamp, sliding 1-hour window
 *   ip:{addr}:fail_hour     — ZSET: uuid → ms timestamp, sliding 1-hour window
 *   ip:{addr}:throttled_until — STRING: unix ms timestamp
 *   ip:{addr}:block_count   — INT: lifetime detected IP blocks
 *
 * Noop mode: when SMTP_SOURCE_IPS is empty (default in dev), `isNoop` is true,
 * `assignIp()` returns null, and every call to the pool is a no-op. The SMTP
 * layer treats null sourceIp as "let the OS pick the outbound interface" —
 * behaviour identical to pre-Phase-C.
 */

import { createHash, randomUUID } from 'node:crypto';
import { redis } from './redis.js';
import { ipBlocksTotal } from './metrics.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type IpOutcome = 'ok' | 'fail' | 'block';

export interface IpStats {
  addr: string;
  /** Unix ms timestamp if currently throttled, null otherwise */
  throttledUntil: number | null;
  /** Successful SMTP attempts in the last hour */
  okCount: number;
  /** Failed SMTP attempts in the last hour */
  failCount: number;
  /** okCount / (okCount + failCount), null if no data */
  successRate: number | null;
  /** Lifetime count of detected IP-level blocks */
  blockCount: number;
  /** false when throttled OR successRate < 70% */
  isHealthy: boolean;
}

// ── IpPool ────────────────────────────────────────────────────────────────────

export class IpPool {
  private readonly ips: string[];

  constructor(ips: string[] = []) {
    this.ips = ips;
  }

  /**
   * True when no IPs are configured. Every method becomes a no-op;
   * `assignIp` returns null (OS picks the outbound interface).
   */
  get isNoop(): boolean {
    return this.ips.length === 0;
  }

  /**
   * C1: Assign a source IP for a given provider key.
   *
   * Strategy (in priority order):
   *  1. Primary: SHA-256 consistent hash of providerKey → stable index
   *  2. Rotate forward through pool skipping throttled / degraded IPs
   *  3. If ALL IPs are throttled/degraded, return the primary anyway —
   *     better to try a degraded IP than hard-fail verification.
   *
   * Returns null when isNoop (SMTP_SOURCE_IPS not configured).
   */
  async assignIp(providerKey: string): Promise<string | null> {
    if (this.isNoop) return null;

    const primaryIdx = this.hashIndex(providerKey);
    const now = Date.now();

    for (let i = 0; i < this.ips.length; i++) {
      const addr = this.ips[(primaryIdx + i) % this.ips.length];

      const until = await this.getThrottledUntil(addr);
      if (until !== null && until > now) continue; // still in cooldown

      const rate = await this.getSuccessRate(addr);
      if (rate !== null && rate < 0.70) continue; // degraded — soft skip

      return addr;
    }

    // All IPs are throttled or degraded — fall back to primary.
    return this.ips[primaryIdx];
  }

  /**
   * C3: Record the outcome of an SMTP attempt on a given IP.
   *
   * 'ok'    → increment the sliding ok window
   * 'fail'  → increment the sliding fail window
   * 'block' → increment the sliding fail window + set a 30-minute throttle
   *            + increment the lifetime block counter
   *
   * Uses a Redis pipeline (single round-trip). Non-fatal — never throws;
   * health recording failures must not delay or cancel verification.
   */
  async recordOutcome(addr: string, outcome: IpOutcome): Promise<void> {
    if (this.isNoop) return;

    try {
      const now = Date.now();
      const id = randomUUID();
      const hourAgo = now - 3_600_000;

      const p = redis.pipeline();

      if (outcome === 'ok') {
        const key = `ip:${addr}:ok_hour`;
        p.zadd(key, now, id);
        p.zremrangebyscore(key, 0, hourAgo);
        p.expire(key, 3700);
      } else {
        // 'fail' and 'block' both count as failures
        const key = `ip:${addr}:fail_hour`;
        p.zadd(key, now, id);
        p.zremrangebyscore(key, 0, hourAgo);
        p.expire(key, 3700);
      }

      if (outcome === 'block') {
        // 30-minute cooldown. Conservative choice — most providers lift
        // temporary IP throttles in 10–60 minutes; 30min splits the middle.
        const until = now + 30 * 60_000;
        p.set(`ip:${addr}:throttled_until`, String(until), 'PX', 30 * 60_000);
        p.incr(`ip:${addr}:block_count`);
        p.expire(`ip:${addr}:block_count`, 7 * 24 * 3600); // 7-day rolling
        // D5: increment the Prometheus block counter.
        ipBlocksTotal.inc({ ip: addr });
      }

      await p.exec();
    } catch {
      // Non-fatal — health tracking must not crash the verification path.
    }
  }

  /**
   * C3: Admin health snapshot for all IPs in the pool.
   * Useful for dashboards and alerts (Phase D5 observability).
   */
  async getStats(): Promise<IpStats[]> {
    if (this.isNoop) return [];

    const now = Date.now();
    const hourAgo = now - 3_600_000;

    return Promise.all(
      this.ips.map(async (addr): Promise<IpStats> => {
        try {
          const [throttledUntilRaw, okCount, failCount, blockCountRaw] = await Promise.all([
            redis.get(`ip:${addr}:throttled_until`),
            redis.zcount(`ip:${addr}:ok_hour`, hourAgo, '+inf'),
            redis.zcount(`ip:${addr}:fail_hour`, hourAgo, '+inf'),
            redis.get(`ip:${addr}:block_count`),
          ]);

          const throttledUntil = throttledUntilRaw ? Number(throttledUntilRaw) : null;
          const blockCount = blockCountRaw ? Number(blockCountRaw) : 0;
          const total = okCount + failCount;
          const successRate = total > 0 ? okCount / total : null;
          const isThrottled = throttledUntil !== null && throttledUntil > now;
          const isDegraded = successRate !== null && successRate < 0.70;

          return {
            addr,
            throttledUntil: isThrottled ? throttledUntil : null,
            okCount,
            failCount,
            successRate,
            blockCount,
            isHealthy: !isThrottled && !isDegraded,
          };
        } catch {
          // Redis error — return minimal stats to avoid crashing the admin call.
          return {
            addr,
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
   * Using SHA-256 (vs simple string hash) gives better bit distribution
   * across the pool as IPs are added/removed.
   */
  private hashIndex(key: string): number {
    const buf = createHash('sha256').update(key).digest();
    // Read first 4 bytes as big-endian uint32
    const n = buf.readUInt32BE(0);
    return n % this.ips.length;
  }

  private async getThrottledUntil(addr: string): Promise<number | null> {
    try {
      const v = await redis.get(`ip:${addr}:throttled_until`);
      return v ? Number(v) : null;
    } catch {
      return null; // Redis error → treat as not throttled
    }
  }

  private async getSuccessRate(addr: string): Promise<number | null> {
    try {
      const now = Date.now();
      const hourAgo = now - 3_600_000;
      const [ok, fail] = await Promise.all([
        redis.zcount(`ip:${addr}:ok_hour`, hourAgo, '+inf'),
        redis.zcount(`ip:${addr}:fail_hour`, hourAgo, '+inf'),
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
 * C2: Load source IPs from the SMTP_SOURCE_IPS environment variable
 * (comma-separated). Empty/unset → noop pool (dev default).
 *
 * Production example:
 *   SMTP_SOURCE_IPS=203.0.113.10,203.0.113.11,203.0.113.12
 *
 * Each IP needs:
 *   - Reverse DNS (PTR) pointing to your probe domain
 *   - Probe domain with SPF listing all IPs
 *   - Clean reputation (check MXToolbox Blacklist before adding)
 */
const rawIps = (process.env.SMTP_SOURCE_IPS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const ipPool = new IpPool(rawIps);
