/**
 * enrichment.ts
 *
 * Tier 4 enrichment for catch-all domains (Yahoo, AOL, etc.) where SMTP cannot
 * definitively verify individual addresses.
 *
 * Two probes:
 *   1. Gravatar  — MD5 hash lookup on public Gravatar API (free, no key)
 *   2. HIBP      — HaveIBeenPwned breach account lookup (free API key optional)
 *
 * A positive hit on either probe upgrades confidence from LOW → MEDIUM/HIGH
 * and status from CATCH_ALL → RISKY (likely real address).
 */

import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

const GRAVATAR_TIMEOUT_MS = 5_000;
const HIBP_TIMEOUT_MS     = 8_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function md5(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

function httpGet(url: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const requester = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = requester(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// ── Gravatar probe ────────────────────────────────────────────────────────────

/**
 * Returns true if the email has a Gravatar profile.
 * Uses ?d=404 so non-existent hashes return HTTP 404 instead of a default image.
 */
export async function probeGravatar(email: string): Promise<boolean> {
  try {
    const hash = md5(email.trim().toLowerCase());
    const url = `https://www.gravatar.com/avatar/${hash}?d=404&s=1`;
    const { status } = await httpGet(url, {
      'User-Agent': 'email-verifier/1.0',
    }, GRAVATAR_TIMEOUT_MS);
    return status === 200;
  } catch {
    return false; // timeout or network error → inconclusive
  }
}

// ── HIBP probe ────────────────────────────────────────────────────────────────

/**
 * Returns the number of data breaches the email appeared in.
 * 0   = not found in HIBP (inconclusive — could still be valid)
 * > 0 = email definitely existed / was active at some point
 *
 * HIBP requires a "hibp-api-key" header for the breachedaccount endpoint.
 * If no key is configured we fall back to the free passwordpwned endpoint
 * which only checks passwords — so we skip and return 0.
 *
 * Set HIBP_API_KEY in .env to unlock full breach lookups.
 */
export async function probeHibp(email: string): Promise<number> {
  const apiKey = process.env['HIBP_API_KEY'];
  if (!apiKey) return 0;

  try {
    const encoded = encodeURIComponent(email);
    const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encoded}?truncateResponse=true`;
    const { status, body } = await httpGet(url, {
      'hibp-api-key': apiKey,
      'User-Agent': 'email-verifier/1.0',
    }, HIBP_TIMEOUT_MS);

    if (status === 200) {
      try {
        const breaches = JSON.parse(body) as unknown[];
        return Array.isArray(breaches) ? breaches.length : 0;
      } catch {
        return 0;
      }
    }
    if (status === 404) return 0; // not found
    return 0; // 429 rate-limit or other error → inconclusive
  } catch {
    return 0;
  }
}

// ── Combined enrichment ───────────────────────────────────────────────────────

export interface EnrichmentResult {
  gravatarFound: boolean;
  hibpBreachCount: number;
}

/**
 * Run Gravatar + HIBP probes in parallel.
 * Should only be called for catch-all domains where SMTP is non-definitive.
 */
export async function enrichEmail(email: string): Promise<EnrichmentResult> {
  const [gravatarFound, hibpBreachCount] = await Promise.all([
    probeGravatar(email),
    probeHibp(email),
  ]);
  return { gravatarFound, hibpBreachCount };
}
