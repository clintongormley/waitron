/** How far down a `cause` chain to look before giving up. Drizzle puts the driver's error one
 * level down; the bound exists so no chain — cyclic or merely long — can spin, not because five
 * levels are known to be needed.
 *
 * Exported because `failureDetail` (`apps/server/src/node-entry.ts`) walks the same chains for a
 * different purpose and must not disagree with these two about how deep one goes. */
export const MAX_CAUSE_DEPTH = 5;

/**
 * The first `code` in an error's `cause` chain that `accept` recognises, or `null`.
 *
 * The walk exists because the code is not on the error its callers catch: Drizzle wraps the
 * driver's error rather than re-exposing its fields.
 *
 * **NOTHING IN THE TREE CALLS IT TODAY**, and that is worth knowing before reading it as a pattern.
 * Its two callers read a PostgreSQL SQLSTATE and a Node socket code off `code`, and both went with
 * the storage switch: this engine puts a NUMBER on `errcode` and the fixed string
 * `"ERR_SQLITE_ERROR"` on `code`, so a predicate over `code` can tell a caller nothing
 * (`sqliteFailureOf`, `engine-failure.ts`, is what replaced them). It is kept, uncalled, because
 * `MAX_CAUSE_DEPTH` and the two arguments below are what the tree still shares, and because the
 * next thing to walk a cause chain for a string code should not write the loop again.
 *
 * Two other walks exist and do not reuse it: `sqliteFailureOf` carries a number and a message out
 * rather than a code, and `failureDetail` (`apps/server/src/node-entry.ts`) collects every level's
 * name, message and params rather than stopping at the first match. Both import `MAX_CAUSE_DEPTH`
 * above, so the BOUND and the argument for it are still stated once even though the loop is not.
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
