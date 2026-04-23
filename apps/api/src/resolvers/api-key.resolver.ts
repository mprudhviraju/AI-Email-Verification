/**
 * api-key.resolver.ts
 *
 * D4: Resolvers for API key management — create, list, and revoke keys.
 *
 * All operations require a JWT-authenticated user (not an API key itself, to
 * prevent bootstrap paradox and key-rotation abuse).
 */

import type { ApiKey } from '@prisma/client';
import type { AppContext } from '../lib/context.js';
import { prisma } from '../lib/context.js';
import { generateRawKey, hashKey } from '../lib/api-key.js';

export const apiKeyResolvers = {
  Query: {
    myApiKeys: async (_: unknown, _args: unknown, ctx: AppContext) => {
      if (!ctx.userId) throw new Error('Unauthorized');
      return prisma.apiKey.findMany({
        where:   { userId: ctx.userId },
        orderBy: { createdAt: 'desc' },
      });
    },
  },

  Mutation: {
    createApiKey: async (
      _: unknown,
      { name, dailyLimit = 1_000 }: { name: string; dailyLimit?: number },
      ctx: AppContext,
    ) => {
      if (!ctx.userId) throw new Error('Unauthorized');
      if (!name.trim()) throw new Error('Key name must not be empty');
      if (dailyLimit < 1 || dailyLimit > 10_000_000) {
        throw new Error('dailyLimit must be between 1 and 10,000,000');
      }

      const raw = generateRawKey();

      const apiKey = await prisma.apiKey.create({
        data: {
          userId:     ctx.userId,
          name:       name.trim(),
          keyHash:    hashKey(raw),
          keyPrefix:  raw.slice(0, 8), // "aev_XXXX" — safe to display
          dailyLimit,
        },
      });

      return { key: raw, apiKey };
    },

    revokeApiKey: async (
      _: unknown,
      { id }: { id: string },
      ctx: AppContext,
    ) => {
      if (!ctx.userId) throw new Error('Unauthorized');

      // userId guard prevents revoking another user's key.
      const updated = await prisma.apiKey.updateMany({
        where: { id, userId: ctx.userId },
        data:  { isActive: false },
      });

      if (updated.count === 0) throw new Error('API key not found');
      return true;
    },
  },

  // ── Field resolvers ──────────────────────────────────────────────────────────

  ApiKey: {
    createdAt:  (k: ApiKey) => k.createdAt.toISOString(),
    lastUsedAt: (k: ApiKey) => k.lastUsedAt?.toISOString() ?? null,
  },
};
