/**
 * provider-throttle.ts
 *
 * Per-provider SMTP throttle limits. Major consumer mailbox providers have
 * very different tolerances for probe traffic — Gmail blocks aggressively,
 * corporate Postfix hosts don't care. Hard-coded limits below are tuned from
 * public guidance and conservative real-world testing. Adjust in one place.
 *
 * `maxConcurrent` — how many in-flight SMTP sessions this provider tolerates
 *                    per source IP.
 * `minDelayMs`    — minimum gap between successive connections to the same
 *                    provider, enforced as a sliding-window rate limit
 *                    (maxConcurrent acquires per minDelayMs*maxConcurrent window).
 * `maxPerHour`    — hard ceiling on connections per hour per source IP. Once
 *                    hit, further acquires block until the window slides.
 *
 * The throttler (redis-throttler.ts) groups domains into providers using
 * `resolveProvider(domain)` — many domains share a backend (e.g. anything on
 * Google Workspace MX → gmail limits).
 */

export interface ProviderLimits {
  /** Display name for logs/metrics */
  provider: string;
  /** Max simultaneous SMTP sessions this provider allows per IP */
  maxConcurrent: number;
  /** Minimum spacing between connection starts (ms) */
  minDelayMs: number;
  /** Hourly cap per IP */
  maxPerHour: number;
  /** Human-readable note — source or rationale */
  notes?: string;
}

export const DEFAULT_LIMITS: ProviderLimits = {
  provider: 'default',
  maxConcurrent: 3,
  minDelayMs: 100,
  maxPerHour: 1000,
  notes: 'Corporate / custom MX — permissive defaults',
};

/**
 * Keyed by provider identifier, not domain. `resolveProvider()` maps a
 * domain or its MX host to one of these keys.
 */
export const PROVIDER_LIMITS: Record<string, ProviderLimits> = {
  gmail: {
    provider: 'gmail',
    maxConcurrent: 1,
    minDelayMs: 1_000,
    maxPerHour: 60,
    notes: 'Strict — rapid probing triggers 421-4.7.0 for hours',
  },
  yahoo: {
    provider: 'yahoo',
    maxConcurrent: 2,
    minDelayMs: 500,
    maxPerHour: 200,
    notes: 'Catch-all by default, so RCPT probing gives limited signal',
  },
  aol: {
    provider: 'aol',
    maxConcurrent: 2,
    minDelayMs: 500,
    maxPerHour: 200,
    notes: 'Same backend as Yahoo (Oath / Verizon Media)',
  },
  hotmail: {
    provider: 'hotmail',
    maxConcurrent: 1,
    minDelayMs: 5_000,
    maxPerHour: 12,
    notes: 'Extremely aggressive — blocks IP after ~20 probes',
  },
  outlook: {
    provider: 'outlook',
    maxConcurrent: 1,
    minDelayMs: 5_000,
    maxPerHour: 12,
    notes: 'Microsoft Exchange Online — same policy as hotmail',
  },
  icloud: {
    provider: 'icloud',
    maxConcurrent: 1,
    minDelayMs: 2_000,
    maxPerHour: 30,
    notes: 'Apple Mail — moderately strict',
  },
  proton: {
    provider: 'proton',
    maxConcurrent: 1,
    minDelayMs: 1_000,
    maxPerHour: 50,
  },
};

/**
 * Domain → provider key map. MX-host-based resolution (below) catches
 * Google Workspace / Microsoft 365 tenants that use custom domains.
 */
const DOMAIN_MAP: Record<string, string> = {
  'gmail.com': 'gmail',
  'googlemail.com': 'gmail',
  'yahoo.com': 'yahoo',
  'yahoo.co.uk': 'yahoo',
  'yahoo.co.in': 'yahoo',
  'ymail.com': 'yahoo',
  'rocketmail.com': 'yahoo',
  'aol.com': 'aol',
  'hotmail.com': 'hotmail',
  'hotmail.co.uk': 'hotmail',
  'live.com': 'hotmail',
  'msn.com': 'hotmail',
  'outlook.com': 'outlook',
  'office365.com': 'outlook',
  'icloud.com': 'icloud',
  'me.com': 'icloud',
  'mac.com': 'icloud',
  'protonmail.com': 'proton',
  'proton.me': 'proton',
  'pm.me': 'proton',
};

const MX_PATTERNS: Array<{ pattern: RegExp; provider: string }> = [
  { pattern: /\.google(mail)?\.com\.?$/i, provider: 'gmail' },
  { pattern: /\.googlemail\.com\.?$/i, provider: 'gmail' },
  { pattern: /\.outlook\.com\.?$/i, provider: 'outlook' },
  { pattern: /\.protection\.outlook\.com\.?$/i, provider: 'outlook' },
  { pattern: /\.yahoodns\.net\.?$/i, provider: 'yahoo' },
  { pattern: /\.icloud\.com\.?$/i, provider: 'icloud' },
  { pattern: /\.protonmail\.ch\.?$/i, provider: 'proton' },
];

/**
 * Resolve a domain (and optional MX host) to a provider key used for
 * throttling. MX-based match takes precedence so that a custom domain
 * pointing at Google Workspace gets the gmail throttle.
 */
export function resolveProvider(domain: string, mxHost?: string | null): ProviderLimits {
  const lcDomain = domain.toLowerCase();
  const lcMx = mxHost?.toLowerCase();

  if (lcMx) {
    for (const { pattern, provider } of MX_PATTERNS) {
      if (pattern.test(lcMx) && PROVIDER_LIMITS[provider]) {
        return PROVIDER_LIMITS[provider];
      }
    }
  }

  const byDomain = DOMAIN_MAP[lcDomain];
  if (byDomain && PROVIDER_LIMITS[byDomain]) {
    return PROVIDER_LIMITS[byDomain];
  }

  return DEFAULT_LIMITS;
}

/**
 * Throttle bucket key — one bucket per (provider, sourceIp) pair.
 * Source IP defaults to 'default' until Phase C wires real IP rotation.
 */
export function throttleBucketKey(provider: string, sourceIp = 'default'): string {
  return `throttle:${provider}:${sourceIp}`;
}
