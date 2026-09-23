import { refusalCode } from "./constraint-target.js";
import { UNIQUE_VIOLATION, type RefusalClass } from "./sql-state.js";

/**
 * Is this error (or anything it wraps) one of `refusal`'s result codes?
 *
 * The engine's result code may be at the top level or one wrapper down, depending on the path the
 * refusal came through, so this reads the first result code in the cause chain
 * (`./constraint-target.ts`'s `refusalCode`, which owns the walk and its bound). Checking only the
 * top level would silently misreport a genuine violation that arrived wrapped.
 *
 * A production-layer predicate, not a test helper. It answers WHICH CLASS of refusal this is, and
 * nothing about which key was refused. A write path translating ONE specific refusal wants both,
 * which is `./constraint-target.ts`'s `refusalOn`; this is for a path that translates a whole
 * class, or one that also translates a refusal it could not identify.
 */
export function isRefusal(error: unknown, refusal: RefusalClass): boolean {
  const code = refusalCode(error);
  return code !== undefined && refusal.includes(code);
}

/**
 * Is this (or anything it wraps) a uniqueness violation? The {@link isRefusal} walk fixed to the
 * one class the write paths that translate a duplicate into a domain `AppError` care about (e.g.
 * `packages/core`'s `recordVoid` mapping a duplicate `sale_voids.sale_id` to
 * `sale.already_voided`).
 *
 * `UNIQUE_VIOLATION` covers a primary key as well as any other unique index — see
 * `./sql-state.ts`.
 */
export function isUniqueViolation(error: unknown): boolean {
  return isRefusal(error, UNIQUE_VIOLATION);
}
