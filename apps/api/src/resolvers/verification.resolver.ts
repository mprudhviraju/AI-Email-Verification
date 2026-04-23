import { prisma, pubsub } from '../lib/context.js';
import { verificationQueue } from '../lib/queue.js';
import { verifyEmail } from '../lib/smtp-verifier.js';
import { parseCsvEmails } from '../lib/email-list-parser.js';
import { redis } from '../lib/redis.js';
import {
  planChunks,
  chunksRemainingKey,
  batchStartedKey,
  CHUNKS_REMAINING_TTL_SECONDS,
  RESULT_INSERT_CHUNK_SIZE,
} from '../lib/batch-chunking.js';
import type { AppContext } from '../lib/context.js';
import type {
  EmailVerificationBatch,
  EmailVerificationResult,
} from '@prisma/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * D2: BullMQ job priority based on batch size. Lower number = processed first.
 * Small/urgent batches cut ahead of large background batches.
 *
 *  ≤100          → 1  (tiny — user is watching)
 *  ≤1,000        → 3  (small bulk — fast turnaround)
 *  ≤10,000       → 5  (medium bulk)
 *  >10,000       → 8  (large batch — background)
 */
function batchPriority(emailCount: number): number {
  if (emailCount <= 100)    return 1;
  if (emailCount <= 1_000)  return 3;
  if (emailCount <= 10_000) return 5;
  return 8;
}

function pct(count: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((count / total) * 100 * 10) / 10;
}

function serializeBatch(b: EmailVerificationBatch) {
  return {
    ...b,
    createdAt: b.createdAt.toISOString(),
    completedAt: b.completedAt?.toISOString() ?? null,
    validPct: pct(b.validCount, b.totalCount),
    invalidPct: pct(b.invalidCount, b.totalCount),
    riskyPct: pct(b.riskyCount, b.totalCount),
    unknownPct: pct(b.unknownCount, b.totalCount),
    results: [],
  };
}

function serializeResult(r: EmailVerificationResult) {
  return {
    ...r,
    verifiedAt: r.verifiedAt.toISOString(),
  };
}

// ── Resolvers ─────────────────────────────────────────────────────────────────

export const verificationResolvers = {
  Query: {
    emailVerificationBatches: async (
      _: unknown,
      { limit = 20, offset = 0 }: { limit?: number; offset?: number },
      ctx: AppContext,
    ) => {
      const batches = await prisma.emailVerificationBatch.findMany({
        where: ctx.userId ? { userId: ctx.userId } : {},
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
        skip: offset,
      });
      return batches.map(serializeBatch);
    },

    emailVerificationBatch: async (_: unknown, { id }: { id: string }) => {
      const batch = await prisma.emailVerificationBatch.findUnique({ where: { id } });
      if (!batch) return null;
      return serializeBatch(batch);
    },

    emailVerificationResults: async (
      _: unknown,
      {
        batchId,
        status,
        search,
        limit = 50,
        offset = 0,
        cursor,
      }: {
        batchId: string;
        status?: string;
        search?: string;
        limit?: number;
        offset?: number;
        cursor?: string;
      },
    ) => {
      const where: Record<string, unknown> = { batchId };
      if (status) where['status'] = status;
      if (search) {
        where['OR'] = [
          { email: { contains: search, mode: 'insensitive' } },
          { domain: { contains: search, mode: 'insensitive' } },
        ];
      }
      const take = Math.min(limit, 200);

      // B7 — cursor path: skip the COUNT(*) entirely and use Prisma's keyset
      // cursor. `orderBy: { id: 'asc' }` is required for keyset stability;
      // `verifiedAt` ordering (legacy `offset` path below) doesn't work with
      // cursors because it's non-unique. Fetch `take + 1` to detect hasMore
      // without a second query.
      if (cursor !== undefined) {
        const rows = await prisma.emailVerificationResult.findMany({
          where,
          orderBy: { id: 'asc' },
          take: take + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        const hasMore = rows.length > take;
        const page = hasMore ? rows.slice(0, take) : rows;
        return {
          results: page.map(serializeResult),
          total: 0,
          nextCursor: hasMore ? page[page.length - 1]!.id : null,
          hasMore,
        };
      }

      // Legacy offset path — kept so the existing web UI works unchanged.
      const [results, total] = await Promise.all([
        prisma.emailVerificationResult.findMany({
          where,
          orderBy: { verifiedAt: 'desc' },
          take,
          skip: offset,
        }),
        prisma.emailVerificationResult.count({ where }),
      ]);

      return {
        results: results.map(serializeResult),
        total,
        nextCursor: null,
        hasMore: offset + results.length < total,
      };
    },
  },

  Mutation: {
    // ── Single verify — runs inline ─────────────────────────────────────────
    verifySingleEmail: async (_: unknown, { email }: { email: string }, ctx: AppContext) => {
      const batch = await prisma.emailVerificationBatch.create({
        data: {
          label: email,
          totalCount: 1,
          userId: ctx.userId ?? null,
        },
      });

      const result = await verifyEmail(email);

      const dbResult = await prisma.emailVerificationResult.create({
        data: {
          batchId: batch.id,
          email: result.email,
          domain: result.domain,
          syntaxValid: result.syntaxValid,
          isDisposable: result.isDisposable,
          isRoleBased: result.isRoleBased,
          isUnicode: result.isUnicode,
          isHoneypot: result.isHoneypot,
          mxFound: result.mxFound,
          mxHost: result.mxHost,
          mxFallback: result.mxFallback,
          dnsTtl: result.dnsTtl,
          dnsResponseMs: result.dnsResponseMs,
          smtpReachable: result.smtpReachable,
          smtpCode: result.smtpCode,
          smtpMessage: result.smtpMessage,
          isCatchAll: result.isCatchAll,
          gravatarFound: result.gravatarFound,
          hibpBreachCount: result.hibpBreachCount,
          status: result.status,
          score: result.score,
          confidence: result.confidence,
          responseTimeMs: result.responseTimeMs,
          errorMessage: result.errorMessage,
        },
      });

      await prisma.emailVerificationBatch.update({
        where: { id: batch.id },
        data: {
          completedCount: 1,
          status: 'DONE',
          completedAt: new Date(),
          validCount: result.status === 'VALID' ? 1 : 0,
          invalidCount: result.status === 'INVALID' ? 1 : 0,
          riskyCount: result.status === 'RISKY' ? 1 : 0,
          unknownCount: !['VALID', 'INVALID', 'RISKY'].includes(result.status) ? 1 : 0,
        },
      });

      return serializeResult(dbResult);
    },

    // ── Bulk verify — enqueue ───────────────────────────────────────────────
    createVerificationBatch: async (
      _: unknown,
      { label, csvContent }: { label: string; csvContent: string },
      ctx: AppContext,
    ) => {
      const emails = parseCsvEmails(csvContent);
      if (emails.length === 0) throw new Error('No valid email addresses found in the uploaded content');

      // Create batch + job records
      const job = await prisma.job.create({
        data: { type: 'VERIFY_EMAIL_BATCH', status: 'PENDING' },
      });

      const batch = await prisma.emailVerificationBatch.create({
        data: {
          label,
          totalCount: emails.length,
          userId: ctx.userId ?? null,
          jobId: job.id,
        },
      });

      // B7 — Pre-insert all result rows as UNKNOWN so progress can be tracked.
      // Chunked into `RESULT_INSERT_CHUNK_SIZE` (default 500) rows per call to
      // avoid a single multi-minute transaction on large lists. Sequential
      // (not parallel) because Postgres handles each 500-row insert in
      // milliseconds and sequential writes keep Prisma's connection pool
      // light — leaving room for the chunks enqueued next.
      const inserts = emails.map((email) => ({
        batchId: batch.id,
        email,
        domain: email.includes('@') ? email.split('@')[1]! : '',
        status: 'UNKNOWN' as const,
      }));
      for (let i = 0; i < inserts.length; i += RESULT_INSERT_CHUNK_SIZE) {
        await prisma.emailVerificationResult.createMany({
          data: inserts.slice(i, i + RESULT_INSERT_CHUNK_SIZE),
        });
      }

      // Fan out into N parallel chunks. See lib/batch-chunking.ts for the
      // lifecycle rationale — one DB Job still owns aggregate status; Redis
      // coordinates which chunk flips RUNNING and which finalizes the batch.
      const { chunkCount } = planChunks(emails.length);
      await redis.set(
        chunksRemainingKey(batch.id),
        String(chunkCount),
        'EX',
        CHUNKS_REMAINING_TTL_SECONDS,
      );

      // D2: priority keeps small/urgent batches ahead of large background ones.
      const priority = batchPriority(emails.length);
      await Promise.all(
        Array.from({ length: chunkCount }, (_, chunkIndex) =>
          verificationQueue.add(
            'verify-email-chunk',
            { batchId: batch.id, jobId: job.id, chunkIndex, chunkCount },
            { priority },
          ),
        ),
      );

      return serializeBatch(batch);
    },

    // ── Retry ───────────────────────────────────────────────────────────────
    retryVerificationBatch: async (_: unknown, { id }: { id: string }) => {
      const batch = await prisma.emailVerificationBatch.findUnique({
        where: { id },
        include: { job: true },
      });
      if (!batch) throw new Error('Batch not found');

      // Create a fresh job
      const newJob = await prisma.job.create({
        data: { type: 'VERIFY_EMAIL_BATCH', status: 'PENDING' },
      });

      const updated = await prisma.emailVerificationBatch.update({
        where: { id },
        data: {
          status: 'PENDING',
          completedCount: 0,
          validCount: 0,
          invalidCount: 0,
          riskyCount: 0,
          unknownCount: 0,
          completedAt: null,
          jobId: newJob.id,
        },
      });

      // Reset all results to UNKNOWN
      await prisma.emailVerificationResult.updateMany({
        where: { batchId: id },
        data: {
          status: 'UNKNOWN',
          smtpReachable: false,
          smtpCode: null,
          smtpMessage: null,
          mxFound: false,
          mxHost: null,
          score: 0,
          errorMessage: null,
        },
      });

      // Fan out chunks for the retry, same flow as createVerificationBatch.
      const { chunkCount } = planChunks(batch.totalCount);
      await redis.set(
        chunksRemainingKey(id),
        String(chunkCount),
        'EX',
        CHUNKS_REMAINING_TTL_SECONDS,
      );
      // Wipe the started-claim from the previous run so the first retry
      // chunk can re-mark RUNNING + publish PubSub.
      await redis.del(batchStartedKey(id));

      const priority = batchPriority(batch.totalCount);
      await Promise.all(
        Array.from({ length: chunkCount }, (_, chunkIndex) =>
          verificationQueue.add(
            'verify-email-chunk',
            { batchId: id, jobId: newJob.id, chunkIndex, chunkCount },
            { priority },
          ),
        ),
      );

      return serializeBatch(updated);
    },

    // ── Delete ──────────────────────────────────────────────────────────────
    deleteVerificationBatch: async (_: unknown, { id }: { id: string }) => {
      await prisma.emailVerificationBatch.delete({ where: { id } });
      return true;
    },
  },

  // ── Field resolvers ────────────────────────────────────────────────────────
  EmailVerificationBatch: {
    results: async (parent: { id: string }) => {
      const rows = await prisma.emailVerificationResult.findMany({
        where: { batchId: parent.id },
        orderBy: { verifiedAt: 'desc' },
        take: 200,
      });
      return rows.map(serializeResult);
    },
    validPct: (p: EmailVerificationBatch) => pct(p.validCount, p.totalCount),
    invalidPct: (p: EmailVerificationBatch) => pct(p.invalidCount, p.totalCount),
    riskyPct: (p: EmailVerificationBatch) => pct(p.riskyCount, p.totalCount),
    unknownPct: (p: EmailVerificationBatch) => pct(p.unknownCount, p.totalCount),
  },

  Subscription: {
    jobUpdated: {
      subscribe: (_: unknown, { batchId }: { batchId: string }) =>
        pubsub.asyncIterableIterator(`JOB_UPDATED_${batchId}`),
    },
  },
};
