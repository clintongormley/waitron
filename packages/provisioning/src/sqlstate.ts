/** How far down a `cause` chain to look before giving up. Drizzle puts the driver's error one
 * level down; the bound exists so a self-referential `cause` cannot spin, not because five levels
 * are known to be needed. */
const MAX_CAUSE_DEPTH = 5;

/** Five characters, `[0-9A-Z]` — the shape SQLSTATE is defined to have. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * The SQLSTATE of a driver failure, or `null` when there is none to be had.
 *
 * Nothing but a five-character `[0-9A-Z]` string ever leaves this function, and that is the entire
 * argument for printing its result into an operator's terminal. It is STRUCTURAL, not a promise
 * about who calls it: a generated password is 32 base64url characters (identifiers.ts) and a
 * connection string is longer still, so neither can satisfy the pattern. A non-SQLSTATE error code
 * that happens to match — Node's `EPIPE` is five upper-case characters — would pass this filter,
 * and is equally not a secret; the filter is a shape guard, not an identification.
 *
 * It walks `.cause` because the code is not on the error its callers catch: Drizzle wraps the
 * driver's error rather than re-exposing its fields. That is asserted against the real shape, not
 * assumed — `instance-apply.rls.test.ts`'s "never lets the generated password reach a thrown error"
 * forces a genuine failure through a real container and pins `sqlstate: "42704"`, which is only
 * reachable through this walk.
 *
 * It lives in its own module rather than beside one of its two callers because both `cli.ts` (which
 * classifies a failed READ) and `instance-apply.ts` (which classifies a failed WRITE) need exactly
 * this, and the safety argument above is the kind that must not be maintained in two copies.
 */
export function sqlstateOf(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    const code: unknown = (current as { code?: unknown }).code;
    if (typeof code === "string" && SQLSTATE.test(code)) return code;
    const cause: unknown = (current as { cause?: unknown }).cause;
    if (cause === current) return null;
    current = cause;
  }
  return null;
}
