import { asc, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { locations, nodes, locationDayCutoverChanges, type Transaction } from "@waitron/db";
import { businessDayAt, businessDayBoundaryAt, businessDayBounds } from "@waitron/shared";
import type { BusinessDayClock, NodeId } from "@waitron/shared";
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

/** A timestamp column's business-day window predicate. */
export type WindowClause = (column: SQL) => SQL;

/** Stored timestamps must use the same canonical UTC spelling as these bounds: SQLite compares text. */
function windowBetween(from: string, to: string, clock: BusinessDayClock): WindowClause {
  const start = businessDayBoundaryAt(clock, from);
  const end = businessDayBounds(clock, to).endAt;
  return (column) => sql`${column} >= ${start} and ${column} < ${end}`;
}

export function businessDayOf(instant: Date, input: BusinessDayClock): string {
  return businessDayAt(input, instant);
}

/**
 * The venue-local calendar date of an instant, as `"YYYY-MM-DD"`: it turns at local midnight, where
 * a business day turns at the cutover. The caller validates `timeZone` first.
 */
export function civilDateOf(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  return ["year", "month", "day"].map((key) => parts.find((p) => p.type === key)!.value).join("-");
}

export interface VenueMoment {
  readonly businessDay: string;
  readonly weekday: number;
  readonly timeOfDay: string;
}

/** The venue's civil weekday/time and chronological business day; null for an unreadable clock. */
export function venueMomentAt(instant: Date, clock: BusinessDayClock): VenueMoment | null {
  try {
    const businessDay = businessDayAt(clock, instant);
    const wall = new Date(wallClockMs(instant.getTime(), clock.timeZone));
    return { businessDay, weekday: wall.getUTCDay(), timeOfDay: wall.toISOString().slice(11, 16) };
  } catch {
    return null;
  }
}

function storedCutover(value: string): string {
  return /^([01]\d|2[0-3]):[0-5]\d:00$/.test(value) ? value.slice(0, 5) : value;
}

export async function readLocationClock(
  tx: Transaction,
  locationId: string,
): Promise<BusinessDayClock> {
  const rows = await tx
    .select({
      timeZone: locations.timeZone,
      dayCutover: locations.dayCutover,
      effectiveBusinessDay: locationDayCutoverChanges.effectiveBusinessDay,
      changedCutover: locationDayCutoverChanges.dayCutover,
    })
    .from(locations)
    .leftJoin(locationDayCutoverChanges, eq(locationDayCutoverChanges.locationId, locations.id))
    .where(eq(locations.id, locationId))
    .orderBy(asc(locationDayCutoverChanges.effectiveBusinessDay));
  const location = rows[0];
  if (location === undefined) throw new Error(`reporting: no location ${locationId}`);
  return {
    timeZone: location.timeZone,
    dayCutover: storedCutover(location.dayCutover),
    cutoverChanges: rows.flatMap((row) =>
      row.effectiveBusinessDay === null
        ? []
        : [
            {
              effectiveBusinessDay: row.effectiveBusinessDay,
              dayCutover: storedCutover(row.changedCutover!),
            },
          ],
    ),
  };
}

export async function resolveVenueClock(
  tx: Transaction,
  nodeId: string,
): Promise<BusinessDayClock> {
  const [node] = await tx
    .select({ locationId: nodes.locationId })
    .from(nodes)
    .where(eq(nodes.id, nodeId));
  if (node === undefined) throw new Error(`reporting: no node ${nodeId}`);
  return readLocationClock(tx, node.locationId);
}

export function currentBusinessDay(input: BusinessDayClock): string {
  validateTimeZone(input.timeZone);
  validateCutover(input.dayCutover);
  return businessDayOf(new Date(), input);
}

/**
 * The start of the daily close's window ({@link businessDayWindow}) that holds `instant`, as the
 * canonical ISO-8601 string this engine's timestamp columns hold.
 */
export function businessDayStart(instant: Date, input: BusinessDayClock): string {
  validateTimeZone(input.timeZone);
  validateCutover(input.dayCutover);
  return businessDayBoundaryAt(input, businessDayAt(input, instant));
}

/**
 * The window of ONE business day ({@link windowBetween}), for a report that applies it to several
 * columns: its boundaries are computed once, here, not once per column.
 */
export function businessDayWindow(input: DailyCloseInput): WindowClause {
  return windowBetween(input.businessDay, input.businessDay, input);
}

/**
 * The closed-range generalisation of `businessDayWindow`: the same window, opened at `from` and
 * closed after `to`, both inclusive. A single-day range is the window `businessDayWindow` builds.
 */
export function businessDayRangeWindow(input: PeriodVatInput): WindowClause {
  return windowBetween(input.fromBusinessDay, input.toBusinessDay, input);
}

/**
 * {@link businessDayRangeWindow} over a range whose zone, cutover and days are checked first.
 */
export function validatedRangeWindow(input: PeriodVatInput): WindowClause {
  validateTimeZone(input.timeZone);
  validateCutover(input.dayCutover);
  validateBusinessDayRange(input);
  return businessDayRangeWindow(input);
}

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
 * F3-canje substitute (never counted, so never reversed). Assumes the outer query joins
 * `sale_voids` as `sv` to `sales` as `s`. No leading `and`.
 */
export function reversedSalesClause(window: WindowClause): SQL {
  return sql`${window(sql`sv.voided_at`)}
      and not (${window(sql`s.issued_at`)})
      and ${notSubstituteClause()}`;
}

/**
 * The optional node predicate: `and <column> = <nodeId>` when a node is fixed, an empty fragment
 * when it is omitted (a venue-wide aggregate). `column` defaults to `s.node_id`, a `sales` row
 * aliased `s`. It carries its own leading `and`, so the caller writes it inline as
 * `${nodeScopeClause(input.nodeId)}`.
 */
export function nodeScopeClause(nodeId?: NodeId, column: SQL = sql`s.node_id`): SQL {
  return nodeId ? sql`and ${column} = ${nodeId}` : sql``;
}
