const UNIQUE_VIOLATION = "23505";

/**
 * Is this error (or anything it wraps) the given pg SQLSTATE?
 *
 * Walks the cause chain because Drizzle wraps every failed query in a `DrizzleQueryError` whose
 * own `.code` is undefined — the real SQLSTATE lives on `.cause.code` (node-postgres), or nested
 * one level deeper still under PGlite. Stops at a fixed depth so a self-referential `cause` cannot
 * spin forever. Checking only the top level would silently misreport a genuine violation that
 * arrived wrapped as some other kind of failure.
 *
 * A production-layer predicate, not a test helper — unlike `./testing/errors.ts`'s
 * `pgErrorCode`/`pgErrorMessage` (which exist to make a TEST's assertion readable), this function
 * is meant to be called from a write path deciding whether to translate a driver error into a
 * domain `AppError`. `isUniqueViolation` below is the `23505` specialisation; `@waitron/printing`'s
 * `printers.ts` uses it for the `23503` composite FK and the `23514` transport CHECK. It is therefore
 * exported from this package's own public surface (`./index.ts`), not from `./testing/`.
 *
 * `packages/fiscal-verifactu/src/chain.ts` carries its own, independently-written copy of this
 * exact walk (predating this file) for deciding whether a chain-append race is worth retrying. That
 * copy is left as is here — consolidating it is a reasonable follow-up, not a change this file's own
 * introduction should make to already-shipped, reviewed code in another package.
 */
export function isPgError(error: unknown, sqlstate: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === sqlstate
    ) {
      return true;
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === current) return false;
    current = next;
  }
  return false;
}

/**
 * Is this (or anything it wraps) a unique-constraint violation (`23505`)? The `isPgError` cause-chain
 * walk fixed to the one SQLSTATE the write paths that translate a duplicate into a domain `AppError`
 * care about (e.g. `packages/core`'s `recordVoid` mapping a duplicate `sale_voids.sale_id` to
 * `sale.already_voided`).
 */
export function isUniqueViolation(error: unknown): boolean {
  return isPgError(error, UNIQUE_VIOLATION);
}

/**
 * The NAME of the violated unique constraint from a `23505` error (or anything it wraps), or
 * `undefined` when the SQLSTATE is not `23505` or the driver reported no constraint name. Walks the
 * same cause chain as {@link isPgError}: node-postgres puts the constraint on the `23505` layer's
 * `.constraint`; PGlite may omit it, so `undefined` means "unknown", NOT "no violation".
 *
 * A write path that maps a duplicate to a domain error uses this to translate ONLY its own
 * constraint and re-throw a different `23505` (a PK, or a constraint added later) rather than
 * mislabelling every unique violation. `@waitron/identity`'s `asEmailTaken` is the first caller.
 */
export function uniqueViolationConstraint(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === UNIQUE_VIOLATION) {
      const constraint = (current as { constraint?: unknown }).constraint;
      return typeof constraint === "string" ? constraint : undefined;
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === current) return undefined;
    current = next;
  }
  return undefined;
}
