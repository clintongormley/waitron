import { refusalCode } from "./constraint-target.js";
import { UNIQUE_VIOLATION, type RefusalClass } from "./sql-state.js";

/** Reads the first result code. The ambiguous 1811 requires restrictRefused/triggerRaised,
 * which also match the message; a result code alone identifies no particular key. */
export function isRefusal(error: unknown, refusal: RefusalClass): boolean {
  const code = refusalCode(error);
  return code !== undefined && code !== 1811 && refusal.includes(code);
}

/** Is this (or anything it wraps) a uniqueness violation, on a primary key or any unique index? */
export function isUniqueViolation(error: unknown): boolean {
  return isRefusal(error, UNIQUE_VIOLATION);
}
