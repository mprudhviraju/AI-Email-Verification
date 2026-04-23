/**
 * mx-cache.ts
 *
 * Redis-backed MX record cache. Skips DNS lookups for domains we've seen
 * recently — huge speedup on corporate-heavy lists where thousands of emails
 * share a single MX. Also caches negative results (no MX found) with a
 * shorter TTL so we don't hammer DNS for broken domains.
 *
 * Usage:
 *   const dns = await cachedResolveMx(domain, resolveMxWithFallback);
 *
 * The resolver function is injected so this module stays decoupled from the
 * concrete DNS implementation in smtp-verifier.ts.
 */

import { redis, redisKey } from './redis.js';

export interface MxLookupResult {
  hosts: string[];
  ttl: number | null;
  responseMs: number;
  usedFallback: boolean;
}

export interface CachedMxResult extends MxLookupResult {
  cacheHit: boolean;
}

const POSITIVE_TTL_SECONDS = Number(process.env.MX_CACHE_TTL ?? 24 * 3600); // 24h
const NEGATIVE_TTL_SECONDS = Number(process.env.MX_CACHE_TTL_NEG ?? 5 * 60); // 5min

type DnsResolver = (domain: string) => Promise<MxLookupResult>;

/**
 * Look up MX for `domain`, hitting Redis first. On miss, invoke `resolver`
 * and persist its result. Negative results (empty hosts) get a shorter TTL.
 */
export async function cachedResolveMx(
  domain: string,
  resolver: DnsResolver,
): Promise<CachedMxResult> {
  const key = redisKey('mx', domain.toLowerCase());

  try {
    const cached = await redis.get(key);
    if (cached) {
      const parsed = JSON.parse(cached) as MxLookupResult;
      return { ...parsed, cacheHit: true, responseMs: 0 };
    }
  } catch (err) {
    // Redis miss or parse error — fall through to live DNS
    // eslint-disable-next-line no-console
    console.warn('[mx-cache] read failed:', err instanceof Error ? err.message : err);
  }

  const fresh = await resolver(domain);

  // Persist asynchronously; don't block caller if Redis is slow.
  const ttl = fresh.hosts.length > 0 ? POSITIVE_TTL_SECONDS : NEGATIVE_TTL_SECONDS;
  redis
    .set(key, JSON.stringify(fresh), 'EX', ttl)
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[mx-cache] write failed:', err instanceof Error ? err.message : err);
    });

  return { ...fresh, cacheHit: false };
}

/** Invalidate a domain's cached MX (e.g. after a confirmed block). */
export async function invalidateMx(domain: string): Promise<void> {
  await redis.del(redisKey('mx', domain.toLowerCase()));
}
