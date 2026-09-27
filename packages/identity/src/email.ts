export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Screens obvious typos only; not RFC-complete. Accepts what /^[^\s@]+@[^\s@]+\.[^\s@]+$/ did, without
// that pattern's backtracking, which grows with the square of a crafted domain's length.
export function isValidEmail(raw: string): boolean {
  const email = raw.trim();
  if (/\s/.test(email)) return false;
  const at = email.indexOf("@");
  if (at < 1 || email.indexOf("@", at + 1) !== -1) return false;
  const domain = email.slice(at + 1);
  const dot = domain.indexOf(".", 1);
  return dot !== -1 && dot < domain.length - 1;
}
