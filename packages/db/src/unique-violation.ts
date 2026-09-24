import { refusalCode } from "./constraint-target.js";
import { UNIQUE_VIOLATION, type RefusalClass } from "./sql-state.js";

/**
 * Is this error (or anything it wraps) one of `refusal`'s result codes?
 *
 * The engine's result code may be at the top level or one wrapper down, depending on the path the
 * refusal came through, so this reads the first result code in the cause chain.
 *
 * It answers WHICH CLASS of refusal this is, and nothing about which key was refused; a write path
 * translating ONE specific refusal wants `./constraint-target.ts`'s `refusalOn`.
 */
export function isRefusal(error: unknown, refusal: RefusalClass): boolean {
  const code = refusalCode(error);
  return code !== undefined && refusal.includes(code);
}

/** Is this (or anything it wraps) a uniqueness violation, on a primary key or any unique index? */
export function isUniqueViolation(error: unknown): boolean {
  return isRefusal(error, UNIQUE_VIOLATION);
}
