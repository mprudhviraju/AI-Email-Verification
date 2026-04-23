/**
 * redis.ts
 *
 * Shared ioredis client for the API process. BullMQ, rate limiter, and all
 * caches reuse this single connection to avoid pool exhaustion.
 *
 * Note: BullMQ requires `maxRetriesPerRequest: null` on the connection it
 * uses for blocking commands, so we set it globally.
 */

// ioredis exposes its constructor as both default export and named `Redis`.
// The named import works under NodeNext ESM without esModuleInterop fuss.
import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const redis: Redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('error', (err) => {
  // Avoid crashing the process on transient connection issues; ioredis
  // will reconnect automatically.
  // eslint-disable-next-line no-console
  console.error('[redis] client error:', err.message);
});

export function redisKey(...parts: (string | number)[]): string {
  return parts.join(':');
}
