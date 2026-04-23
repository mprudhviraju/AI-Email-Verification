/**
 * worker.ts
 *
 * D1: Standalone entry point for the BullMQ verification worker.
 * Runs WITHOUT an HTTP server so it can be deployed as a separate scalable
 * container (or process) alongside the API container.
 *
 * Start:  pnpm --filter api dev:worker   (dev, tsx watch)
 *         node dist/worker.js            (production)
 *
 * Scale:  docker compose up --scale worker=4
 */

import 'node:process';
import dotenv from 'dotenv';
import { startWorker } from './workers/index.js';

dotenv.config();

const worker = startWorker();

console.log('⚙️  Verification worker started');

// Graceful shutdown on SIGTERM (Docker stop / k8s pod eviction).
process.on('SIGTERM', async () => {
  console.log('Worker received SIGTERM — draining in-flight jobs...');
  await worker.close();
  console.log('Worker shut down cleanly.');
  process.exit(0);
});
