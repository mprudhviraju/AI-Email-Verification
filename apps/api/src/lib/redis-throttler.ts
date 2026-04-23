/**
 * redis-throttler.ts
 *
 * Distributed SMTP throttle enforced via Redis. Replaces the in-memory
 * DomainThrottler so limits hold across worker pods.
 *
 * Each `acquireSlot(domain, mxHost)` maps the target to a provider bucket
 * (see provider-throttle.ts), then runs an atomic Lua script that checks
 * three constraints in one round-trip:
 *
 *   1. Current concurrent acquires  <  provider.maxConcurrent
 *   2. Time since last acquire      >= provider.minDelayMs
 *   3. Acquires in the last 3600s   <  provider.maxPerHour
 *
 * If all pass, the script increments concurrency, adds to the sliding-hour
 * set, updates lastAcquireMs, and returns 0. Otherwise it returns the
 * number of milliseconds the caller should wait before retrying.
 *
 * Keys (all under one bucket `{bucket}`):
 *   {bucket}:active  → INT, current concurrent slot count
 *   {bucket}:hour    → ZSET, member=uuid, score=acquire timestamp (ms)
 *   {bucket}:last    → INT, last acquire timestamp (ms, with 1h TTL)
 *
 * Stale-lock protection: every key has a 1h TTL so a crashed worker
 * doesn't hold a slot forever. SMTP sessions are <20s so TTL ≫ session.
 */

import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { redis } from './redis.js';
import {
  resolveProvider,
  throttleBucketKey,
  type ProviderLimits,
} from './provider-throttle.js';

// ── Lua scripts ─────────────────────────────────────────────────────────────

/**
 * Acquire script.
 * KEYS[1] = bucket prefix (e.g. "throttle:gmail:default")
 * ARGV[1] = now (ms)
 * ARGV[2] = maxConcurrent
 * ARGV[3] = minDelayMs
 * ARGV[4] = maxPerHour
 * ARGV[5] = slot uuid
 * Returns: 0 on success, or wait-ms (int) on throttle.
 */
const ACQUIRE_LUA = `
local bucket = KEYS[1]
local activeKey = bucket .. ':active'
local hourKey   = bucket .. ':hour'
local lastKey   = bucket .. ':last'

local now           = tonumber(ARGV[1])
local maxConcurrent = tonumber(ARGV[2])
local minDelayMs    = tonumber(ARGV[3])
local maxPerHour    = tonumber(ARGV[4])
local slotId        = ARGV[5]

local hourAgo = now - 3600000

-- Prune sliding window
redis.call('ZREMRANGEBYSCORE', hourKey, 0, hourAgo)

-- Hourly cap
local hourCount = tonumber(redis.call('ZCARD', hourKey))
if hourCount >= maxPerHour then
  local oldest = redis.call('ZRANGE', hourKey, 0, 0, 'WITHSCORES')
  local waitMs = 1000
  if oldest[2] then
    waitMs = math.max(100, (tonumber(oldest[2]) + 3600000) - now)
  end
  return waitMs
end

-- Min delay between acquires
local lastMs = tonumber(redis.call('GET', lastKey) or 0)
local delay = minDelayMs - (now - lastMs)
if delay > 0 then
  return delay
end

-- Concurrency cap
local active = tonumber(redis.call('GET', activeKey) or 0)
if active >= maxConcurrent then
  return math.max(50, minDelayMs)
end

-- Acquire
redis.call('INCR', activeKey)
redis.call('EXPIRE', activeKey, 3600)
redis.call('ZADD', hourKey, now, slotId)
redis.call('EXPIRE', hourKey, 3700)
redis.call('SET', lastKey, now, 'PX', 3600000)
return 0
`;

/**
 * Release script. Decrements active counter with floor at 0.
 * KEYS[1] = bucket prefix
 */
const RELEASE_LUA = `
local activeKey = KEYS[1] .. ':active'
local v = tonumber(redis.call('GET', activeKey) or 0)
if v <= 0 then
  redis.call('SET', activeKey, 0, 'EX', 3600)
  return 0
end
redis.call('DECR', activeKey)
return v - 1
`;

// ── Client ──────────────────────────────────────────────────────────────────

export interface ThrottleAcquireOptions {
  /** Max total wait budget before giving up (ms). Default 5 minutes. */
  maxWaitMs?: number;
  /** Abort early if this AbortSignal fires. */
  signal?: AbortSignal;
  /**
   * C4: Per-call source IP override for the throttle bucket key.
   * When set, throttle accounting is segregated per source IP so each IP
   * gets its own `maxPerHour` and `maxConcurrent` counters. If omitted,
   * falls back to the instance's `sourceIp` (default: 'default').
   */
  sourceIp?: string;
}

export class RedisThrottler {
  private readonly client: Redis;
  private readonly sourceIp: string;

  constructor(client: Redis = redis, sourceIp = 'default') {
    this.client = client;
    this.sourceIp = sourceIp;
  }

  /**
   * Acquire a slot for a given domain (optionally using the MX host to refine
   * provider detection). Returns a release function — ALWAYS call it in a
   * `finally` block, even on error.
   */
  async acquireSlot(
    domain: string,
    mxHost?: string | null,
    opts: ThrottleAcquireOptions = {},
  ): Promise<() => Promise<void>> {
    const limits = resolveProvider(domain, mxHost);
    // C4: per-call sourceIp overrides the instance default so each IP gets
    // its own throttle bucket (maxPerHour / maxConcurrent tracked separately).
    const bucket = throttleBucketKey(limits.provider, opts.sourceIp ?? this.sourceIp);
    const slotId = randomUUID();
    const deadline = Date.now() + (opts.maxWaitMs ?? 5 * 60_000);

    // Retry loop — blocks until acquired or deadline hit.
    // Redis itself is non-blocking; we sleep on the client side between
    // attempts using the hint returned by the Lua script.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (opts.signal?.aborted) {
        throw new Error('Throttle acquire aborted');
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Throttle acquire deadline exceeded for provider ${limits.provider}`,
        );
      }

      const waitMs = await this.tryAcquire(bucket, limits, slotId);
      if (waitMs === 0) {
        return () => this.release(bucket);
      }

      // Cap the sleep to the remaining deadline
      const sleep = Math.min(waitMs, Math.max(1, deadline - Date.now()));
      await delay(sleep);
    }
  }

  private async tryAcquire(
    bucket: string,
    limits: ProviderLimits,
    slotId: string,
  ): Promise<number> {
    const res = await this.client.eval(
      ACQUIRE_LUA,
      1,
      bucket,
      Date.now().toString(),
      limits.maxConcurrent.toString(),
      limits.minDelayMs.toString(),
      limits.maxPerHour.toString(),
      slotId,
    );
    return Number(res);
  }

  private async release(bucket: string): Promise<void> {
    try {
      await this.client.eval(RELEASE_LUA, 1, bucket);
    } catch (err) {
      // Don't throw from a release path — log and move on.
      // eslint-disable-next-line no-console
      console.warn(
        '[throttler] release failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  /** Debug helper: current depth of each counter for a provider bucket. */
  async inspect(domain: string, mxHost?: string | null): Promise<{
    provider: string;
    active: number;
    hourCount: number;
    lastMs: number | null;
    limits: ProviderLimits;
  }> {
    const limits = resolveProvider(domain, mxHost);
    const bucket = throttleBucketKey(limits.provider, this.sourceIp);
    const [active, hourCount, lastMs] = await Promise.all([
      this.client.get(`${bucket}:active`).then((v) => Number(v ?? 0)),
      this.client.zcard(`${bucket}:hour`),
      this.client.get(`${bucket}:last`).then((v) => (v ? Number(v) : null)),
    ]);
    return { provider: limits.provider, active, hourCount, lastMs, limits };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Process-wide shared throttler. Replaces the old in-memory DomainThrottler. */
export const redisThrottler = new RedisThrottler();
