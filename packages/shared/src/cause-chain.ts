/** How far down a `cause` chain to look before giving up. The bound exists so no chain — cyclic or
 * merely long — can spin, not because five levels are known to be needed. Exported so other walks
 * over a cause chain can use the same bound. */
export const MAX_CAUSE_DEPTH = 5;

/**
 * The first `code` in an error's `cause` chain that `accept` recognises, or `null`.
 *
 * No production code calls it: `node:sqlite` puts the fixed string `"ERR_SQLITE_ERROR"`
 * on `code` whatever the failure and the discriminating number on `errcode`, which
 * `sqliteFailureOf` (`./engine-failure.ts`) reads instead.
 *
 * Termination rests on `MAX_CAUSE_DEPTH`; the `cause === current` line is only an early exit for a
 * self-referencing error.
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
