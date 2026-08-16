// Side-effect: loads this host's errors.ts augmentation for `management.request_invalid`, the code the
// body/query screens below throw (the "every file that throws imports ./errors.js" convention).
// `shared.invalid_id` (thrown by `requireUuidParam`) lives in @waitron/shared's base registry and loads
// via the AppError value import.
import "./errors.js";
import { AppError } from "@waitron/shared";
import { isUuid } from "./till-session.js";

/**
 * The request-shape SCREENS shared by the gated server API surfaces — `workforce-api.ts` (the
 * management-dashboard roster/swap/absence routes) and `schedule-api.ts` (the till-session-gated staff
 * schedule routes). Extracted here so BOTH surfaces validate identically rather than re-implementing a
 * screen "subtly differently": a malformed date, uuid or nullable field is refused BEFORE it reaches a
 * `::date`/`::timestamptz`/`uuid` column (where it would raise a 22xxx/22P02 → an opaque `server.internal`
 * 500) with a structured 400 naming the FIELD, never its value.
 *
 * Two codes, by position: a malformed PATH `:id` segment is `shared.invalid_id` (the branded-id family,
 * `requireUuidParam`); a malformed BODY/QUERY field is `management.request_invalid` naming the field —
 * the generic request-shape code the management dashboard already uses, reused here as the shared screen
 * for every gated API surface including the till schedule routes (see its doc in `errors.ts`).
 */

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Screen a path `:id` param as a UUID before it reaches a query, returning it. A malformed id passed
 * straight into `eq(...)`/`= ${id}` would `22P02` in the DB → an opaque 500; refused here as
 * `shared.invalid_id` naming the `kind` and echoing the (non-secret) value.
 */
export function requireUuidParam(id: string, kind: string): string {
  if (!isUuid(id)) throw new AppError("shared.invalid_id", { kind, value: id });
  return id;
}

/**
 * Screen a YYYY-MM-DD date value (a roster `period`, a planned-vs-actual/shift-window `from`/`to`, an
 * absence `startsOn`/`endsOn`) that is BOTH well-shaped AND a real calendar day. The regex alone admits
 * impossible days (`2026-02-30`, `2026-13-01`), which would reach the `::date` column as a 22008 → an
 * opaque `server.internal` 500; the round-trip through `Date` (a normalised or NaN result means the
 * Y-M-D was not a real day) rejects them here as `management.request_invalid` naming the `field`.
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

/** Screen a body field as a UUID string, refusing an absent/wrong-typed/malformed one as
 * `management.request_invalid` naming the field (never a downstream `22P02` 500). */
export function requireBodyUuid(v: unknown, field: string): string {
  if (typeof v !== "string" || !isUuid(v))
    throw new AppError("management.request_invalid", { field });
  return v;
}

/** Screen a NULLABLE body UUID (a `to_shift_id` return leg, absent for a one-sided give-away): `null`
 * passes through, any other value must be a UUID string else `management.request_invalid` naming the
 * field. `undefined` is NOT `null` — a caller must send an explicit `null`. */
export function requireNullableBodyUuid(v: unknown, field: string): string | null {
  if (v === null) return null;
  return requireBodyUuid(v, field);
}

/** Screen a nullable body string (a `note`/`role`): `null` passes, any other non-string is refused as
 * `management.request_invalid` naming the field. */
export function requireNullableString(v: unknown, field: string): string | null {
  if (v === null) return null;
  if (typeof v !== "string") throw new AppError("management.request_invalid", { field });
  return v;
}
