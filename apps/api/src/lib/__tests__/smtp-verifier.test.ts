import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateSyntax,
  isRoleBasedAddress,
  isDisposableDomain,
  isHoneypotEmail,
  computeScore,
  resolveMxWithFallback,
  performSmtpVerification,
} from '../smtp-verifier.js';

// ── Tier 1: Syntax ────────────────────────────────────────────────────────────

describe('validateSyntax', () => {
  it('accepts a valid standard email', () => {
    expect(validateSyntax('user@example.com').valid).toBe(true);
  });

  it('accepts email with plus-addressing', () => {
    expect(validateSyntax('user+tag@example.com').valid).toBe(true);
  });

  it('rejects email missing @', () => {
    expect(validateSyntax('notanemail').valid).toBe(false);
  });

  it('rejects email with double dot in local part', () => {
    expect(validateSyntax('user..name@example.com').valid).toBe(false);
  });

  it('rejects email that is too long (>254 chars)', () => {
    const long = 'a'.repeat(250) + '@x.com';
    expect(validateSyntax(long).valid).toBe(false);
  });

  it('rejects email with no domain TLD', () => {
    expect(validateSyntax('user@localhost').valid).toBe(false);
  });

  it('detects unicode in local part', () => {
    expect(validateSyntax('üser@example.com').isUnicode).toBe(true);
  });

  it('detects unicode domain (IDN)', () => {
    expect(validateSyntax('user@münchen.de').isUnicode).toBe(true);
  });

  it('returns isUnicode=false for ASCII-only email', () => {
    expect(validateSyntax('hello@world.com').isUnicode).toBe(false);
  });
});

describe('isRoleBasedAddress', () => {
  it('returns true for "admin"', () => {
    expect(isRoleBasedAddress('admin')).toBe(true);
  });

  it('returns true for "noreply"', () => {
    expect(isRoleBasedAddress('noreply')).toBe(true);
  });

  it('returns true for "no-reply"', () => {
    expect(isRoleBasedAddress('no-reply')).toBe(true);
  });

  it('returns true for "support"', () => {
    expect(isRoleBasedAddress('support')).toBe(true);
  });

  it('returns false for a first name', () => {
    expect(isRoleBasedAddress('james')).toBe(false);
  });

  it('returns false for random token', () => {
    expect(isRoleBasedAddress('xk9q23')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isRoleBasedAddress('ADMIN')).toBe(true);
  });
});

describe('isDisposableDomain', () => {
  it('returns true for mailinator.com', () => {
    expect(isDisposableDomain('mailinator.com')).toBe(true);
  });

  it('returns true for guerrillamail.com', () => {
    expect(isDisposableDomain('guerrillamail.com')).toBe(true);
  });

  it('returns true for 0815.ru', () => {
    expect(isDisposableDomain('0815.ru')).toBe(true);
  });

  it('returns false for gmail.com', () => {
    expect(isDisposableDomain('gmail.com')).toBe(false);
  });

  it('returns false for company.io', () => {
    expect(isDisposableDomain('company.io')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isDisposableDomain('MAILINATOR.COM')).toBe(true);
  });
});

describe('isHoneypotEmail', () => {
  it('returns true for emails starting with "spam"', () => {
    expect(isHoneypotEmail('spam123@example.com')).toBe(true);
  });

  it('returns true for emails starting with "trap"', () => {
    expect(isHoneypotEmail('trap@example.com')).toBe(true);
  });

  it('returns true for short prefix + many digits', () => {
    expect(isHoneypotEmail('ab12345678@example.com')).toBe(true);
  });

  it('returns false for a normal email', () => {
    expect(isHoneypotEmail('john.doe@company.com')).toBe(false);
  });
});

// ── Tier 2: DNS ───────────────────────────────────────────────────────────────

vi.mock('node:dns/promises', () => ({
  resolveMx: vi.fn(),
  resolve4: vi.fn(),
}));

describe('resolveMxWithFallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns sorted MX hosts when MX records exist', async () => {
    const { resolveMx } = await import('node:dns/promises');
    vi.mocked(resolveMx).mockResolvedValue([
      { exchange: 'mx2.example.com', priority: 20 },
      { exchange: 'mx1.example.com', priority: 10 },
    ]);

    const result = await resolveMxWithFallback('example.com');
    expect(result.hosts[0]).toBe('mx1.example.com');
    expect(result.usedFallback).toBe(false);
  });

  it('falls back to A record when no MX records exist', async () => {
    const { resolveMx, resolve4 } = await import('node:dns/promises');
    vi.mocked(resolveMx).mockResolvedValue([]);
    vi.mocked(resolve4).mockResolvedValue(['1.2.3.4'] as never);

    const result = await resolveMxWithFallback('example.com');
    expect(result.hosts[0]).toBe('example.com');
    expect(result.usedFallback).toBe(true);
  });

  it('returns empty hosts array on NXDOMAIN', async () => {
    const { resolveMx, resolve4 } = await import('node:dns/promises');
    vi.mocked(resolveMx).mockRejectedValue(new Error('NXDOMAIN'));
    vi.mocked(resolve4).mockRejectedValue(new Error('NXDOMAIN'));

    const result = await resolveMxWithFallback('doesnotexist.invalid');
    expect(result.hosts).toHaveLength(0);
  });
});

// ── Tier 5: Score + Status ────────────────────────────────────────────────────

describe('computeScore', () => {
  it('gives maximum score to a fully valid email', () => {
    const { score, status, confidence } = computeScore({
      syntaxValid: true,
      mxFound: true,
      smtpReachable: true,
      smtpCode: 250,
      isCatchAll: false,
      isDisposable: false,
      isRoleBased: false,
    });
    expect(score).toBe(100);
    expect(status).toBe('VALID');
    expect(confidence).toBe('HIGH');
  });

  it('assigns INVALID when SMTP returns 550', () => {
    const { status } = computeScore({
      syntaxValid: true,
      mxFound: true,
      smtpReachable: true,
      smtpCode: 550,
      isCatchAll: false,
      isDisposable: false,
      isRoleBased: false,
    });
    expect(status).toBe('INVALID');
  });

  it('overrides status to DISPOSABLE regardless of score', () => {
    const { status } = computeScore({
      syntaxValid: true,
      mxFound: true,
      smtpReachable: true,
      smtpCode: 250,
      isCatchAll: false,
      isDisposable: true,
      isRoleBased: false,
    });
    expect(status).toBe('DISPOSABLE');
  });

  it('overrides status to CATCH_ALL when isCatchAll is true', () => {
    const { status } = computeScore({
      syntaxValid: true,
      mxFound: true,
      smtpReachable: true,
      smtpCode: 250,
      isCatchAll: true,
      isDisposable: false,
      isRoleBased: false,
    });
    expect(status).toBe('CATCH_ALL');
  });

  it('returns UNKNOWN when only syntax is valid', () => {
    const { status, confidence } = computeScore({
      syntaxValid: true,
      mxFound: false,
      smtpReachable: false,
      smtpCode: null,
      isDisposable: false,
      isRoleBased: false,
    });
    expect(status).toBe('UNKNOWN');
    expect(confidence).toBe('LOW');
  });

  it('returns MEDIUM confidence when MX found but SMTP failed', () => {
    const { confidence } = computeScore({
      syntaxValid: true,
      mxFound: true,
      smtpReachable: false,
      smtpCode: null,
      isDisposable: false,
      isRoleBased: false,
    });
    expect(confidence).toBe('MEDIUM');
  });

  it('caps score at 100', () => {
    const { score } = computeScore({
      syntaxValid: true,
      mxFound: true,
      smtpReachable: true,
      smtpCode: 250,
      isCatchAll: false,
      isDisposable: false,
      isRoleBased: false,
    });
    expect(score).toBeLessThanOrEqual(100);
  });
});
