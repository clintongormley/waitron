// Pure helpers for the email login boundary. No DB, no async — normalisation and a screening check.

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Deliberately conservative: one @, a dot in the domain, no spaces. Not RFC-complete — it screens
// obvious typos at the write boundary; uniqueness/identity is enforced by the DB index + login lookup.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(raw: string): boolean {
  return EMAIL_RE.test(raw.trim());
}
