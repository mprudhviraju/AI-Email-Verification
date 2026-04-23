/**
 * api-key.ts
 *
 * D4: API key generation, validation, and daily quota enforcement.
 *
 * Key format:  aev_<64 hex chars>   (prefix + 32 random bytes)
 * DB storage:  SHA-256 hash + first 8 chars (keyPrefix) — raw key never persisted.
 * Daily quota: Redis counter `usage:{keyId}:{YYYY-MM-DD}` incremented per request.
 *              25-hour TTL covers day boundary overlap with no extra cleanup.
 *
 * Usage flow:
 *   1. buildContext() reads `X-API-Key` header
 *   2. validateApiKey() looks up the hash in DB → returns userId + keyId + dailyLimit
 *   3. checkAndIncrementQuota() INCRs the Redis counter; returns { allowed, used, limit }
 *   4. If allowed: set ctx.userId = key.userId, ctx.apiKeyId = key.id
 *   5. If not allowed: ctx.userId stays null → resolver returns Unauthorized
 */

import { createHash, randomBytes } from 'node:crypto';
import { prisma } from './context.js';
import { redis } from './redis.js';

// ── Key generation ─────────────────────────────────────────────────────────────

/**
 * Generate a new raw API key. Returned once on creation; never stored raw.
 * Format: `aev_` + 64 lowercase hex chars (32 random bytes).
 */
export function generateRawKey(): string {
  return 'aev_' + randomBytes(32).toString('hex');
}

/**
 * SHA-256 hex digest of a raw key string. Used for DB storage and lookup.
 */
export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// ── Validation ─────────────────────────────────────────────────────────────────

export interface ApiKeyInfo {
  userId:     string;
  keyId:      string;
  dailyLimit: number;
}

/**
 * Validate a raw key string against the DB.
 * Returns the key's owner/limits on success, or null if not found/inactive.
 * Fire-and-forgets a `lastUsedAt` update on success (non-blocking).
 */
export async function validateApiKey(raw: string): Promise<ApiKeyInfo | null> {
  const hash = hashKey(raw);
  const key = await prisma.apiKey.findUnique({
    where: { keyHash: hash },
    select: { id: true, userId: true, dailyLimit: true, isActive: true },
  });
  if (!key || !key.isActive) return null;

  // Non-blocking lastUsedAt update — never let this delay the request.
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { userId: key.userId, keyId: key.id, dailyLimit: key.dailyLimit };
}

// ── Daily quota ────────────────────────────────────────────────────────────────

export interface QuotaResult {
  allowed: boolean;
  used:    number;
  limit:   number;
}

/**
 * Atomically increment the per-key daily usage counter and check the quota.
 * Counter key: `usage:{keyId}:{YYYY-MM-DD}` (UTC date).
 * TTL set to 25 hours on first write to survive day-boundary overlap.
 *
 * Returns `{ allowed: false }` when the limit is exceeded *before* this call
 * (i.e., we still increment so admins can see overage in Redis, but the
 * request is rejected). This matches the standard "count then gate" pattern
 * used by most API gateways.
 */
export async function checkAndIncrementQuota(
  keyId:      string,
  dailyLimit: number,
): Promise<QuotaResult> {
  const today   = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const redisKey = `usage:${keyId}:${today}`;

  const used = await redis.incr(redisKey);
  // Set TTL only on the first increment so we don't reset an existing counter.
  if (used === 1) {
    await redis.expire(redisKey, 25 * 3600); // 25 hours covers date rollover
  }

  return { allowed: used <= dailyLimit, used, limit: dailyLimit };
}
