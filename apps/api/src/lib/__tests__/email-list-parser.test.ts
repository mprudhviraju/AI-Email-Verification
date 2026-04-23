import { describe, it, expect } from 'vitest';
import { parseCsvEmails } from '../email-list-parser.js';

describe('parseCsvEmails', () => {
  it('extracts emails from a plain newline-separated list', () => {
    const input = 'alice@example.com\nbob@example.com\ncarol@example.com';
    expect(parseCsvEmails(input)).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
    ]);
  });

  it('extracts emails from a single-column CSV', () => {
    const input = 'email\nalice@example.com\nbob@example.com';
    const result = parseCsvEmails(input);
    expect(result).toContain('alice@example.com');
    expect(result).toContain('bob@example.com');
  });

  it('extracts emails from a multi-column CSV', () => {
    const input = 'name,email,company\nAlice,alice@example.com,Acme\nBob,bob@test.org,Beta';
    const result = parseCsvEmails(input);
    expect(result).toContain('alice@example.com');
    expect(result).toContain('bob@test.org');
  });

  it('deduplicates emails', () => {
    const input = 'alice@example.com\nalice@example.com\nAlice@Example.COM';
    const result = parseCsvEmails(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('alice@example.com');
  });

  it('normalises to lowercase', () => {
    const input = 'JOHN@EXAMPLE.COM';
    expect(parseCsvEmails(input)[0]).toBe('john@example.com');
  });

  it('ignores non-email tokens', () => {
    const input = 'hello,world,notanemail,alice@example.com';
    const result = parseCsvEmails(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('alice@example.com');
  });

  it('returns an empty array for content with no emails', () => {
    expect(parseCsvEmails('name,phone\nAlice,555-1234')).toHaveLength(0);
  });

  it('handles Windows-style CRLF line endings', () => {
    const input = 'alice@example.com\r\nbob@example.com';
    const result = parseCsvEmails(input);
    expect(result).toContain('alice@example.com');
    expect(result).toContain('bob@example.com');
  });

  it('enforces the 50,000 email hard cap', () => {
    // Generate 50,010 unique emails
    const lines = Array.from({ length: 50_010 }, (_, i) => `user${i}@test.com`);
    const result = parseCsvEmails(lines.join('\n'));
    expect(result.length).toBe(50_000);
  });
});
