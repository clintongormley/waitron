import "./errors.js";
import { AppError, isUuid } from "@waitron/shared";

/**
 * **These screens are the ONLY refusal.** Id, date and timestamp columns are `text`, which refuses
 * nothing: an unparseable value is STORED. Removing a screen here removes the check.
 *
 * Two codes, chosen by WHAT the field is: a BRANDED id (a path `:id`, or a body/query id such as
 * the till's `workingOrderId`) is `shared.invalid_id`, echoing the (non-secret) value; a generic
 * field is `management.request_invalid`, naming only the field.
 */

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

export function requireUuidParam(id: string, kind: string): string {
  if (!isUuid(id)) throw new AppError("shared.invalid_id", { kind, value: id });
  return id;
}

/**
 * The regex alone admits impossible days (`2026-02-30`); the round-trip through `Date` refuses
 * them.
 */
export function requirePeriod(value: unknown, field: string): string {
  if (typeof value !== "string" || !YYYY_MM_DD.test(value)) {
    throw new AppError("management.request_invalid", { field });
  }
  const asUtc = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(asUtc.getTime()) || asUtc.toISOString().slice(0, 10) !== value) {
    throw new AppError("management.request_invalid", { field });
  }
  return value;
}

export function requireBodyUuid(v: unknown, field: string): string {
  if (typeof v !== "string" || !isUuid(v))
    throw new AppError("management.request_invalid", { field });
  return v;
}

/** `undefined` is NOT `null`: a caller must send an explicit `null`. */
export function requireNullableBodyUuid(v: unknown, field: string): string | null {
  if (v === null) return null;
  return requireBodyUuid(v, field);
}

export function requireString(v: unknown, field: string): string {
  if (typeof v !== "string") throw new AppError("management.request_invalid", { field });
  return v;
}

export function requireNullableString(v: unknown, field: string): string | null {
  if (v === null) return null;
  return requireString(v, field);
}

export function requireEnum<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new AppError("management.request_invalid", { field });
  }
  return v as T;
}
