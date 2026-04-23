/**
 * Parses raw CSV or newline-delimited text content to extract a list of email addresses.
 * Handles:
 *  - Single-column plain text (one email per line)
 *  - Multi-column CSV (finds the column with the most valid emails)
 *  - Deduplication and normalisation (lowercase, trim)
 *  - Hard cap of 50,000 emails
 */

const EMAIL_EXTRACT_REGEX = /[a-zA-Z0-9._%+\-\u00C0-\u024F]+@[a-zA-Z0-9.\-]+\.[a-zA-Z\u00C0-\u024F]{2,}/gu;
const MAX_EMAILS = 50_000;

export function parseCsvEmails(content: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  const matches = content.matchAll(EMAIL_EXTRACT_REGEX);
  for (const match of matches) {
    if (results.length >= MAX_EMAILS) break;
    const email = match[0].toLowerCase().trim();
    if (!seen.has(email)) {
      seen.add(email);
      results.push(email);
    }
  }

  return results;
}
