/**
 * result-cache.ts
 *
 * Full verification-result cache keyed per email. Customers re-upload
 * overlapping lists constantly — without this cache, every re-run pays full
 * SMTP cost. With a 7-day TTL and real-world list overlap, we typically see
 * 30–60% hit rates, which is the difference between "handles 1M/day" and
 * "doesn't."
 *
 * Data model:
 *   result:{email} → JSON(SmtpVerificationResult)   (7d TTL)
 *
 * Design notes:
 *   - Cache is populated at the end of `verifyEmail()` (fire-and-forget).
 *   - Cache is consumed immediately after syntax check — if a hit is found,
 *     we short-circuit and return. Stage callbacks are replayed so the UI
 *     progress bar still advances.
 *   - `RESULT_CACHE_TTL=0` disables the cache entirely (useful for tests
 *     and retry-batch semantics where we want a fresh probe).
 *   - Only non-errored results are cached. If a verification hit a transient
 *     SMTP timeout, we don't want to poison the cache for 7 days.
 */

import { redis, redisKey } from './redis.js';
import type { SmtpVerificationResult } from './smtp-verifier.js';

const TTL_SECONDS = Number(process.env.RESULT_CACHE_TTL ?? 7 * 24 * 3600);

function key(email: string): string {
  return redisKey('result', email.trim().toLowerCase());
}

/** Returns a cached result for `email` if one exists, else null. */
export async function getCachedResult(
  email: string,
): Promise<SmtpVerificationResult | null> {
  if (TTL_SECONDS <= 0) return null;
  try {
    const raw = await redis.get(key(email));
    if (!raw) return null;
    return JSON.parse(raw) as SmtpVerificationResult;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[result-cache] read failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Store a verification result. Fire-and-forget.
 *
 * Skip-cache rules (all indicate a transient condition that could resolve
 * on retry — caching them for 7 days would freeze a temporary state):
 *   1. `errorMessage` set       → network error, timeout, socket reset
 *   2. SMTP code in 4xx range   → RFC-classified transient failures:
 *                                 421 (service unavailable / rate limited),
 *                                 450/451 (mailbox temp unavailable / local
 *                                 error), 452 (insufficient storage).
 *                                 5xx codes ARE cached — those are permanent
 *                                 ("user unknown", spam-policy blocks).
 */
export function cacheResult(result: SmtpVerificationResult): void {
  if (TTL_SECONDS <= 0) return;
  if (!result.email) return;
  if (result.errorMessage) return;
  if (isTransientSmtpCode(result.smtpCode)) return;

  redis
    .set(key(result.email), JSON.stringify(result), 'EX', TTL_SECONDS)
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(
        '[result-cache] write failed:',
        err instanceof Error ? err.message : err,
      );
    });
}

/** True iff the SMTP code denotes a transient failure (RFC 5321 §4.2.1). */
function isTransientSmtpCode(code: number | null): boolean {
  return code !== null && code >= 400 && code < 500;
}

/** Manual eviction (e.g. after user reports a wrong result). */
export async function evictResult(email: string): Promise<void> {
  await redis.del(key(email));
}
