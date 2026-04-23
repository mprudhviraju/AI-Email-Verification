/**
 * smtp-verifier.ts
 *
 * Industry-grade email verification engine.
 * Uses only Node.js built-in modules (net, tls, dns/promises, crypto).
 * No external npm packages — full control over every byte of the SMTP handshake.
 *
 * Verification tiers:
 *   1. Syntax + format (RFC 5322, unicode, role-based, disposable)
 *   2. DNS  (MX record lookup, A-record fallback)
 *   3. SMTP (live EHLO / MAIL FROM / RCPT TO handshake — never actually sends mail)
 *   4. Catch-all detection (probe with a random UUID address on the same domain)
 *   5. Composite score + confidence + status classification
 */

import * as net from 'node:net';
import * as tls from 'node:tls';
import { randomUUID } from 'node:crypto';
import { resolveMx, resolve4 } from 'node:dns/promises';
import { DISPOSABLE_DOMAINS } from './data/disposable-domains.js';
import { ROLE_PREFIXES } from './data/role-prefixes.js';
import { enrichEmail } from './enrichment.js';
import { cachedResolveMx } from './mx-cache.js';
import { redisThrottler } from './redis-throttler.js';
import { isKnownCatchAll, markCatchAll } from './catchall-cache.js';
import { getCachedResult, cacheResult } from './result-cache.js';
import { ipPool } from './ip-pool.js';
import { proxyPool, type ParsedProxy } from './proxy-pool.js';
import { resolveProvider } from './provider-throttle.js';
import { emailsVerifiedTotal, smtpDurationHistogram } from './metrics.js';
import { SocksClient } from 'socks';

// ── Public types ──────────────────────────────────────────────────────────────

export type EmailVerificationStatus =
  | 'VALID'
  | 'RISKY'
  | 'INVALID'
  | 'UNKNOWN'
  | 'CATCH_ALL'
  | 'DISPOSABLE'
  | 'ROLE_BASED';

export type VerificationConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface SmtpVerificationResult {
  email: string;
  domain: string;
  // Tier 1
  syntaxValid: boolean;
  isDisposable: boolean;
  isRoleBased: boolean;
  isUnicode: boolean;
  isHoneypot: boolean;
  // Tier 2
  mxFound: boolean;
  mxHost: string | null;
  mxFallback: boolean;
  dnsTtl: number | null;
  dnsResponseMs: number | null;
  // Tier 3
  smtpReachable: boolean;
  smtpCode: number | null;
  smtpMessage: string | null;
  isCatchAll: boolean;
  // Tier 4 — Enrichment
  gravatarFound: boolean;
  hibpBreachCount: number;
  // Tier 5
  status: EmailVerificationStatus;
  score: number;
  confidence: VerificationConfidence;
  responseTimeMs: number;
  errorMessage: string | null;
}

// ── Tier 1: Syntax ────────────────────────────────────────────────────────────

// RFC 5322-compatible regex (simplified but covers 99.9% of real addresses)
const EMAIL_REGEX = /^[^\s@"(),;<>[\]\\]+@[^\s@"(),;<>[\]\\]+\.[a-zA-Z\u00C0-\u024F]{2,}$/u;

export function validateSyntax(email: string): { valid: boolean; isUnicode: boolean } {
  const valid = EMAIL_REGEX.test(email) && !email.includes('..') && email.length <= 254;
  const isUnicode = /[^\x00-\x7F]/.test(email);
  return { valid, isUnicode };
}

export function isRoleBasedAddress(localPart: string): boolean {
  return ROLE_PREFIXES.includes(localPart.toLowerCase());
}

// Binary search — DISPOSABLE_DOMAINS is sorted alphabetically
export function isDisposableDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  let lo = 0;
  let hi = DISPOSABLE_DOMAINS.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const cmp = DISPOSABLE_DOMAINS[mid].localeCompare(d);
    if (cmp === 0) return true;
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

const HONEYPOT_PATTERNS = [
  /^(spam|trap|honeypot|spamtrap)/i,
  /^[a-z]{1,3}\d{6,}@/i,  // very short prefix + many digits
  /@(spamgourmet|spamtrap|spam\.)/i,
];

export function isHoneypotEmail(email: string): boolean {
  return HONEYPOT_PATTERNS.some((p) => p.test(email));
}

// ── Tier 2: DNS ───────────────────────────────────────────────────────────────

/**
 * Live MX lookup (no cache). Prefer `resolveMxWithFallback()` below so
 * repeated queries for the same domain hit Redis.
 */
async function resolveMxLive(domain: string): Promise<{
  hosts: string[];
  ttl: number | null;
  responseMs: number;
  usedFallback: boolean;
}> {
  const t0 = Date.now();
  try {
    const records = await resolveMx(domain);
    const responseMs = Date.now() - t0;
    if (records.length > 0) {
      records.sort((a, b) => a.priority - b.priority);
      return {
        hosts: records.map((r) => r.exchange),
        ttl: null, // Node's resolveMx does not expose TTL
        responseMs,
        usedFallback: false,
      };
    }
  } catch {
    // fall through to A-record fallback
  }

  // A-record fallback
  try {
    await resolve4(domain);
    return {
      hosts: [domain],
      ttl: null,
      responseMs: Date.now() - t0,
      usedFallback: true,
    };
  } catch {
    return { hosts: [], ttl: null, responseMs: Date.now() - t0, usedFallback: false };
  }
}

/**
 * Cached MX lookup — delegates to Redis (see mx-cache.ts). Positive results
 * live 24h, negatives 5min. On cache hit, `responseMs` is 0.
 */
export async function resolveMxWithFallback(domain: string): Promise<{
  hosts: string[];
  ttl: number | null;
  responseMs: number;
  usedFallback: boolean;
}> {
  const res = await cachedResolveMx(domain, resolveMxLive);
  // Strip the cacheHit flag — callers don't need it yet, and the public
  // signature stays stable.
  const { cacheHit: _cacheHit, ...rest } = res;
  void _cacheHit;
  return rest;
}

// ── Tier 3: SMTP session ──────────────────────────────────────────────────────

interface SmtpResponse {
  code: number;
  message: string;
  lines: string[];
}

const SMTP_TIMEOUT_MS = 12_000;
const PROBE_FROM = 'verify@mailcheck.internal';

/**
 * Low-level SMTP session wrapper.
 * Manages one TCP/TLS connection with line-buffered reading.
 */
class SmtpSession {
  private socket: net.Socket | null = null;
  private buffer = '';
  private resolveRead: ((r: SmtpResponse) => void) | null = null;
  private rejectRead: ((e: Error) => void) | null = null;

  async connect(
    host: string,
    port: number,
    timeoutMs = SMTP_TIMEOUT_MS,
    proxy?: ParsedProxy,   // F1: route through SOCKS5 proxy (takes precedence over localAddress)
    localAddress?: string, // C4: bind outbound connection to a specific source IP
  ): Promise<void> {
    if (proxy) {
      // F1: SOCKS5 proxy path.
      // SocksClient.createConnection() handles the full proxy handshake + destination
      // TCP connect before resolving. The returned socket is already connected, so
      // we call resolve() immediately after attaching listeners (no connect callback).
      const { socket } = await SocksClient.createConnection({
        proxy: {
          host: proxy.host,
          port: proxy.port,
          type: 5,
          userId: proxy.userId,
          password: proxy.password,
        },
        command: 'connect',
        destination: { host, port },
        timeout: timeoutMs,
      });
      this.socket = socket;
      socket.setTimeout(timeoutMs);
      socket.on('timeout', () => {
        socket.destroy(new Error(`SMTP connection timed out after ${timeoutMs}ms`));
      });
      socket.on('error', (err: Error) => {
        if (this.rejectRead) this.rejectRead(err);
      });
      socket.on('data', (chunk: Buffer) => this.onData(chunk.toString()));
      socket.on('close', () => {
        if (this.rejectRead) this.rejectRead(new Error('Connection closed unexpectedly'));
      });
      return;
    }

    // Direct connection path (C4 source IP binding or OS default).
    return new Promise((resolve, reject) => {
      // Only add localAddress to the options object when provided; passing
      // undefined would cause Node.js to treat it as an explicit binding to
      // the unspecified address, which is subtly different from omitting it.
      const connOpts: net.NetConnectOpts = localAddress
        ? { host, port, localAddress }
        : { host, port };
      const sock = net.createConnection(connOpts, () => resolve());
      sock.setTimeout(timeoutMs);
      sock.on('timeout', () => {
        sock.destroy(new Error(`SMTP connection timed out after ${timeoutMs}ms`));
      });
      sock.on('error', (err) => {
        if (this.rejectRead) this.rejectRead(err);
        reject(err);
      });
      sock.on('data', (chunk: Buffer) => this.onData(chunk.toString()));
      sock.on('close', () => {
        if (this.rejectRead) this.rejectRead(new Error('Connection closed unexpectedly'));
      });
      this.socket = sock;
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\r\n')) !== -1) {
      lines.push(this.buffer.slice(0, idx));
      this.buffer = this.buffer.slice(idx + 2);
    }
    if (lines.length === 0) return;

    // Collect all lines for this response (multi-line responses use "NNN-...")
    const responseParts: string[] = [];
    for (const line of lines) {
      responseParts.push(line);
    }

    // Only resolve when we see a "NNN " (space = final line) pattern
    const lastLine = responseParts[responseParts.length - 1];
    const match = lastLine.match(/^(\d{3}) /);
    if (!match && this.resolveRead) {
      // Still accumulating multi-line response — wait for more
      return;
    }

    if (this.resolveRead && match) {
      const code = parseInt(match[1], 10);
      const message = responseParts.map((l) => l.slice(4).trim()).join('\n');
      this.resolveRead({ code, message, lines: responseParts });
      this.resolveRead = null;
      this.rejectRead = null;
    }
  }

  /** Read the next complete SMTP response from the server. */
  read(timeoutMs = SMTP_TIMEOUT_MS): Promise<SmtpResponse> {
    return new Promise((resolve, reject) => {
      this.resolveRead = resolve;
      this.rejectRead = reject;
      setTimeout(() => {
        if (this.rejectRead) {
          this.rejectRead(new Error('Read timeout waiting for SMTP response'));
          this.resolveRead = null;
          this.rejectRead = null;
        }
      }, timeoutMs);
    });
  }

  /** Send a command and await the response. */
  async send(command: string): Promise<SmtpResponse> {
    if (!this.socket) throw new Error('Not connected');
    await new Promise<void>((res, rej) =>
      this.socket!.write(command + '\r\n', (err) => (err ? rej(err) : res())),
    );
    return this.read();
  }

  close(): void {
    try {
      this.socket?.write('QUIT\r\n');
      this.socket?.destroy();
    } catch {
      // ignore
    }
    this.socket = null;
  }
}

// ── Per-domain connection throttler ──────────────────────────────────────────
// Distributed throttle lives in `./redis-throttler.ts`. The exported
// `domainThrottler` is kept as an alias for the Redis-backed implementation
// so any legacy callers that still import this symbol keep working.

export { redisThrottler as domainThrottler } from './redis-throttler.js';

// ── IP block message detection ────────────────────────────────────────────────
//
// Some providers return 5xx codes at RCPT TO that look like address rejections
// but are actually IP-level reputation blocks. Without this check, valid
// addresses on blocked providers would be misclassified as INVALID.
//
// Covers known real-world patterns (Outlook/Hotmail Spamhaus, Yahoo TSS,
// generic RBL block messages). Conservative regexes — false negatives are safe
// (result stays UNKNOWN), false positives would lose an INVALID signal (bad),
// so patterns are anchored to specific provider messages.
const IP_BLOCK_PATTERNS: ReadonlyArray<RegExp> = [
  /spamhaus/i,                         // Outlook: "Client host blocked using Spamhaus"
  /\[TSS\w*\]/,                        // Yahoo:   "[TSS09] All messages from IP permanently deferred"
  /permanently deferred/i,             // Yahoo TSS
  /client host .{0,80} blocked/i,      // Outlook / generic Microsoft
  /sender ip .{0,60} blocked/i,        // Microsoft SMTP filters
  /blocked due to poor reputation/i,   // Sendgrid / generic reputation systems
  /too many connections from your ip/i,
  /your ip .{0,40} is blocked/i,
];

/** Returns true when an SMTP message text indicates an IP-level block rather
 *  than a per-address rejection. Used at RCPT TO to prevent misclassification. */
function isIpBlockMessage(message: string | null): boolean {
  if (!message) return false;
  return IP_BLOCK_PATTERNS.some((p) => p.test(message));
}

// ── SMTP verification core ────────────────────────────────────────────────────

async function trySmtpOnPort(
  email: string,
  mxHost: string,
  port: number,
  proxy?: ParsedProxy,    // F1: route through SOCKS5 proxy (undefined = direct)
  localAddress?: string, // C4: bind to this source IP (undefined = OS default)
): Promise<{
  reachable: boolean;
  code: number | null;
  message: string | null;
  isCatchAll: boolean;
  /** C3/F1: true when the SMTP server is rejecting at the IP/proxy level (not the
   *  address level). Used by performSmtpVerification to trigger a throttle
   *  cooldown on the source IP/proxy via recordOutcome('block'). */
  blockDetected: boolean;
}> {
  const session = new SmtpSession();

  try {
    // F1/C4: connect via proxy (if configured) or bind to source IP (if configured).
    await session.connect(mxHost, port, SMTP_TIMEOUT_MS, proxy, localAddress);

    // 1. Read banner
    const banner = await session.read();
    if (banner.code !== 220) {
      session.close();
      // Non-220 banner = server refused connection at IP level.
      // Return code: null so computeScore can't misclassify as INVALID.
      return { reachable: false, code: null, message: banner.message, isCatchAll: false, blockDetected: true };
    }

    // 2. EHLO
    const ehlo = await session.send('EHLO verifier.internal');
    if (ehlo.code !== 250) {
      // Try HELO fallback
      const helo = await session.send('HELO verifier.internal');
      if (helo.code !== 250) {
        session.close();
        return { reachable: false, code: helo.code, message: helo.message, isCatchAll: false, blockDetected: false };
      }
    }

    // 3. MAIL FROM
    const mailFrom = await session.send(`MAIL FROM:<${PROBE_FROM}>`);
    if (mailFrom.code !== 250) {
      session.close();
      // Rejection at MAIL FROM = IP-level sender policy block (e.g. Spamhaus,
      // Yahoo TSS). The 5xx code here reflects the IP reputation, not whether
      // the *address* exists. Null out the code so computeScore does not
      // misclassify valid addresses on blocked IPs as INVALID.
      return { reachable: false, code: null, message: mailFrom.message, isCatchAll: false, blockDetected: true };
    }

    // 4. RCPT TO — primary check
    const rcptTo = await session.send(`RCPT TO:<${email}>`);
    const primaryCode = rcptTo.code;
    const primaryMessage = rcptTo.message;

    // Detect IP-level blocks at RCPT TO:
    //   • 421 = temporary IP throttle (classic Hotmail/Outlook pattern)
    //   • 5xx with a known reputation-block message (Yahoo TSS, Spamhaus, etc.)
    //     These look like address rejections but are actually IP-level, so we
    //     null out the code to prevent INVALID misclassification.
    // Address-level rejections (550/551/553 "user does not exist") have generic
    // per-address messages that won't match IP_BLOCK_PATTERNS.
    const rcptIsIpBlock = primaryCode === 421 || isIpBlockMessage(primaryMessage);
    const blockDetected = rcptIsIpBlock;

    let isCatchAll = false;

    // 5. Catch-all probe — only if primary accepted
    if (!rcptIsIpBlock && (primaryCode === 250 || primaryCode === 251)) {
      const probeEmail = `${randomUUID()}@${email.split('@')[1]}`;
      const probe = await session.send(`RCPT TO:<${probeEmail}>`);
      if (probe.code === 250 || probe.code === 251) {
        isCatchAll = true;
      }
    }

    // 6. RSET + QUIT
    await session.send('RSET');
    session.close();

    return {
      // reachable: true only when the server gave a definitive per-address
      // response. IP blocks at RCPT TO are not address-level answers.
      reachable: !rcptIsIpBlock,
      code: rcptIsIpBlock ? null : primaryCode,
      message: primaryMessage,
      isCatchAll,
      blockDetected,
    };
  } catch (err) {
    session.close();
    throw err;
  }
}

export async function performSmtpVerification(
  email: string,
  mxHost: string,
  options?: {
    port?: number;
    timeoutMs?: number;
    /** F1: route the SMTP connection through this SOCKS5 proxy.
     *  Takes precedence over sourceIp when both are provided. */
    proxy?: ParsedProxy;
    /** C4: source IP to bind the outbound SMTP connection to.
     *  Passed through to `net.createConnection({ localAddress })`.
     *  Undefined = OS picks the interface (noop/dev behaviour). */
    sourceIp?: string;
  },
): Promise<{
  reachable: boolean;
  code: number | null;
  message: string | null;
  isCatchAll: boolean;
}> {
  const domain = email.split('@')[1]!;
  // F1/C4: use proxy id (if proxy active) or sourceIp as the per-connection bucket
  // discriminator for the Redis rate limiter. This ensures per-provider limits are
  // tracked correctly per outbound egress point (proxy or IP).
  const throttleBucket = options?.proxy
    ? `proxy:${options.proxy.id}`
    : options?.sourceIp;
  const release = await redisThrottler.acquireSlot(domain, mxHost, {
    sourceIp: throttleBucket,
  });

  // C3/F1: track the outcome so we can record it in the finally block regardless
  // of which exit path is taken (normal return, port fallthrough, or exception).
  let ipOutcome: 'ok' | 'fail' | 'block' | null = null;

  try {
    // Try port 25 first, then 587
    const ports = options?.port ? [options.port] : [25, 587];

    // D5: resolve the provider key once for metric labels.
    const providerKey = resolveProvider(domain, mxHost).provider;

    for (const port of ports) {
      // D5: start a histogram timer. The outcome label is set when we finish.
      const endTimer = smtpDurationHistogram.startTimer({ provider: providerKey, outcome: 'pending' });
      try {
        // F1/C4: route through proxy (if set) or bind to source IP (if set).
        const result = await trySmtpOnPort(email, mxHost, port, options?.proxy, options?.sourceIp);

        // Determine outcome from the SMTP protocol response.
        ipOutcome = result.blockDetected ? 'block' : result.reachable ? 'ok' : 'fail';
        endTimer({ outcome: ipOutcome });

        // Strip blockDetected — it is an internal implementation detail and
        // not part of the public return contract.
        const { blockDetected: _bd, ...publicResult } = result;
        void _bd;
        return publicResult;
      } catch (err) {
        endTimer({ outcome: 'fail' });
        const isConnRefused =
          err instanceof Error &&
          (err.message.includes('ECONNREFUSED') ||
            err.message.includes('ETIMEDOUT') ||
            err.message.includes('timed out'));

        if (isConnRefused && port !== ports[ports.length - 1]) {
          continue; // try next port
        }
        // Connection-level failure (not a protocol block) — mark as fail.
        ipOutcome = 'fail';
        throw err;
      }
    }

    // All ports refused with no SMTP-protocol response.
    ipOutcome = 'fail';
    return { reachable: false, code: null, message: 'All ports refused', isCatchAll: false };
  } finally {
    await release();
    // F1/C3: fire-and-forget health recording. recordOutcome is internally non-fatal.
    if (ipOutcome !== null) {
      if (options?.proxy) {
        void proxyPool.recordOutcome(options.proxy.id, ipOutcome);
      } else if (options?.sourceIp) {
        void ipPool.recordOutcome(options.sourceIp, ipOutcome);
      }
    }
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export function computeScore(result: Partial<SmtpVerificationResult>): {
  score: number;
  confidence: VerificationConfidence;
  status: EmailVerificationStatus;
} {
  let score = 0;

  if (result.syntaxValid) score += 20;
  if (result.mxFound) score += 20;
  if (result.smtpReachable && !result.isCatchAll && result.smtpCode === 250) score += 30;
  if (result.smtpCode === 250) score += 20;
  if (!result.isDisposable) score += 5;
  if (!result.isRoleBased) score += 5;

  // Tier 4 enrichment bonus — only meaningful for catch-all domains
  const enrichmentHits = (result.gravatarFound ? 1 : 0) + (result.hibpBreachCount ?? 0 > 0 ? 1 : 0);
  if (result.isCatchAll && enrichmentHits >= 1) score += 10;
  if (result.isCatchAll && enrichmentHits >= 2) score += 5;

  score = Math.min(100, score);

  // Confidence
  let confidence: VerificationConfidence = 'LOW';
  if (
    result.smtpReachable &&
    !result.isCatchAll &&
    (result.smtpCode === 250 || (result.smtpCode != null && result.smtpCode >= 550))
  ) {
    confidence = 'HIGH';
  } else if (result.isCatchAll && enrichmentHits >= 2) {
    confidence = 'HIGH';   // both Gravatar + HIBP hit → strong signal
  } else if (result.isCatchAll && enrichmentHits === 1) {
    confidence = 'MEDIUM'; // one signal hit
  } else if (result.mxFound) {
    confidence = 'MEDIUM';
  }

  // Status overrides (order matters)
  let status: EmailVerificationStatus;

  if (result.isDisposable) {
    status = 'DISPOSABLE';
  } else if (result.isCatchAll && enrichmentHits >= 1) {
    // Enrichment upgraded: we have positive evidence the address is real
    status = 'RISKY'; // can't be VALID without definitive SMTP, but likely real
  } else if (result.isCatchAll) {
    status = 'CATCH_ALL';
  } else if (
    result.smtpReachable &&        // only address-level rejections set reachable:true
    result.smtpCode != null &&
    [550, 551, 552, 553, 554].includes(result.smtpCode)
  ) {
    // smtpReachable:true + 5xx = definitive per-address rejection (mailbox
    // doesn't exist). IP-level blocks arrive with reachable:false + code:null
    // after the trySmtpOnPort fix, so they never reach this branch.
    status = 'INVALID';
  } else if (result.isRoleBased && score < 60) {
    status = 'ROLE_BASED';
  } else if (score >= 80) {
    status = 'VALID';
  } else if (score >= 50) {
    status = 'RISKY';
  } else {
    status = 'UNKNOWN';
  }

  return { score, confidence, status };
}

// ── Top-level orchestrator ────────────────────────────────────────────────────

export type VerificationStage = 'syntax' | 'dns' | 'smtp' | 'enrichment' | 'scoring';

export interface VerifyEmailOptions {
  onStageComplete?: (stage: VerificationStage) => void | Promise<void>;
}

export async function verifyEmail(
  email: string,
  opts: VerifyEmailOptions = {},
): Promise<SmtpVerificationResult> {
  const t0 = Date.now();
  const trimmed = email.trim().toLowerCase();
  const emit = async (stage: VerificationStage) => {
    if (opts.onStageComplete) {
      try { await opts.onStageComplete(stage); } catch { /* non-fatal */ }
    }
  };

  const atIdx = trimmed.indexOf('@');
  const localPart = atIdx !== -1 ? trimmed.slice(0, atIdx) : trimmed;
  const domain = atIdx !== -1 ? trimmed.slice(atIdx + 1) : '';

  const partial: Partial<SmtpVerificationResult> = {
    email: trimmed,
    domain,
    errorMessage: null,
  };

  // ── Tier 1: Syntax ──────────────────────────────────────────────────────────
  const { valid, isUnicode } = validateSyntax(trimmed);
  partial.syntaxValid = valid;
  partial.isUnicode = isUnicode;
  partial.isRoleBased = isRoleBasedAddress(localPart);
  partial.isDisposable = domain ? isDisposableDomain(domain) : false;
  partial.isHoneypot = isHoneypotEmail(trimmed);
  await emit('syntax');

  if (!valid || !domain) {
    const { score, confidence, status } = computeScore({ ...partial });
    return {
      ...partial,
      mxFound: false, mxHost: null, mxFallback: false,
      dnsTtl: null, dnsResponseMs: null,
      smtpReachable: false, smtpCode: null, smtpMessage: null, isCatchAll: false,
      gravatarFound: false, hibpBreachCount: 0,
      score, confidence, status,
      responseTimeMs: Date.now() - t0,
    } as SmtpVerificationResult;
  }

  // ── B6: Per-email result cache ──────────────────────────────────────────────
  // Syntax-valid path only. On hit, replay remaining stage events so the UI
  // progress bar still advances, then return the cached result unchanged.
  const cached = await getCachedResult(trimmed);
  if (cached) {
    await emit('dns');
    await emit('smtp');
    await emit('enrichment');
    return { ...cached, responseTimeMs: Date.now() - t0 };
  }

  // ── Tier 2: DNS ─────────────────────────────────────────────────────────────
  const dns = await resolveMxWithFallback(domain);
  partial.mxFound = dns.hosts.length > 0;
  partial.mxHost = dns.hosts[0] ?? null;
  partial.mxFallback = dns.usedFallback;
  partial.dnsTtl = dns.ttl;
  partial.dnsResponseMs = dns.responseMs;
  await emit('dns');

  if (!partial.mxFound) {
    const { score, confidence, status } = computeScore({ ...partial });
    return {
      ...partial,
      smtpReachable: false, smtpCode: null, smtpMessage: null, isCatchAll: false,
      gravatarFound: false, hibpBreachCount: 0,
      score, confidence, status,
      responseTimeMs: Date.now() - t0,
    } as SmtpVerificationResult;
  }

  // ── Tier 3: SMTP ────────────────────────────────────────────────────────────
  // B5: if the domain is already known catch-all, skip the live SMTP probe
  // entirely. We can't distinguish valid from invalid addresses under
  // catch-all anyway, so the probe would waste an SMTP slot for no new signal.
  // Enrichment (Tier 4) provides the per-address evidence in this case.
  const knownCatchAll = await isKnownCatchAll(domain);
  if (knownCatchAll) {
    partial.smtpReachable = true;
    partial.smtpCode = null;
    partial.smtpMessage = 'catch-all domain (cached, no live probe)';
    partial.isCatchAll = true;
  } else {
    try {
      // F1/C4: prefer proxy (SMTP_PROXY_LIST) → source IP (SMTP_SOURCE_IPS) → OS default.
      // Both pools return null in noop mode, so existing behaviour is preserved when
      // neither env var is configured (local dev default).
      const providerKey = resolveProvider(domain, partial.mxHost ?? undefined).provider;
      const proxy = await proxyPool.assignProxy(providerKey);
      const sourceIp = proxy ? null : await ipPool.assignIp(providerKey);

      const smtp = await performSmtpVerification(trimmed, partial.mxHost!, {
        proxy: proxy ?? undefined,
        sourceIp: sourceIp ?? undefined,
      });
      partial.smtpReachable = smtp.reachable;
      partial.smtpCode = smtp.code;
      partial.smtpMessage = smtp.message;
      partial.isCatchAll = smtp.isCatchAll;
      // B5 write: only positive hits are cached (domain-level fact).
      if (smtp.isCatchAll) markCatchAll(domain);
    } catch (err) {
      partial.smtpReachable = false;
      partial.smtpCode = null;
      partial.smtpMessage = null;
      partial.isCatchAll = false;
      partial.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }
  await emit('smtp');

  // ── Tier 4: Enrichment (Gravatar + HIBP) — only for catch-all domains ───────
  let gravatarFound = false;
  let hibpBreachCount = 0;
  if (partial.isCatchAll) {
    try {
      const enrichment = await enrichEmail(trimmed);
      gravatarFound = enrichment.gravatarFound;
      hibpBreachCount = enrichment.hibpBreachCount;
    } catch {
      // enrichment failure is non-fatal — continue with defaults
    }
  }
  partial.gravatarFound = gravatarFound;
  partial.hibpBreachCount = hibpBreachCount;
  await emit('enrichment');

  // ── Tier 5: Score ───────────────────────────────────────────────────────────
  const { score, confidence, status: rawStatus } = computeScore(partial);

  // Post-score override: if SMTP failed due to an IP-level block (not an
  // address-level rejection), the address itself is unverified — it could be
  // perfectly deliverable. Returning RISKY would mislead callers into thinking
  // the *address* is problematic when the issue is with our *sending IP*.
  // Downgrade to UNKNOWN and surface a human-readable error message.
  const ipBlocked =
    !partial.smtpReachable &&
    partial.smtpCode == null &&
    isIpBlockMessage(partial.smtpMessage ?? null);

  const status = ipBlocked && rawStatus === 'RISKY' ? 'UNKNOWN' : rawStatus;
  if (ipBlocked && !partial.errorMessage) {
    partial.errorMessage =
      'Outbound egress blocked by recipient mail server — address could not be verified. ' +
      'Rotate to a clean proxy or IP (see SMTP_PROXY_LIST / SMTP_SOURCE_IPS) to retry.';
  }

  const final: SmtpVerificationResult = {
    email: trimmed,
    domain,
    syntaxValid: partial.syntaxValid ?? false,
    isDisposable: partial.isDisposable ?? false,
    isRoleBased: partial.isRoleBased ?? false,
    isUnicode: partial.isUnicode ?? false,
    isHoneypot: partial.isHoneypot ?? false,
    mxFound: partial.mxFound ?? false,
    mxHost: partial.mxHost ?? null,
    mxFallback: partial.mxFallback ?? false,
    dnsTtl: partial.dnsTtl ?? null,
    dnsResponseMs: partial.dnsResponseMs ?? null,
    smtpReachable: partial.smtpReachable ?? false,
    smtpCode: partial.smtpCode ?? null,
    smtpMessage: partial.smtpMessage ?? null,
    isCatchAll: partial.isCatchAll ?? false,
    gravatarFound,
    hibpBreachCount,
    score,
    confidence,
    status,
    responseTimeMs: Date.now() - t0,
    errorMessage: partial.errorMessage ?? null,
  };

  // B6: persist to the per-email result cache (7d TTL). Transient failures
  // with a non-null errorMessage are skipped inside `cacheResult`.
  cacheResult(final);

  // D5: increment the verification counter with status + provider labels.
  // Resolved here (not in performSmtpVerification) so cache hits are also counted.
  const finalProviderKey = resolveProvider(domain, final.mxHost ?? undefined).provider;
  emailsVerifiedTotal.inc({ status: final.status, provider: finalProviderKey });

  return final;
}
