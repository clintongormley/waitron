/**
 * A permissive telephone-format check: an optional leading "+", then digits among spaces, dots,
 * hyphens or parentheses, with 6–15 digits in all (E.164 caps at 15). False for "", so a caller
 * with an optional number validates only a non-empty one.
 */
export function isValidTelephone(raw: string): boolean {
  if (!/^\+?[\d ().-]+$/.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15;
}
