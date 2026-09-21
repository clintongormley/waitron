import { firstCodeInCauseChain } from "@waitron/shared";
import { UNIQUE_VIOLATION } from "./sqlstate.js";

/**
 * Is this error (or anything it wraps) the given pg SQLSTATE?
 *
 * The code is not on the error a write path catches — Drizzle wraps the driver's error rather than
 * re-exposing its fields — so this is a predicate over `@waitron/shared`'s `firstCodeInCauseChain`,
 * which owns the walk, its bound and the argument for both. Checking only the top level would
 * silently misreport a genuine violation that arrived wrapped.
 *
 * A production-layer predicate, not a test helper — unlike `./testing/errors.ts`'s
 * `pgErrorCode`/`pgErrorMessage` (which exist to make a TEST's assertion readable), this is meant to
 * be called from a write path deciding whether to translate a driver error into a domain `AppError`.
 * `isUniqueViolation` below is the `23505` specialisation; `@waitron/printing`'s `printers.ts` uses
 * it for the `23503` FK and the `23514` transport CHECK.
 *
 * It answers WHICH CLASS of refusal this is, and nothing about which key was refused. A write path
 * translating ONE specific refusal wants both, which is `./constraint-target.ts`'s `refusalOn`; this
 * is for a path that translates a whole class, or one that also translates a refusal it could not
 * identify.
 */
export function isPgError(error: unknown, sqlstate: string): boolean {
  return firstCodeInCauseChain(error, (code) => code === sqlstate) !== null;
}

/**
 * Is this (or anything it wraps) a unique-constraint violation (`23505`)? The `isPgError` walk fixed
 * to the one SQLSTATE the write paths that translate a duplicate into a domain `AppError` care about
 * (e.g. `packages/core`'s `recordVoid` mapping a duplicate `sale_voids.sale_id` to
 * `sale.already_voided`).
 */
export function isUniqueViolation(error: unknown): boolean {
  return isPgError(error, UNIQUE_VIOLATION);
}
