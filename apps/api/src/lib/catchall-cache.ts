/**
 * catchall-cache.ts
 *
 * Once we confirm a domain is catch-all via a live SMTP probe, we cache that
 * fact for 24h. Subsequent emails on the same domain can skip the SMTP session
 * entirely and jump straight to enrichment — the single biggest speedup for
 * yahoo/aol-heavy lists.
 *
 * Data model:
 *   catchall:{domain} → "1"        (24h TTL)
 *
 * Why only positive hits are cached: a non-catch-all result needs per-email
 * RCPT TO probing because the positive signal is per-address. Positive hits
 * are domain-level facts, so one domain-level cache entry substitutes for
 * thousands of SMTP sessions.
 *
 * Cache is never the SOLE signal — downstream code still runs enrichment
 * (Gravatar + HIBP) for every email on a catch-all domain so the per-address
 * real/not-real decision has evidence.
 */

import { redis, redisKey } from './redis.js';

const TTL_SECONDS = Number(process.env.CATCHALL_CACHE_TTL ?? 24 * 3600);

function key(domain: string): string {
  return redisKey('catchall', domain.toLowerCase());
}

/** Record that `domain` is catch-all. Fire-and-forget. */
export function markCatchAll(domain: string): void {
  if (!domain) return;
  redis
    .set(key(domain), '1', 'EX', TTL_SECONDS)
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(
        '[catchall-cache] write failed:',
        err instanceof Error ? err.message : err,
      );
    });
}

/** Returns true if we've confirmed this domain as catch-all within TTL. */
export async function isKnownCatchAll(domain: string): Promise<boolean> {
  if (!domain) return false;
  try {
    const v = await redis.get(key(domain));
    return v === '1';
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[catchall-cache] read failed:',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/** Manually evict a domain (e.g. after receiving conflicting evidence). */
export async function evictCatchAll(domain: string): Promise<void> {
  await redis.del(key(domain));
}
