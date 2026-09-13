/**
 * A permissive telephone-format check for UI hints and write validation, used by BOTH the server
 * write paths (identity) and the dashboard forms so client and server agree. Accepts an optional
 * single leading "+", then digits interspersed with spaces, dots, hyphens or parentheses, and
 * requires 6–15 digits in total (E.164 caps at 15). Returns false for "" — telephone is optional,
 * so callers decide whether an absent number is allowed and only validate a non-empty value.
 */
export function isValidTelephone(raw: string): boolean {
  if (!/^\+?[\d ().-]+$/.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15;
}
