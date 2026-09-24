export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Screens obvious typos only; not RFC-complete.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(raw: string): boolean {
  return EMAIL_RE.test(raw.trim());
}
