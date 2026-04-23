import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import express from 'express';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { createBullBoard } from '@bull-board/api';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — bull-board ships a CJS-only sub-path; TS can't resolve it in ESM mode
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { resolvers } from './resolvers/index.js';
import { buildContext, prisma } from './lib/context.js';
import { streamVerificationBatchCSV } from './lib/csv-export.js';
import { verifyToken, extractToken } from './lib/auth.js';
import { registry, queueDepthGauge } from './lib/metrics.js';
import { verificationQueue } from './lib/queue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const typeDefs = readFileSync(path.join(__dirname, 'schema.graphql'), 'utf-8');

const schema = makeExecutableSchema({ typeDefs, resolvers });

export async function startServer() {
  const app = express();
  const httpServer = createServer(app);

  // ── WebSocket server for GraphQL subscriptions ────────────────────────────
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql',
  });

  const wsCleanup = useServer(
    {
      schema,
      context: async (ctx) => {
        const token = (ctx.connectionParams?.['Authorization'] as string | undefined) ??
                      (ctx.connectionParams?.['authorization'] as string | undefined);
        const extracted = extractToken(token);
        let userId: string | null = null;
        if (extracted) {
          try { userId = verifyToken(extracted).sub; } catch { /* invalid */ }
        }
        return { prisma, userId };
      },
    },
    wsServer,
  );

  // ── Apollo Server ─────────────────────────────────────────────────────────
  const apollo = new ApolloServer({
    schema,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await wsCleanup.dispose();
            },
          };
        },
      },
    ],
  });

  await apollo.start();

  // ── CORS ─────────────────────────────────────────────────────────────────
  // F2: configurable CORS origins — set CORS_ORIGINS env var (comma-separated)
  // to add production domains (e.g. Amplify, custom domain) without code changes.
  const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  app.use(express.json({ limit: '20mb' }));

  app.use(
    '/graphql',
    expressMiddleware(apollo, {
      context: async ({ req }) =>
        buildContext({ headers: req.headers as Record<string, string | string[] | undefined> }),
    }),
  );

  // ── CSV export endpoint ───────────────────────────────────────────────────
  app.get('/export/batch/:batchId/csv', async (req, res) => {
    await streamVerificationBatchCSV(prisma, req.params['batchId']!, res);
  });

  // ── D5: BullMQ Board — queue dashboard ────────────────────────────────────
  const boardAdapter = new ExpressAdapter();
  boardAdapter.setBasePath('/admin/queues');
  createBullBoard({
    queues: [new BullMQAdapter(verificationQueue)],
    serverAdapter: boardAdapter,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use('/admin/queues', boardAdapter.getRouter() as any);

  // ── D5: Prometheus metrics endpoint ───────────────────────────────────────
  // Poll queue depth every 30 seconds so the gauge stays fresh without
  // adding per-request overhead.
  const queuePollInterval = setInterval(async () => {
    try {
      const counts = await verificationQueue.getJobCounts('waiting', 'active');
      queueDepthGauge.set((counts['waiting'] ?? 0) + (counts['active'] ?? 0));
    } catch {
      // Non-fatal — gauge just stays stale until next poll.
    }
  }, 30_000);
  // Unref so the interval doesn't prevent clean process exit.
  queuePollInterval.unref();

  app.get('/metrics', async (_req, res) => {
    try {
      res.set('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    } catch (err) {
      res.status(500).end(err instanceof Error ? err.message : 'metrics error');
    }
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  return { app, httpServer };
}
