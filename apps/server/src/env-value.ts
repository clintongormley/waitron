/**
 * An env var is "unset" if it is absent OR the empty string: an operator's `VAR=` falls back to the
 * same default as no line at all. Its own module because `config.ts` imports `till-config.ts`, and
 * both use it.
 */
export function isUnset(raw: string | undefined): raw is undefined | "" {
  return raw === undefined || raw === "";
}
