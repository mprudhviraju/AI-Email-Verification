/**
 * batch-chunking.ts
 *
 * B3 — fan out every verification batch into N BullMQ chunk jobs so multiple
 * chunks can run in parallel (across worker slots today, across pods after
 * D1). Each chunk owns a deterministic slice of the batch's result rows.
 *
 * Design notes:
 *   - Chunking lives entirely at the BullMQ layer. The DB `Job` row stays
 *     the aggregate status tracker — one per batch — so no Prisma migration.
 *   - Always chunk (even 100 emails = 1 chunk) to keep the code path uniform
 *     and remove conditional branches in the worker.
 *   - Two Redis keys coordinate lifecycle:
 *       batch:{id}:started           — SETNX claim: first chunk marks RUNNING
 *       batch:{id}:chunks-remaining  — DECR on exit: whoever hits 0 finalizes
 *     TTLs (1h/2h) are generous safety nets; happy-path deletes aren't needed
 *     since Redis will reap them.
 *   - Retry semantics: a chunk that fails permanently still DECRs the
 *     counter so the batch can finalize. Rows it never touched stay UNKNOWN
 *     and surface through the status counters.
 */

export const CHUNK_SIZE = Number(process.env.BATCH_CHUNK_SIZE ?? 1000);

/**
 * B7 — size of each `createMany` pre-insert call. Splitting the initial
 * 50k-row pre-insert into smaller transactions avoids a single long lock
 * on `EmailVerificationResult` and keeps mutation latency bounded as list
 * size grows.
 */
export const RESULT_INSERT_CHUNK_SIZE = Number(
  process.env.RESULT_INSERT_CHUNK_SIZE ?? 500,
);

/**
 * B7 — how many processed emails the worker accumulates locally before
 * flushing batch counters to Postgres. The tradeoff: larger = fewer writes
 * on the hot batch row; smaller = fresher UI counters (UI polls every 3s
 * so values > ~100 start to feel laggy on small batches).
 */
export const COUNTER_FLUSH_INTERVAL = Number(
  process.env.COUNTER_FLUSH_INTERVAL ?? 50,
);

export interface ChunkPlan {
  chunkCount: number;
  chunkSize: number;
}

/** Compute how many chunks a batch of `total` emails splits into. Always ≥ 1. */
export function planChunks(total: number): ChunkPlan {
  const chunkCount = Math.max(1, Math.ceil(total / CHUNK_SIZE));
  return { chunkCount, chunkSize: CHUNK_SIZE };
}

/** Redis key: remaining-chunk counter. Decremented as each chunk finishes. */
export function chunksRemainingKey(batchId: string): string {
  return `batch:${batchId}:chunks-remaining`;
}

/** Redis key: first-chunk claim. SETNX target so only one chunk marks RUNNING. */
export function batchStartedKey(batchId: string): string {
  return `batch:${batchId}:started`;
}

/** Seconds. The started-claim outlives a typical batch run; 1h is plenty. */
export const STARTED_TTL_SECONDS = 60 * 60;

/** Seconds. Safety net if all chunks crash before DECRing — 2h then reap. */
export const CHUNKS_REMAINING_TTL_SECONDS = 2 * 60 * 60;

export interface ChunkJobData {
  batchId: string;
  jobId: string;
  chunkIndex: number;
  chunkCount: number;
}
