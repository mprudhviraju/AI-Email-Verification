/**
 * metrics.ts
 *
 * D5: Prometheus metrics registry and named metrics for the email verifier.
 *
 * All metrics are registered on a dedicated Registry (not the default global
 * one) so test environments can import this module without polluting the
 * default process metrics.
 *
 * Endpoints:
 *   GET /metrics        → Prometheus scrape endpoint (text/plain)
 *   /admin/queues       → BullMQ Board dashboard (wired in server.ts)
 */

import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from 'prom-client';

export const registry = new Registry();

// ── Default Node.js metrics (event-loop lag, GC, memory, etc.) ────────────────
collectDefaultMetrics({ register: registry });

// ── Email verification metrics ─────────────────────────────────────────────────

/**
 * Total emails verified, broken down by final status and email provider.
 *
 * Labels:
 *   status   — VALID | INVALID | RISKY | UNKNOWN | CATCH_ALL | DISPOSABLE | ROLE_BASED
 *   provider — gmail | yahoo | hotmail | outlook | icloud | protonmail | default | …
 */
export const emailsVerifiedTotal = new Counter({
  name:       'emails_verified_total',
  help:       'Total emails verified, labelled by status and email provider',
  labelNames: ['status', 'provider'],
  registers:  [registry],
});

/**
 * SMTP handshake round-trip duration per provider and outcome.
 * Observe only when an actual SMTP session ran (not cache hits).
 *
 * Labels:
 *   provider — same as emailsVerifiedTotal
 *   outcome  — ok | fail | block
 *
 * Buckets chosen to cover the typical 100ms–20s SMTP range.
 */
export const smtpDurationHistogram = new Histogram({
  name:       'smtp_duration_ms',
  help:       'SMTP verification round-trip duration in milliseconds',
  labelNames: ['provider', 'outcome'],
  buckets:    [100, 500, 1_000, 3_000, 5_000, 10_000, 20_000],
  registers:  [registry],
});

/**
 * Current number of jobs waiting + active in the verification queue.
 * Updated every 30 seconds by a setInterval in server.ts.
 */
export const queueDepthGauge = new Gauge({
  name:      'verification_queue_depth',
  help:      'Number of jobs currently waiting or active in the verification queue',
  registers: [registry],
});

/**
 * Cumulative IP-level SMTP blocks per source address.
 * Incremented by ip-pool.ts whenever a 'block' outcome is recorded.
 *
 * Labels:
 *   ip — the source IP address that was blocked
 */
export const ipBlocksTotal = new Counter({
  name:       'ip_blocks_total',
  help:       'Cumulative IP-level SMTP blocks per source address',
  labelNames: ['ip'],
  registers:  [registry],
});
