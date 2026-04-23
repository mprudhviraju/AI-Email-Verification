/**
 * verification.worker.ts
 *
 * BullMQ chunk handler for bulk email verification. Each job processes a
 * deterministic slice of `CHUNK_SIZE` result rows from one batch. Multiple
 * chunks can run in parallel (worker `concurrency` setting controls how many
 * per process; horizontal scaling adds more processes).
 *
 * Lifecycle (coordinated via Redis — see lib/batch-chunking.ts):
 *   1. First chunk to execute: SETNX `batch:{id}:started` wins → flip DB
 *      Job/Batch to RUNNING and publish the initial JOB_UPDATED event.
 *   2. Every chunk: process its slice (skipping rows already past UNKNOWN,
 *      which makes retries idempotent).
 *   3. On exit (success OR failure): DECR `batch:{id}:chunks-remaining`.
 *      Whoever DECRs to 0 finalizes the batch (DONE unless the counter hit
 *      0 via a failure path, in which case the catch block already flipped
 *      it to FAILED).
 *
 * Why we DECR on failure too: otherwise a single permanently-failed chunk
 * would strand the batch at "RUNNING" forever. By decrementing we allow the
 * remaining chunks to still reach the finalize step. Rows the failed chunk
 * never touched stay UNKNOWN — visible via the status counters.
 */

import type { PrismaClient } from '@prisma/client';
import type { PubSub } from 'graphql-subscriptions';
import { verifyEmail } from '../lib/smtp-verifier.js';
import { redis } from '../lib/redis.js';
import {
  CHUNK_SIZE,
  chunksRemainingKey,
  batchStartedKey,
  STARTED_TTL_SECONDS,
  COUNTER_FLUSH_INTERVAL,
  type ChunkJobData,
} from '../lib/batch-chunking.js';

const GLOBAL_CONCURRENCY = 8;
const MAX_RETRIES = 2;

// Lightweight counting semaphore (no extra package)
function createSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function acquire(): Promise<() => void> {
    if (active < limit) {
      active++;
      return Promise.resolve(release);
    }
    return new Promise((resolve) => {
      queue.push(() => {
        active++;
        resolve(release);
      });
    });
  }

  function release() {
    active--;
    const next = queue.shift();
    if (next) next();
  }

  return { acquire };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * B7 — counter accumulator. Collapses many per-row
 * `emailVerificationBatch.update({ increment: 1 })` writes into one batched
 * UPDATE every `COUNTER_FLUSH_INTERVAL` completed emails (and once more at
 * chunk exit). At 1,000 emails/chunk and a 50-email flush window, this goes
 * from 1,000 writes on the hot batch row down to ~20 — same result, ~50×
 * less DB contention under parallel-chunk load.
 *
 * JS is single-threaded between awaits, so `bump()` is atomic. `flush()`
 * snapshot-then-resets `pending` before awaiting the DB write — bumps that
 * arrive during the await accumulate into the next flush cleanly.
 */
type CounterKey =
  | 'completedCount'
  | 'validCount'
  | 'invalidCount'
  | 'riskyCount'
  | 'unknownCount'
  | 'syntaxDone'
  | 'dnsDone'
  | 'smtpDone'
  | 'enrichmentDone';

function createCounterAccumulator(prisma: PrismaClient, batchId: string) {
  const pending: Record<CounterKey, number> = {
    completedCount: 0,
    validCount: 0,
    invalidCount: 0,
    riskyCount: 0,
    unknownCount: 0,
    syntaxDone: 0,
    dnsDone: 0,
    smtpDone: 0,
    enrichmentDone: 0,
  };
  let pendingStage: string | null = null;
  let sinceLastFlush = 0;

  function bump(delta: Partial<Record<CounterKey, number>>) {
    for (const [k, v] of Object.entries(delta) as [CounterKey, number][]) {
      pending[k] += v;
    }
  }

  function setStage(stage: string) {
    pendingStage = stage;
  }

  async function flush() {
    // Snapshot + reset so bumps arriving during the DB await don't get lost.
    const snapshot = { ...pending };
    for (const k of Object.keys(pending) as CounterKey[]) pending[k] = 0;
    const stageSnapshot = pendingStage;
    pendingStage = null;
    sinceLastFlush = 0;

    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(snapshot)) {
      if (v > 0) data[k] = { increment: v };
    }
    if (stageSnapshot) data['currentStage'] = stageSnapshot;
    if (Object.keys(data).length === 0) return;

    try {
      await prisma.emailVerificationBatch.update({
        where: { id: batchId },
        data,
      });
    } catch {
      /* non-fatal — next flush carries forward accumulated state */
    }
  }

  /** Increment the "emails processed since last flush" counter and flush
   *  if we've crossed the threshold. Pass 1 when an email fully completes. */
  async function noteProgress(n = 1) {
    sinceLastFlush += n;
    if (sinceLastFlush >= COUNTER_FLUSH_INTERVAL) {
      await flush();
    }
  }

  return { bump, setStage, flush, noteProgress };
}

/**
 * Main chunk handler. `chunkIndex` in [0, chunkCount). Idempotent across
 * retries — rows not in UNKNOWN are skipped.
 */
export async function handleVerifyEmailChunk(
  jobData: ChunkJobData,
  prisma: PrismaClient,
  pubsub: PubSub,
): Promise<void> {
  const { batchId, jobId, chunkIndex } = jobData;

  // ── Step 1: first-chunk-wins flip to RUNNING ─────────────────────────────
  // SETNX semantics via ioredis: `NX` returns 'OK' iff the key didn't exist.
  const claimed = await redis.set(
    batchStartedKey(batchId),
    '1',
    'EX',
    STARTED_TTL_SECONDS,
    'NX',
  );
  if (claimed === 'OK') {
    await Promise.all([
      prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING' } }),
      prisma.emailVerificationBatch.update({
        where: { id: batchId },
        data: { status: 'RUNNING' },
      }),
    ]);
    pubsub.publish(`JOB_UPDATED_${batchId}`, {
      jobUpdated: {
        id: jobId,
        status: 'RUNNING',
        error: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    });
  }

  let chunkFailed = false;

  // B7 — per-chunk counter accumulator. See `createCounterAccumulator` above.
  const counters = createCounterAccumulator(prisma, batchId);

  try {
    // ── Step 2: load this chunk's deterministic slice ──────────────────────
    // No status filter — ordering + (skip, take) gives us the same slice on
    // retries. We filter UNKNOWN per-row inside the loop so already-processed
    // rows from a prior attempt are skipped.
    const slice = await prisma.emailVerificationResult.findMany({
      where: { batchId },
      orderBy: { id: 'asc' },
      skip: chunkIndex * CHUNK_SIZE,
      take: CHUNK_SIZE,
      select: { id: true, email: true, status: true },
    });

    const semaphore = createSemaphore(GLOBAL_CONCURRENCY);

    await Promise.all(
      slice.map(async (row) => {
        // Idempotent retry: skip anything we already verified.
        if (row.status !== 'UNKNOWN') return;

        const release = await semaphore.acquire();
        try {
          let result = null;
          let lastError: Error | null = null;

          // Per-stage counter updates. Deduped per-attempt so SMTP retries
          // don't double-count.
          const stageHit = new Set<string>();
          const stageFieldMap: Record<
            string,
            'syntaxDone' | 'dnsDone' | 'smtpDone' | 'enrichmentDone'
          > = {
            syntax: 'syntaxDone',
            dns: 'dnsDone',
            smtp: 'smtpDone',
            enrichment: 'enrichmentDone',
          };

          function onStageComplete(stage: string) {
            if (stageHit.has(stage)) return;
            stageHit.add(stage);
            const field = stageFieldMap[stage];
            if (!field) return;
            // B7 — accumulate instead of per-call UPDATE. The next flush
            // (triggered by completed-email threshold or chunk exit) writes
            // the latest `currentStage` stamp alongside counter deltas.
            counters.bump({ [field]: 1 });
            counters.setStage(stage);
            pubsub.publish(`JOB_UPDATED_${batchId}`, {
              jobUpdated: {
                id: jobId,
                status: 'RUNNING',
                error: null,
                createdAt: nowIso(),
                updatedAt: nowIso(),
              },
            });
          }

          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
              result = await verifyEmail(row.email, { onStageComplete });
              break;
            } catch (err) {
              lastError = err instanceof Error ? err : new Error(String(err));
              if (attempt < MAX_RETRIES) await sleep(1000 * Math.pow(2, attempt));
            }
          }

          if (result) {
            await prisma.emailVerificationResult.update({
              where: { id: row.id },
              data: {
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
                verifiedAt: new Date(),
              },
            });

            const statusField = getStatusCountField(result.status);
            counters.bump({
              completedCount: 1,
              ...(statusField ? { [statusField]: 1 } : {}),
            });
          } else {
            await prisma.emailVerificationResult.update({
              where: { id: row.id },
              data: {
                status: 'UNKNOWN',
                errorMessage: lastError?.message ?? 'Verification failed after retries',
              },
            });
            counters.bump({ completedCount: 1, unknownCount: 1 });
          }

          // B7 — maybe-flush after each fully-processed email; fires only
          // once every COUNTER_FLUSH_INTERVAL completions.
          await counters.noteProgress(1);

          pubsub.publish(`JOB_UPDATED_${batchId}`, {
            jobUpdated: {
              id: jobId,
              status: 'RUNNING',
              error: null,
              createdAt: nowIso(),
              updatedAt: nowIso(),
            },
          });
        } finally {
          release();
        }
      }),
    );

  } catch (err) {
    // Mark the overall batch FAILED on any uncaught chunk error. Individual
    // email failures are absorbed into per-row UNKNOWN above; reaching this
    // catch means something structural broke (DB down, etc.).
    chunkFailed = true;
    const errorMsg = err instanceof Error ? err.message : String(err);
    try {
      await Promise.all([
        prisma.job.update({
          where: { id: jobId },
          data: { status: 'FAILED', error: errorMsg },
        }),
        prisma.emailVerificationBatch.update({
          where: { id: batchId },
          data: { status: 'FAILED' },
        }),
      ]);
      pubsub.publish(`JOB_UPDATED_${batchId}`, {
        jobUpdated: {
          id: jobId,
          status: 'FAILED',
          error: errorMsg,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
      });
    } catch {
      /* best-effort */
    }
    // Still DECR below (finally) and rethrow so BullMQ records the failure.
    throw err;
  } finally {
    // B7 — flush any remaining accumulated counter deltas BEFORE we DECR the
    // chunks-remaining counter. Ordering matters: if we DECR first and this
    // chunk happens to be the one that finalizes the batch (remaining===0),
    // the finalize block will flip status to DONE — but the batch row would
    // still be carrying up to COUNTER_FLUSH_INTERVAL-1 un-flushed deltas,
    // leaving `completedCount` < `totalCount` at finalize time.
    await counters.flush();

    // ── Step 3: DECR the remaining counter; finalize if we hit 0 ───────────
    // We always DECR — success or failure — so one bad chunk can't strand
    // the batch.
    let remaining: number | null = null;
    try {
      remaining = await redis.decr(chunksRemainingKey(batchId));
    } catch {
      /* if Redis is down we can't finalize here; a later chunk will */
    }

    if (remaining !== null && remaining <= 0 && !chunkFailed) {
      try {
        await Promise.all([
          prisma.job.update({
            where: { id: jobId },
            data: { status: 'DONE' },
          }),
          prisma.emailVerificationBatch.update({
            where: { id: batchId },
            data: { status: 'DONE', completedAt: new Date(), currentStage: null },
          }),
        ]);
        pubsub.publish(`JOB_UPDATED_${batchId}`, {
          jobUpdated: {
            id: jobId,
            status: 'DONE',
            error: null,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          },
        });
      } catch {
        /* best-effort — a retry of any chunk will eventually re-DECR-to-0 */
      }

      // Cleanup coordination keys once we know the batch is settled.
      redis.del(chunksRemainingKey(batchId)).catch(() => {});
      redis.del(batchStartedKey(batchId)).catch(() => {});
    }
  }
}

/**
 * Back-compat alias for any in-flight `verify-email-batch` jobs enqueued by
 * the pre-B3 resolver. Treat them as a single chunk covering the whole
 * batch. Safe to delete after a drain window (no new jobs with this name
 * will ever be enqueued).
 */
export async function handleVerifyEmailBatch(
  jobData: { batchId: string; jobId: string },
  prisma: PrismaClient,
  pubsub: PubSub,
): Promise<void> {
  // Seed the counter so the DECR path finalizes correctly.
  await redis.set(
    chunksRemainingKey(jobData.batchId),
    '1',
    'EX',
    60 * 60,
  );
  return handleVerifyEmailChunk(
    { ...jobData, chunkIndex: 0, chunkCount: 1 },
    prisma,
    pubsub,
  );
}

function getStatusCountField(
  status: string,
): 'validCount' | 'invalidCount' | 'riskyCount' | 'unknownCount' | null {
  switch (status) {
    case 'VALID': return 'validCount';
    case 'INVALID': return 'invalidCount';
    case 'RISKY': return 'riskyCount';
    case 'UNKNOWN':
    case 'CATCH_ALL':
    case 'DISPOSABLE':
    case 'ROLE_BASED':
      return 'unknownCount';
    default: return null;
  }
}
