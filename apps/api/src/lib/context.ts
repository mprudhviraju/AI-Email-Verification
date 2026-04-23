import { PrismaClient } from '@prisma/client';
import { PubSub } from 'graphql-subscriptions';
import { verifyToken, extractToken } from './auth.js';
import { validateApiKey, checkAndIncrementQuota } from './api-key.js';

export const prisma = new PrismaClient();
export const pubsub = new PubSub();

export interface AppContext {
  prisma:   typeof prisma;
  pubsub:   typeof pubsub;
  userId:   string | null;
  /** Non-null when the request authenticated via an X-API-Key header. */
  apiKeyId: string | null;
}

export async function buildContext(req: {
  headers: Record<string, string | string[] | undefined>;
}): Promise<AppContext> {
  let userId:   string | null = null;
  let apiKeyId: string | null = null;

  // ── 1. JWT path ──────────────────────────────────────────────────────────────
  const auth   = req.headers['authorization'];
  const header = Array.isArray(auth) ? auth[0] : auth;
  const token  = extractToken(header);

  if (token) {
    try {
      const payload = verifyToken(token);
      userId = payload.sub;
    } catch {
      // Invalid/expired token — treat as unauthenticated
    }
  }

  // ── 2. API key path (only if JWT didn't authenticate) ────────────────────────
  if (!userId) {
    const raw = req.headers['x-api-key'];
    const rawKey = Array.isArray(raw) ? raw[0] : raw;

    if (rawKey) {
      const keyInfo = await validateApiKey(rawKey).catch(() => null);

      if (keyInfo) {
        const quota = await checkAndIncrementQuota(
          keyInfo.keyId,
          keyInfo.dailyLimit,
        ).catch(() => ({ allowed: false, used: 0, limit: keyInfo.dailyLimit }));

        if (quota.allowed) {
          userId   = keyInfo.userId;
          apiKeyId = keyInfo.keyId;
        }
        // If quota exceeded: userId stays null → resolvers return Unauthorized.
      }
    }
  }

  return { prisma, pubsub, userId, apiKeyId };
}
