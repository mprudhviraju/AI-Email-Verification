import { Worker } from 'bullmq';
import { redisConnection } from '../lib/queue.js';
import { prisma, pubsub } from '../lib/context.js';
import {
  handleVerifyEmailBatch,
  handleVerifyEmailChunk,
} from './verification.worker.js';
import type { ChunkJobData } from '../lib/batch-chunking.js';

export function startWorker(): Worker {
  const worker = new Worker(
    'verification-jobs',
    async (job) => {
      switch (job.name) {
        case 'verify-email-chunk':
          return handleVerifyEmailChunk(job.data as ChunkJobData, prisma, pubsub);

        // Legacy path for jobs enqueued before B3. Safe to remove after a
        // drain window.
        case 'verify-email-batch':
          return handleVerifyEmailBatch(
            job.data as { batchId: string; jobId: string },
            prisma,
            pubsub,
          );

        default:
          throw new Error(`Unknown job type: ${job.name}`);
      }
    },
    {
      connection: redisConnection,
      // B3: multiple chunks run in parallel per worker process. Each chunk
      // still uses its own internal semaphore (global concurrency 8) + the
      // Redis-backed per-provider throttler, so raising this primarily buys
      // pipeline utilization across chunks with different domain mixes.
      concurrency: 4,
    },
  );

  worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
