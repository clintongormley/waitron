import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { NodeId } from "@waitron/shared";
import type { DailyCloseInput, PeriodVatInput } from "./types.js";

const CUTOVER_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Throws a plain Error (a caller precondition) unless `tz` is a named IANA zone. An unknown name
 * makes `Intl.DateTimeFormat` throw; an offset such as "+02:00" or "+0200" it accepts and resolves
 * to "+02:00", so the resolved name is read back and a leading `+`/`-` refused. A named zone
 * (`Europe/Madrid`, `UTC`, `Etc/GMT+2`) never resolves to one.
 */
export function validateTimeZone(tz: string): void {
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`reporting: invalid IANA time zone: ${JSON.stringify(tz)}`);
  }
  if (/^[+-]/.test(resolved)) {
    throw new Error(
      `reporting: invalid IANA time zone (numeric offset, not a named zone): ${JSON.stringify(tz)}`,
    );
  }
}

export function validateCutover(cutover: string): void {
  if (!CUTOVER_RE.test(cutover)) {
    throw new Error(`reporting: invalid cutover, expected "HH:MM": ${JSON.stringify(cutover)}`);
  }
}

export function validateBusinessDay(day: string): void {
  if (!DATE_RE.test(day)) {
    throw new Error(
      `reporting: invalid business day, expected "YYYY-MM-DD": ${JSON.stringify(day)}`,
    );
  }
  // `Date.UTC` rolls an impossible date over (2026-13-45 → 2027-02-14), so a round-trip mismatch
  // means it is not a real day; unchecked, the day's window would silently cover another day.
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(
      `reporting: invalid business day (not a real calendar date): ${JSON.stringify(day)}`,
    );
  }
}

/**
 * Validates a closed `[from, to]` business-day range: each end is a real calendar date and `from` is
 * on or before `to`. String compare is correct for the fixed "YYYY-MM-DD" shape `validateBusinessDay`
 * enforces.
 */
export function validateBusinessDayRange(input: {
  fromBusinessDay: string;
  toBusinessDay: string;
}): void {
  validateBusinessDay(input.fromBusinessDay);
  validateBusinessDay(input.toBusinessDay);
  if (input.fromBusinessDay > input.toBusinessDay) {
    throw new Error(
      `reporting: fromBusinessDay must be on or before toBusinessDay: ${JSON.stringify(input.fromBusinessDay)} > ${JSON.stringify(input.toBusinessDay)}`,
    );
  }
}

/**
 * The venue's UTC offset, in minutes, at a given instant. `timeZoneName: "longOffset"` renders it as
 * `GMT±HH:MM`.
 */
function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const rendered = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date(utcMs))
    .find((part) => part.type === "timeZoneName")!.value;
  const parsed = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(rendered);
  /* v8 ignore start -- unreachable for a zone `validateTimeZone` accepted: every zone measured
     renders as GMT±HH:MM or GMT. It fails LOUD rather than silently treating an unreadable offset
     as zero, which would file a sale on the wrong business day without saying so. */
  if (parsed === null) {
    throw new Error(`reporting: unreadable UTC offset ${JSON.stringify(rendered)} for ${timeZone}`);
  }
  /* v8 ignore stop */
  /* v8 ignore start -- the bare `GMT` spelling, which this runtime never produces: measured on
     Node 26.7.0, seven zero-offset zones (UTC, Etc/UTC, Etc/GMT, GMT, Europe/London in winter,
     Atlantic/Reykjavik, Africa/Abidjan) ALL render `GMT+00:00`. The optional group stays because
     the spelling comes from the runtime's own ICU data rather than from this repository, so
     another machine's may differ; dropping it would turn a zero offset into a thrown error there,
     which is the one direction that must not happen to a UTC venue. */
  if (parsed[1] === undefined) return 0;
  /* v8 ignore stop */
  const magnitude = Number(parsed[2]) * 60 + Number(parsed[3]);
  return parsed[1] === "-" ? -magnitude : magnitude;
}

/**
 * The venue-local wall clock at `utcMs`, expressed as the epoch milliseconds those same calendar
 * components would carry if they were UTC.
 */
function wallClockMs(utcMs: number, timeZone: string): number {
  return utcMs + zoneOffsetMinutes(utcMs, timeZone) * 60_000;
}

/**
 * The inverse of {@link wallClockMs}: the instant whose venue-local wall clock reads `wallMs`.
 *
 * Two passes, because the offset that converts the answer is the offset AT the answer, not at the
 * guess: the first subtraction lands within a day of the target and the second uses that day's own
 * offset.
 */
function instantOfWallClock(wallMs: number, timeZone: string): number {
  const guess = wallMs - zoneOffsetMinutes(wallMs, timeZone) * 60_000;
  return wallMs - zoneOffsetMinutes(guess, timeZone) * 60_000;
}

/** The cutover `"HH:MM"` as whole minutes past local midnight. `validateCutover` has run first. */
function cutoverMinutes(dayCutover: string): number {
  const [hours, minutes] = dayCutover.split(":").map(Number) as [number, number];
  return hours * 60 + minutes;
}

/**
 * The instant at which business day `day` BEGINS in the venue's zone — the moment its local wall
 * clock reads `day` at `dayCutover` — as the canonical ISO-8601 string this engine's timestamp
 * columns hold. `dayOffset` moves the answer whole calendar days (1 gives the day's exclusive upper
 * bound); `Date.UTC` normalises a month or year rollover.
 */
function businessDayBoundary(
  day: string,
  dayOffset: number,
  clock: { timeZone: string; dayCutover: string },
): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const wallMs = Date.UTC(year, month - 1, date + dayOffset, 0, cutoverMinutes(clock.dayCutover));
  return new Date(instantOfWallClock(wallMs, clock.timeZone)).toISOString();
}

/**
 * The DST-aware business-day predicate every aggregate reuses: the half-open instant window
 * `[start of from, start of the day after to)`, compared against a timestamp column. The two
 * boundary instants are computed once rather than each row's instant being mapped to a local date.
 * Measured against such a per-row mapping, the two differed only where a cutover sits inside the
 * zone's DST transition hour, on the two change days a year, by up to the transition's length.
 *
 * A timestamp column is TEXT, so this compares strings. That is correct only while the stored value
 * is in `toISOString()`'s canonical spelling, as both boundaries are; a value stored with a `+02:00`
 * offset, or written `2026-08-04 03:00:00`, would sort wrong against them.
 */
function businessDayWindow(
  column: SQL,
  from: string,
  to: string,
  clock: { timeZone: string; dayCutover: string },
): SQL {
  const start = businessDayBoundary(from, 0, clock);
  const end = businessDayBoundary(to, 1, clock);
  return sql`${column} >= ${start} and ${column} < ${end}`;
}

/**
 * The venue-local business DATE of an instant, as `"YYYY-MM-DD"`. The core of `currentBusinessDay`,
 * split out so the cutover maths can be tested against a literal instant rather than the live
 * clock; not in the public barrel. The caller validates `timeZone` and `dayCutover` first.
 */
export function businessDayOf(
  instant: Date,
  input: { timeZone: string; dayCutover: string },
): string {
  const shifted =
    wallClockMs(instant.getTime(), input.timeZone) - cutoverMinutes(input.dayCutover) * 60_000;
  return new Date(shifted).toISOString().slice(0, 10);
}

/**
 * Today's venue-local business day (cutover-shifted) as `"YYYY-MM-DD"`. Anchors the `/reports`
 * overview's default period. Invalid inputs are a caller precondition and throw a plain `Error`
 * (matching this file's validators — no registered error code), before anything is computed.
 */
export function currentBusinessDay(input: { timeZone: string; dayCutover: string }): string {
  validateTimeZone(input.timeZone);
  validateCutover(input.dayCutover);
  return businessDayOf(new Date(), input);
}

/**
 * The business-day predicate for ONE day. `column` is a timestamp column (`sales.issued_at` or
 * `tenders.settled_at`); a row belongs to `businessDay` when its instant falls in that day's
 * window ({@link businessDayWindow}).
 */
export function businessDayClause(column: SQL, input: DailyCloseInput): SQL {
  return businessDayWindow(column, input.businessDay, input.businessDay, input);
}

/**
 * The closed-range generalisation of `businessDayClause`: the same window, opened at `from` and
 * closed after `to`, both inclusive. A single-day range is the predicate `businessDayClause` builds.
 */
export function businessDayRangeClause(column: SQL, input: PeriodVatInput): SQL {
  return businessDayWindow(column, input.fromBusinessDay, input.toBusinessDay, input);
}

/** A timestamp column's business-day window predicate: `businessDayClause` or its range form. */
export type WindowClause = (column: SQL) => SQL;

/** F3-canje substitutes are never counted: their VAT is already in the F2 tickets they replace. */
function notSubstituteClause(): SQL {
  return sql`not exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = s.id)`;
}

/**
 * Excludes every voided sale, whenever the void was made, and F3-canje substitutes. Only the
 * modelo 303 still reads voids this way, until the asesor answers
 * `docs/compliance/asesor-questions.md` Q25. Assumes the outer query aliases `sales` as `s`. No
 * leading `and`.
 */
export function activeSalesClause(): SQL {
  return sql`not exists (select 1 from sale_voids sv where sv.sale_id = s.id)
      and ${notSubstituteClause()}`;
}

/**
 * The sales a day-scoped report counts on their ISSUE day: issued in the window, not an F3-canje
 * substitute, and not voided inside the same window — a sale and its void in one window cancel, so
 * neither is listed. A void made after the window leaves the sale counted, which is what keeps a
 * closed day's re-derived figures equal to its frozen close. Assumes `sales` is aliased `s`. No
 * leading `and`.
 */
export function issuedSalesClause(window: WindowClause): SQL {
  return sql`${window(sql`s.issued_at`)}
      and ${notSubstituteClause()}
      and not exists (select 1 from sale_voids vd where vd.sale_id = s.id and ${window(sql`vd.voided_at`)})`;
}

/**
 * The sales a day-scoped report REVERSES: voided in the window, issued outside it, and not an
 * F3-canje substitute (never counted, so never reversed). Assumes the outer query joins `sale_voids`
 * as `sv` to `sales` as `s`. No leading `and`.
 */
export function reversedSalesClause(window: WindowClause): SQL {
  return sql`${window(sql`sv.voided_at`)}
      and not (${window(sql`s.issued_at`)})
      and ${notSubstituteClause()}`;
}

/**
 * The optional node predicate: `and s.node_id = <nodeId>` when a node is fixed, an empty fragment
 * when it is omitted (a venue-wide aggregate). Assumes the outer query aliases `sales` as `s`, and
 * carries its own leading `and`, so the caller writes it inline as
 * `${nodeScopeClause(input.nodeId)}`.
 */
export function nodeScopeClause(nodeId?: NodeId): SQL {
  return nodeId ? sql`and s.node_id = ${nodeId}` : sql``;
}
