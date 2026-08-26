/**
 * An env var is "unset" if it is absent OR the empty string — an operator's `VAR=` in an env file
 * (as opposed to omitting the line entirely) must fall back to the same default as no line at all,
 * not be rejected as an invalid value for whatever type that variable holds. Every fallback and
 * default in `config.ts`, plus `till-config.ts`'s `tryLoadTillConfig` gate on the five
 * `WAITRON_TILL_*_ID`, goes through this, so "unset" has exactly ONE definition rather than a
 * second, subtly-different one living in each file.
 *
 * It lives in its own neutral module rather than in either caller BECAUSE `config.ts` imports
 * `tryLoadTillConfig` from `till-config.ts`, so `till-config.ts` importing `isUnset` back FROM
 * `config.ts` would close a two-file cycle — the same shape `boot.ts`'s `maxTickMs`-guard comment
 * keeps out from between `config.ts` and `health.ts`. `isUnset` is not till-specific and is general
 * enough that neither file owns it, so it sits below both, imported by each with no back-edge.
 */
export function isUnset(raw: string | undefined): raw is undefined | "" {
  return raw === undefined || raw === "";
}
