import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { NodeId } from "@waitron/shared";
import type { DailyCloseInput, PeriodVatInput } from "./types.js";

const CUTOVER_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Throws a plain Error (a caller precondition — see the plan's spec-refinement note) if `tz` is not a
 * resolvable IANA zone. Two rejections, both required by design §D4 ("always an explicit IANA name —
 * never a numeric offset"):
 *
 *   - an unknown value ("Mars/Olympus") — `Intl.DateTimeFormat` throws a RangeError constructing it;
 *   - a UTC-offset shorthand ("+02:00", "+0200") — measured on Node 26, `Intl.DateTimeFormat` ACCEPTS
 *     these and resolves them to a "+HH:MM" form (it does NOT throw, contrary to older engines), so
 *     they are caught by reading `resolvedOptions().timeZone` back and rejecting an offset spelling.
 *
 * A named zone resolves to a name (`Europe/Madrid`, `UTC`, `Etc/GMT+2`), never a leading `+`/`-`.
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
  // Reject a well-formed but impossible date ("2026-13-45", "2026-02-30") up front, rather than
  // letting it reach `${businessDay}::date` in SQL and surface as a raw Postgres range error.
  // `Date.UTC` normalises overflow (2026-13-45 → 2027-02-14), so a round-trip mismatch = not a real day.
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
 * enforces. The symmetric home for the ordering rule beside the atomic validators, so the next range
 * aggregate (quarterly/annual) reuses it rather than re-deriving `from <= to` and its message.
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
 * The venue's UTC offset, in minutes, at a given instant — the zone database `AT TIME ZONE` used to
 * reach, read here through `Intl` instead.
 *
 * `timeZoneName: "longOffset"` renders the offset as `GMT±HH:MM`, and `GMT+00:00` for a zero
 * offset. Measured on Node 26.7.0 across Europe/Madrid (both sides of its DST change), UTC,
 * Etc/GMT+2, America/New_York, Asia/Kolkata (a half-hour offset), Australia/Lord_Howe (a half-hour
 * DST step) and Pacific/Kiritimati (+14:00): every one produced that spelling.
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
 * components would carry if they were UTC — what `column at time zone <ianaName>` produced.
 */
function wallClockMs(utcMs: number, timeZone: string): number {
  return utcMs + zoneOffsetMinutes(utcMs, timeZone) * 60_000;
}

/**
 * The inverse of {@link wallClockMs}: the instant whose venue-local wall clock reads `wallMs`.
 *
 * Two passes, because the offset that converts the answer is the offset AT the answer, not at the
 * guess: the first subtraction lands within a day of the target and the second uses that day's own
 * offset. Dropping the second pass is what a DST change costs — see the measurement recorded on
 * {@link businessDayWindow}.
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
 * `[start of from, start of the day after to)`, compared against a timestamp column.
 *
 * ## Why this shape rather than the old one
 *
 * It was `(column at time zone <zone> - <cutover>::interval)::date = <day>`, evaluated per row.
 * This engine has neither `at time zone` nor an interval type nor a zone database, so the maths
 * moved into JavaScript and the direction INVERTED: instead of mapping every row's instant to a
 * local date, the day's two boundary instants are computed once and the rows are compared against
 * them. A single-day range is therefore the SAME predicate as the `=` form by construction, not by
 * a coincidence two expressions share — which is what `business-day.test.ts` pins.
 *
 * ## What the inversion costs, measured
 *
 * Against PGlite 0.5.8 (PostgreSQL 18.3) running the expression this replaced, 2026-09-22:
 * 288,000 comparisons — every quarter-hour of ten calendar days (four of them DST transition days)
 * × six zones × five cutovers × ten candidate business days. 8 disagreements, ALL of them
 * Europe/Madrid at a `02:30` cutover, i.e. the two days a year on which the transition moves the
 * cutover itself: the half hour the spring-forward skips lands on the previous business day here
 * and on the following one there, and the repeated half hour of the autumn overlap the same way.
 * Every other zone, cutover and instant agreed exactly. A venue whose cutover sits outside its
 * zone's transition hour is unaffected; one whose cutover sits inside it loses up to the length of
 * the transition, on two days a year. Dropping `instantOfWallClock`'s second pass doubles that
 * count to 16, which is the control that says the two passes are doing something.
 *
 * ## The comparison is on the SPELLING
 *
 * A timestamp column is TEXT here, so this compares strings. It is correct because both boundaries
 * are canonical `…T…:…:….000Z` — `Date.prototype.toISOString`, the same spelling every writer of
 * these columns produces (`packages/core`'s `record-sale.ts`, `record-correction.ts`,
 * `record-void.ts`, `settle-sale.ts` all call `toISOString()`). A stored value carrying a
 * `+02:00` offset or written `2026-08-04 03:00:00` would sort wrong against it, the trap
 * `packages/printing`'s job lease records.
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
 * The venue-local business DATE of an instant, as `"YYYY-MM-DD"`. The executing core behind
 * `currentBusinessDay` — split out so the cutover-shift maths can be tested against a LITERAL
 * instant rather than the live clock the public entry passes. Package-internal, deliberately NOT in
 * the public barrel (`index.ts`); the route consumes `currentBusinessDay`.
 *
 * It no longer takes a transaction. It asked the DATABASE for this because the database's clock and
 * the app server's could skew; on this engine the database runs inside this process
 * (`node:sqlite`), so there is one clock — the same conclusion `apps/server`'s `minutesSince` and
 * `packages/printing`'s job lease reach. The zone's DST rules come from `Intl` rather than from the
 * server's zone database.
 *
 * Measured equivalent to `((instant at time zone <zone>) - <cutover>::interval)::date` on PGlite
 * 0.5.8, 2026-09-22: 28,800 instants × zone × cutover compared, 0 disagreements — DST transition
 * days and a `02:30` cutover included, where the WINDOW form above does disagree. Removing the
 * cutover subtraction turns that into 9,012 disagreements, which is the control.
 *
 * The caller precondition is that `timeZone`/`dayCutover` are validated first; `currentBusinessDay`
 * does that (via `validateTimeZone`/`validateCutover`) before calling this.
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
 * window — see {@link businessDayWindow} for the window, its equivalence measurement and its cost.
 */
export function businessDayClause(column: SQL, input: DailyCloseInput): SQL {
  return businessDayWindow(column, input.businessDay, input.businessDay, input);
}

/**
 * The closed-range generalisation of `businessDayClause`: the same window, opened at `from` and
 * closed after `to`. A single-day range (`from == to`) is now literally the same predicate the `=`
 * form builds rather than an expression that has to agree with it — see `business-day.test.ts`.
 * Bounds are inclusive on both ends, as they were.
 */
export function businessDayRangeClause(column: SQL, input: PeriodVatInput): SQL {
  return businessDayWindow(column, input.fromBusinessDay, input.toBusinessDay, input);
}

/**
 * Excludes the sales a fiscal aggregate must not count: voided sales (annulled) and F3-canje
 * substitutes (their VAT already lives in the substituted F2 tickets — design §4, confirmed against
 * *modelo 303* in the AEAT FAQ). Assumes the outer query aliases `sales` as `s`. Shared by the VAT
 * summary and the record counts so the two cannot drift on which sales are "active". No leading
 * `and` — the caller writes `and ${activeSalesClause()}`.
 */
export function activeSalesClause(): SQL {
  return sql`not exists (select 1 from sale_voids sv where sv.sale_id = s.id)
      and not exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = s.id)`;
}

/**
 * The optional node predicate every sales aggregate applies: `and s.node_id = <nodeId>` when a node is
 * fixed (a node-grain view — the dashboard overview/daily-close/period), an empty fragment when it is
 * omitted (a venue-wide aggregate — e.g. modelo 303 — over the database's one taxpayer). Assumes
 * the outer query aliases `sales` as `s`, and carries its own leading `and`, so the caller writes it
 * inline as `${nodeScopeClause(input.nodeId)}` — the `activeSalesClause` convention. Shared by
 * `aggregateVatByRate` and `computeTopSellers` so the two cannot drift on how a node is scoped.
 */
export function nodeScopeClause(nodeId?: NodeId): SQL {
  return nodeId ? sql`and s.node_id = ${nodeId}` : sql``;
}
