const UNIQUE_VIOLATION = "23505";

/**
 * Is this (or anything it wraps) a unique-constraint violation?
 *
 * Walks the cause chain because Drizzle wraps every failed query in a `DrizzleQueryError` whose
 * own `.code` is undefined — the real SQLSTATE lives on `.cause.code` (node-postgres), or nested
 * one level deeper still under PGlite. Stops at a fixed depth so a self-referential `cause` cannot
 * spin forever. Checking only the top level would silently misreport a genuine unique violation
 * that arrived wrapped as some other kind of failure.
 *
 * A production-layer predicate, not a test helper — unlike `./testing/errors.ts`'s
 * `pgErrorCode`/`pgErrorMessage` (which exist to make a TEST's assertion readable), this function
 * is meant to be called from a write path deciding whether to translate a driver error into a
 * domain `AppError` (e.g. `packages/core`'s `recordVoid` translating a duplicate `sale_voids.sale_id`
 * into `sale.already_voided`). It is therefore exported from this package's own public surface
 * (`./index.ts`), not from `./testing/`.
 *
 * `packages/fiscal-verifactu/src/chain.ts` carries its own, independently-written copy of this
 * exact check (predating this file) for the identical reason: deciding whether a chain-append
 * race is worth retrying. That copy is left as is here — consolidating the two is a reasonable
 * follow-up, not a change this file's own introduction should make to already-shipped, reviewed
 * code in another package.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === UNIQUE_VIOLATION
    ) {
      return true;
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === current) return false;
    current = next;
  }
  return false;
}
