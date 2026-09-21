const UNIQUE_VIOLATION = "23505";

/**
 * Is this error (or anything it wraps) the given pg SQLSTATE?
 *
 * Walks the cause chain because Drizzle wraps every failed query in a `DrizzleQueryError` whose
 * own `.code` is undefined — the real SQLSTATE lives one layer down. Stops at a fixed depth so a
 * self-referential `cause` cannot spin forever. Checking only the top level would silently
 * misreport a genuine violation that arrived wrapped as some other kind of failure.
 *
 * A production-layer predicate, not a test helper — unlike `./testing/errors.ts`'s
 * `pgErrorCode`/`pgErrorMessage` (which exist to make a TEST's assertion readable), this function
 * is meant to be called from a write path deciding whether to translate a driver error into a
 * domain `AppError`. `isUniqueViolation` below is the `23505` specialisation; `@waitron/printing`'s
 * `printers.ts` uses it for the `23503` FK and the `23514` transport CHECK. It is therefore
 * exported from this package's own public surface (`./index.ts`), not from `./testing/`.
 *
 * It answers WHICH CLASS of refusal this is, and nothing about which key was refused. That second
 * question is `./constraint-target.ts`'s, and a write path translating one specific refusal needs
 * both: the SQLSTATE alone would also accept a sibling constraint on the same table.
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
