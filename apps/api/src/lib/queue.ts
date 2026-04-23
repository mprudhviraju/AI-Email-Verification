import { Queue } from 'bullmq';
import { redis } from './redis.js';

// Re-export the shared client under its historical name so BullMQ
// worker initializers that import `redisConnection` keep working.
export const redisConnection = redis;

export const verificationQueue = new Queue('verification-jobs', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
