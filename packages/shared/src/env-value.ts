/**
 * An env var is "unset" if it is absent OR the empty string: an operator's `VAR=` falls back to the
 * same default as no line at all.
 */
export function isUnset(raw: string | undefined): raw is undefined | "" {
  return raw === undefined || raw === "";
}
