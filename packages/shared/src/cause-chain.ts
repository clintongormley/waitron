/** How far down a `cause` chain to look before giving up. Drizzle puts the driver's error one
 * level down; the bound exists so no chain — cyclic or merely long — can spin, not because five
 * levels are known to be needed. */
const MAX_CAUSE_DEPTH = 5;

/**
 * The first `code` in an error's `cause` chain that `accept` recognises, or `null`.
 *
 * The walk exists because the code is not on the error its callers catch: Drizzle wraps the
 * driver's error rather than re-exposing its fields. `sqlStateOf` (`sql-state.ts`) and
 * `classifyBootFailure`'s socket lookup (`apps/server/src/boot-failure.ts`) differ ONLY in the
 * predicate, so the loop and its termination argument are made once, here.
 *
 * Termination rests on `MAX_CAUSE_DEPTH` ALONE. The `cause === current` line is a redundant early
 * exit, kept because it names the one cycle shape cheaply: measured 2026-09-10, deleting the bound
 * fails the depth test, while deleting that line with the bound in place fails nothing, and only
 * deleting BOTH hangs the run. Do not read it as a second guarantee.
 *
 * `accept` sees a `string` and returns whether it is one of ITS codes; it never sees the error, so
 * a predicate cannot widen what leaves this function beyond a `code` the chain actually carried.
 */
export function firstCodeInCauseChain(
  error: unknown,
  accept: (code: string) => boolean,
): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    const code: unknown = (current as { code?: unknown }).code;
    if (typeof code === "string" && accept(code)) return code;
    const cause: unknown = (current as { cause?: unknown }).cause;
    if (cause === current) return null;
    current = cause;
  }
  return null;
}
