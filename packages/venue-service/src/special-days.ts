import { and, asc, eq, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { floorZones, newId, type Transaction } from "@waitron/db";
import { readLocationClock, type LocationPlace } from "@waitron/reporting";
import { AppError, isUuid, type BusinessDayClock, type ErrorParams } from "@waitron/shared";
import {
  assertBusinessDayScheduleWrite,
  assertWaitingChangeFits,
} from "./business-day-schedule.js";
import type { PaintRange, ZonePaint } from "./day-paint.js";
import { isReadableClock, venueLocalMoment } from "./hours-clock.js";
import { isLocalDate } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";
import { nextOccurrence, occurrenceIn, repeatKey, standingInYear } from "./repeat-rules.js";
import { storedTime, wireTime, type VenueScope } from "./operations.js";
import {
  departmentDayRanges,
  departmentDays,
  specialDayDates,
  specialDays,
  ZONE_PAINT_KINDS,
  zoneDayRanges,
  zoneDays,
} from "./schema/seasons.js";
import { menuPeriods } from "./schema/menus.js";
import { departments, zoneServicePolicies } from "./schema/service.js";
import { readHolidayDates } from "./holidays.js";
import { joinTouching, type ServingRead } from "./season-weeks.js";
import { inForceClock, scheduleCutovers, settledClock } from "./service-day-context.js";
import { clockTimeSkippedInDay, parseRanges, type ClosedRange } from "./service-day.js";
import "./errors.js";

export interface SpecialDayDateRule {
  date: LocalDate;
  repeats: boolean;
  /** The official name of the public holiday on `date` when it was saved, if any. */
  holidayName?: string | null;
}

/** Official public holidays by year, then by name, each at its date that year. */
export type HolidayDates = ReadonlyMap<number, ReadonlyMap<string, LocalDate>>;

export const NO_HOLIDAY_DATES: HolidayDates = new Map();

const yearOf = (date: LocalDate) => Number(date.slice(0, 4));

const followsHoliday = (rule: SpecialDayDateRule) =>
  rule.repeats && rule.holidayName !== undefined && rule.holidayName !== null;

/** The holiday lists the rules need over `years` (by default their `holidayHorizon`): none, and
 *  nothing read, when no rule is a repeating date that follows a holiday's name. */
export async function holidayDatesFor(
  tx: Transaction,
  cfg: VenueScope,
  rules: readonly SpecialDayDateRule[],
  [fromYear, toYear]: readonly [number, number] = holidayHorizon(rules),
  place?: LocationPlace,
): Promise<HolidayDates> {
  const named = rules.filter(followsHoliday);
  if (named.length === 0) return NO_HOLIDAY_DATES;
  const first = Math.min(...named.map((rule) => yearOf(rule.date))) + 1;
  return readHolidayDates(tx, cfg, Math.max(fromYear, first), toYear, place);
}

const yearsInOrder = new WeakMap<HolidayDates, readonly number[]>();

/** The years `holidays` holds, ascending; sorted once per map. */
function holidayYears(holidays: HolidayDates): readonly number[] {
  let years = yearsInOrder.get(holidays);
  if (years === undefined) {
    years = [...holidays.keys()].sort((a, b) => a - b);
    yearsInOrder.set(holidays, years);
  }
  return years;
}

/** The official name of the first public holiday on `date`, or null. */
function holidayNameOn(holidays: HolidayDates, date: LocalDate): string | null {
  for (const [name, on] of holidays.get(yearOf(date)) ?? []) if (on === date) return name;
  return null;
}

/** The years a check over every future occurrence walks, from the earliest date: 400 from it, or
 *  from `walkFrom` when that is later. No years without rules. */
export function holidayHorizon(
  rules: readonly { date: LocalDate }[],
  walkFrom = -Infinity,
): [number, number] {
  if (rules.length === 0) return [1, 0];
  const first = Math.min(...rules.map((rule) => yearOf(rule.date)));
  return [first, Math.min(Math.max(first, walkFrom) + 400, 9999)];
}

/** Where a special-day date falls in `year`: a one-off only in its own year, a repeating one from
 *  its first year on, and a 29 February only in leap years. A repeating date saved on a public
 *  holiday falls, after its first year, where `holidays` puts a holiday of that name that year, and
 *  nowhere when there is none. Null when it does not fall in `year`. */
export function specialDateIn(
  rule: SpecialDayDateRule,
  year: number,
  holidays: HolidayDates,
): LocalDate | null {
  if (!followsHoliday(rule) || year <= yearOf(rule.date)) return occurrenceIn(rule, year);
  return holidays.get(year)?.get(rule.holidayName!) ?? null;
}

/** Whether a date's place in `year` comes from its holiday's name, not its month and day: every
 *  year after its first, for a repeating date saved on a public holiday. */
function followsHolidayIn(rule: SpecialDayDateRule, year: number): boolean {
  return followsHoliday(rule) && year > yearOf(rule.date);
}

/** Which special-day date stands on each day of `year`, by `standingInYear`. */
export function specialDatesStandingIn<T extends SpecialDayDateRule>(
  rules: readonly T[],
  year: number,
  holidays: HolidayDates,
): Map<LocalDate, T> {
  return standingInYear(
    rules,
    year,
    (rule, at) => specialDateIn(rule, at, holidays),
    followsHolidayIn,
  );
}

/** The first day two special-day dates would both stand on, or null when they never meet. A date
 *  following a holiday's name is compared in every year `holidays` holds as well. */
export function sharedSpecialDate(
  a: SpecialDayDateRule,
  b: SpecialDayDateRule,
  holidays: HolidayDates,
): LocalDate | null {
  if (specialDateIn(a, yearOf(b.date), holidays) === b.date) return b.date;
  if (specialDateIn(b, yearOf(a.date), holidays) === a.date) return a.date;
  if (!a.repeats || !b.repeats || (!followsHoliday(a) && !followsHoliday(b))) return null;
  const after = Math.max(yearOf(a.date), yearOf(b.date));
  for (const year of holidayYears(holidays)) {
    if (year <= after) continue;
    const date = specialDateIn(a, year, holidays);
    if (date !== null && date === specialDateIn(b, year, holidays)) return date;
  }
  return null;
}

/** The first day on or after `from` a special-day date stands on, or null. */
function nextSpecialDate(
  rule: SpecialDayDateRule,
  from: LocalDate,
  holidays: HolidayDates,
): LocalDate | null {
  if (!followsHoliday(rule)) return nextOccurrence(rule, from);
  if (rule.date >= from) return rule.date;
  for (const year of holidayYears(holidays)) {
    const date = specialDateIn(rule, year, holidays);
    if (date !== null && date >= from) return date;
  }
  return null;
}

/** The first range end the clocks skip on a special-day date's business day, or null; a repeating
 *  date is checked at its next occurrence from `from`. */
export function firstSkippedEnd<T extends ClosedRange>(
  clock: BusinessDayClock,
  rule: SpecialDayDateRule,
  from: LocalDate,
  ranges: readonly T[],
  holidays: HolidayDates,
): { range: T; end: "startsAt" | "endsAt"; date: LocalDate } | null {
  const date = rule.repeats ? (nextSpecialDate(rule, from, holidays) ?? rule.date) : rule.date;
  for (const range of ranges)
    for (const end of ["startsAt", "endsAt"] as const)
      if (clockTimeSkippedInDay(clock, date, range[end], end === "endsAt"))
        return { range, end, date };
  return null;
}

export interface SpecialDayOccurrence {
  specialDayId: string;
  name: string;
  dateId: string;
  storedDate: LocalDate;
  closedAllDay: boolean;
  paint: ReadonlyMap<string, PaintRange[]>;
  zonePaint: ReadonlyMap<string, ZonePaint[]>;
}

/** The special-day date standing on each of `days` (null when none), with its paint for every
 *  department and zone: one read of the dates, and one of the paint only when any date matched. */
export async function specialDaysOn(
  tx: Transaction,
  cfg: VenueScope,
  days: readonly LocalDate[],
  place?: LocationPlace,
): Promise<Map<LocalDate, SpecialDayOccurrence | null>> {
  const found = new Map<LocalDate, SpecialDayOccurrence | null>(days.map((day) => [day, null]));
  if (days.length === 0) return found;
  const ordered = [...new Set(days)].sort();
  const dates = await tx
    .select({
      specialDayId: specialDayDates.specialDayId,
      name: specialDays.name,
      dateId: specialDayDates.id,
      date: specialDayDates.date,
      closedAllDay: specialDayDates.closedAllDay,
      repeats: specialDays.repeatsYearly,
      holidayName: specialDayDates.holidayName,
    })
    .from(specialDayDates)
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))
    .where(
      and(
        eq(specialDayDates.locationId, cfg.locationId),
        or(
          inArray(specialDayDates.date, ordered),
          and(
            eq(specialDays.repeatsYearly, true),
            or(
              inArray(sql`substr(${specialDayDates.date}, 6)`, [
                ...new Set(ordered.map(repeatKey)),
              ]),
              isNotNull(specialDayDates.holidayName),
            ),
            lte(specialDayDates.date, ordered[ordered.length - 1]!),
          ),
        ),
      ),
    )
    .orderBy(asc(specialDayDates.date), asc(specialDayDates.id));
  const holidays = await holidayDatesFor(
    tx,
    cfg,
    dates,
    [yearOf(ordered[0]!), yearOf(ordered[ordered.length - 1]!)],
    place,
  );
  const matched = new Map<LocalDate, (typeof dates)[number]>();
  const standingByYear = new Map<number, Map<LocalDate, (typeof dates)[number]>>();
  for (const day of ordered) {
    let standing = standingByYear.get(yearOf(day));
    if (standing === undefined) {
      standing = specialDatesStandingIn(dates, yearOf(day), holidays);
      standingByYear.set(yearOf(day), standing);
    }
    const row = standing.get(day);
    if (row !== undefined) matched.set(day, row);
  }
  if (matched.size === 0) return found;
  const occurrence = await occurrencesOf(tx, [
    ...new Set([...matched.values()].map((r) => r.dateId)),
  ]);
  for (const [day, row] of matched) found.set(day, occurrence(row));
  return found;
}

interface OccurrenceRow {
  specialDayId: string;
  name: string;
  dateId: string;
  date: LocalDate;
  closedAllDay: boolean;
}

/** One read of the department and zone paint of `dateIds`, and a builder of each date's
 *  occurrence from it. */
async function occurrencesOf(
  tx: Transaction,
  dateIds: readonly string[],
): Promise<(row: OccurrenceRow) => SpecialDayOccurrence> {
  const paint = await tx
    .select({
      dateId: departmentDays.specialDayDateId,
      ownerId: departmentDays.departmentId,
      periodId: departmentDayRanges.periodId,
      kind: sql<ZonePaint["kind"] | null>`null`,
      startsAt: departmentDayRanges.startsAt,
      endsAt: departmentDayRanges.endsAt,
    })
    .from(departmentDays)
    .innerJoin(departmentDayRanges, eq(departmentDayRanges.dayId, departmentDays.id))
    .where(inArray(departmentDays.specialDayDateId, [...dateIds]))
    .unionAll(
      tx
        .select({
          dateId: zoneDays.specialDayDateId,
          ownerId: zoneDays.zoneId,
          periodId: sql<string | null>`null`,
          kind: zoneDayRanges.kind,
          startsAt: zoneDayRanges.startsAt,
          endsAt: zoneDayRanges.endsAt,
        })
        .from(zoneDays)
        .innerJoin(zoneDayRanges, eq(zoneDayRanges.dayId, zoneDays.id))
        .where(inArray(zoneDays.specialDayDateId, [...dateIds])),
    );
  const departmentPaint = new Map<string, Map<string, PaintRange[]>>();
  const zonePaint = new Map<string, Map<string, ZonePaint[]>>();
  const add = <T>(
    into: Map<string, Map<string, T[]>>,
    dateId: string,
    ownerId: string,
    item: T,
  ) => {
    const owners = into.get(dateId) ?? new Map<string, T[]>();
    into.set(dateId, owners);
    owners.set(ownerId, [...(owners.get(ownerId) ?? []), item]);
  };
  for (const row of paint) {
    const range = { startsAt: wireTime(row.startsAt), endsAt: wireTime(row.endsAt) };
    if (row.kind === null)
      add(departmentPaint, row.dateId!, row.ownerId, { periodId: row.periodId, ...range });
    else add(zonePaint, row.dateId!, row.ownerId, { kind: row.kind, ...range });
  }
  return (row) => ({
    specialDayId: row.specialDayId,
    name: row.name,
    dateId: row.dateId,
    storedDate: row.date,
    closedAllDay: row.closedAllDay,
    paint: departmentPaint.get(row.dateId) ?? new Map(),
    zonePaint: zonePaint.get(row.dateId) ?? new Map(),
  });
}

/** The location's special day `specialDayId` and each of its dates' own occurrence, at its stored
 *  date, in date order: one read of the day with its dates, and one of the paint when it has dates.
 *  Null when the location has no such special day. */
export async function specialDayOccurrences(
  tx: Transaction,
  cfg: VenueScope,
  specialDayId: string,
): Promise<{ name: string; occurrences: SpecialDayOccurrence[] } | null> {
  const rows = await tx
    .select({
      name: specialDays.name,
      dateId: specialDayDates.id,
      date: specialDayDates.date,
      closedAllDay: specialDayDates.closedAllDay,
    })
    .from(specialDays)
    .leftJoin(specialDayDates, eq(specialDayDates.specialDayId, specialDays.id))
    .where(and(eq(specialDays.id, specialDayId), eq(specialDays.locationId, cfg.locationId)))
    .orderBy(asc(specialDayDates.date), asc(specialDayDates.id));
  const [first] = rows;
  if (first === undefined) return null;
  const dates = rows.flatMap(({ name, dateId, date, closedAllDay }) =>
    dateId === null
      ? []
      : [{ specialDayId, name, dateId, date: date!, closedAllDay: closedAllDay! }],
  );
  if (dates.length === 0) return { name: first.name, occurrences: [] };
  const occurrence = await occurrencesOf(
    tx,
    dates.map((d) => d.dateId),
  );
  return { name: first.name, occurrences: dates.map(occurrence) };
}

export interface MissingHoliday {
  specialDayId: string;
  holidayName: string;
  year: number;
}

export interface SpecialDayClash {
  date: LocalDate;
  /** The special day that applies on `date`. */
  specialDayId: string;
  specialDayName: string;
  /** The special day whose date falls on `date` too, and does not apply there. */
  otherSpecialDayId: string;
  otherSpecialDayName: string;
}

/** The special-day readiness warnings for the venue's current and next year: each repeating date
 *  following a holiday's name that a year's list places nowhere, and each date that falls where a
 *  different special day applies. The holiday lists are read once for both. */
export async function specialDayReadiness(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<{ missing: MissingHoliday[]; clashes: SpecialDayClash[] }> {
  const clock = await readLocationClock(tx, cfg.locationId);
  const today = venueLocalMoment(at, clock)?.civilDate ?? at.toISOString().slice(0, 10);
  const years = [yearOf(today), yearOf(today) + 1] as const;
  // Ordered as `specialDaysOn` reads them, so the day named as applying is the one that does.
  const rows = await tx
    .select({
      specialDayId: specialDayDates.specialDayId,
      name: specialDays.name,
      date: specialDayDates.date,
      repeats: specialDays.repeatsYearly,
      holidayName: specialDayDates.holidayName,
    })
    .from(specialDayDates)
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))
    .where(eq(specialDayDates.locationId, cfg.locationId))
    .orderBy(asc(specialDayDates.date), asc(specialDayDates.id));
  const holidays = await holidayDatesFor(tx, cfg, rows, years);
  const missing = await missingHolidaysIn(tx, cfg, years, holidays);
  const clashes = new Map<string, SpecialDayClash>();
  for (const year of years) {
    const standing = specialDatesStandingIn(rows, year, holidays);
    for (const row of rows) {
      const date = specialDateIn(row, year, holidays);
      if (date === null) continue;
      const applies = standing.get(date);
      if (applies === undefined || applies.specialDayId === row.specialDayId) continue;
      clashes.set(`${date}|${row.specialDayId}`, {
        date,
        specialDayId: applies.specialDayId,
        specialDayName: applies.name,
        otherSpecialDayId: row.specialDayId,
        otherSpecialDayName: row.name,
      });
    }
  }
  return {
    missing: missing.map(({ specialDayId, holidayName, year }) => ({
      specialDayId,
      holidayName,
      year,
    })),
    clashes: [...clashes.values()],
  };
}

/** Each repeating date following a holiday's name that the list for one of `years`, ascending,
 *  places nowhere, that year having no holiday of the name or no list, each naming its special
 *  day. `known`, when given, holds the official holidays of every one of `years` and is read
 *  instead. */
export async function missingHolidaysIn(
  tx: Transaction,
  cfg: VenueScope,
  years: readonly number[],
  known?: HolidayDates,
): Promise<(MissingHoliday & { name: string })[]> {
  const rows = await tx
    .select({
      specialDayId: specialDayDates.specialDayId,
      name: specialDays.name,
      date: specialDayDates.date,
      holidayName: specialDayDates.holidayName,
    })
    .from(specialDayDates)
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))
    .where(
      and(
        eq(specialDayDates.locationId, cfg.locationId),
        eq(specialDays.repeatsYearly, true),
        isNotNull(specialDayDates.holidayName),
      ),
    )
    .orderBy(asc(specialDayDates.date), asc(specialDayDates.id));
  if (rows.length === 0 || years.length === 0) return [];
  const rules = rows.map((row) => ({ ...row, repeats: true }));
  const holidays = known ?? (await holidayDatesFor(tx, cfg, rules, [years[0]!, years.at(-1)!]));
  const missing = new Map<string, MissingHoliday & { name: string }>();
  for (const year of years)
    for (const rule of rules)
      if (year > yearOf(rule.date) && specialDateIn(rule, year, holidays) === null)
        missing.set(`${rule.specialDayId}|${rule.holidayName}|${year}`, {
          specialDayId: rule.specialDayId,
          name: rule.name,
          holidayName: rule.holidayName!,
          year,
        });
  return [...missing.values()];
}

export interface SpecialDayInput {
  name: string;
  repeatsYearly: boolean;
  dates: readonly { date: LocalDate; closedAllDay: boolean }[];
  paint?: readonly { departmentId: string; date: LocalDate; ranges: readonly PaintRange[] }[];
  zonePaint?: readonly { zoneId: string; date: LocalDate; ranges: readonly ZonePaint[] }[];
}

/** A stored date; `holidayName` is the public holiday it was saved on, absent on an ordinary date. */
export interface StoredSpecialDayDate {
  date: LocalDate;
  closedAllDay: boolean;
  holidayName?: string;
}

export interface SpecialDaySummary {
  id: string;
  name: string;
  repeatsYearly: boolean;
  dates: StoredSpecialDayDate[];
}

export interface SpecialDayDetail extends SpecialDaySummary {
  paint: { departmentId: string; date: LocalDate; ranges: PaintRange[] }[];
  zonePaint: { zoneId: string; date: LocalDate; ranges: ZonePaint[] }[];
}

type Refusal = Omit<ErrorParams["special_day.invalid"], "field">;

function invalid(field: string, extra: Refusal = {}): never {
  throw new AppError("special_day.invalid", { field, ...extra });
}

const record = (value: unknown, field: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
};

/** `position` is the range's place in the request, which `parseRanges` reorders. */
type Placed<T> = T & { position: number };

interface ParsedEntry<T> {
  ownerId: string;
  date: LocalDate;
  ranges: Placed<T>[];
  /** Refuses the entry, or the part of it at `path` (such as `ranges.0.startsAt`). */
  refuse: (path: string, extra: Refusal) => never;
}

type CutoversOf = (date: LocalDate) => string[];

const cutoversFor =
  (
    clocks: { settled: BusinessDayClock; inForce: BusinessDayClock },
    repeats: boolean,
  ): CutoversOf =>
  (date) =>
    repeats ? scheduleCutovers(clocks.inForce) : scheduleCutovers(clocks.settled, date);

function readPaintRange(
  entry: Record<string, unknown>,
  at: string,
  range: ClosedRange,
): PaintRange {
  const { periodId } = entry;
  if (periodId === null) return { periodId: null, ...range };
  if (typeof periodId !== "string" || !isUuid(periodId)) invalid(`${at}.periodId`);
  return { periodId: periodId.toLowerCase(), ...range };
}

function readZoneRange(entry: Record<string, unknown>, at: string, range: ClosedRange): ZonePaint {
  const kind = entry.kind as ZonePaint["kind"];
  if (!ZONE_PAINT_KINDS.includes(kind)) invalid(`${at}.kind`);
  return { kind, ...range };
}

/** Parses one owner's ranges on one date under every changeover `cutoversOf` gives that date. */
function parseOwnRanges<T extends ClosedRange>(
  ranges: unknown,
  field: string,
  cutoversOf: CutoversOf,
  date: LocalDate,
  refuse: (at: string, extra: Refusal) => never,
  read: (entry: Record<string, unknown>, at: string, range: ClosedRange) => T,
): Placed<T>[] {
  return cutoversOf(date).map((cutover) =>
    parseRanges(
      ranges,
      field,
      cutover,
      (at, reason) => refuse(at, reason === undefined ? {} : { reason }),
      (item, at, range, index): Placed<T> => ({ ...read(item, at, range), position: index }),
    ),
  )[0]!;
}

/** Each entry of a `paint` or `zonePaint` list, refusing a date the input lacks and a second entry
 *  for one owner and date (the save replaces an owner's date whole, so a second entry would
 *  silently discard the first). */
function parseEntries<T extends ClosedRange>(
  value: unknown,
  list: "paint" | "zonePaint",
  ownerKey: "departmentId" | "zoneId",
  cutoversOf: CutoversOf,
  dates: ReadonlySet<LocalDate>,
  read: (entry: Record<string, unknown>, at: string, range: ClosedRange) => T,
): ParsedEntry<T>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid(list);
  const seen = new Set<string>();
  return value.map((item: unknown, index): ParsedEntry<T> => {
    const field = `${list}.${index}`;
    const entry = record(item, field);
    const ownerId = entry[ownerKey];
    if (typeof ownerId !== "string" || !isUuid(ownerId)) invalid(`${field}.${ownerKey}`);
    const { date } = entry;
    if (!isLocalDate(date) || !dates.has(date)) invalid(`${field}.date`);
    const key = `${ownerId.toLowerCase()}|${date}`;
    if (seen.has(key)) invalid(field, { reason: "overlap" });
    seen.add(key);
    const ranges = parseOwnRanges(entry.ranges, `${field}.ranges`, cutoversOf, date, invalid, read);
    return {
      ownerId: ownerId.toLowerCase(),
      date,
      ranges,
      refuse: (path, extra) => invalid(`${field}.${path}`, extra),
    };
  });
}

/** The paint of `stored` that the save keeps without the request naming it — on a kept date, for an
 *  owner and date the request does not paint — parsed as the save's own paint is. The request never
 *  sent it, so a refusal names the list and the owner and date instead of a request path. */
function retainedEntries<T extends ClosedRange>(
  stored: readonly { ownerId: string; date: LocalDate; ranges: readonly unknown[] }[],
  list: "paint" | "zonePaint",
  ownerKey: "departmentId" | "zoneId",
  supplied: readonly ParsedEntry<unknown>[],
  dates: ReadonlySet<LocalDate>,
  cutoversOf: CutoversOf,
  read: (entry: Record<string, unknown>, at: string, range: ClosedRange) => T,
): ParsedEntry<T>[] {
  const named = new Set(supplied.map((entry) => `${entry.ownerId}|${entry.date}`));
  return stored
    .filter((entry) => dates.has(entry.date) && !named.has(`${entry.ownerId}|${entry.date}`))
    .map(({ ownerId, date, ranges }) => {
      const refuse = (_path: string, extra: Refusal): never =>
        invalid(list, { [ownerKey]: ownerId, date, ...extra });
      return {
        ownerId,
        date,
        ranges: parseOwnRanges(ranges, list, cutoversOf, date, refuse, read),
        refuse,
      };
    });
}

function parseInput(
  value: unknown,
  clocks: { settled: BusinessDayClock; inForce: BusinessDayClock },
) {
  const input = record(value, "input");
  const { name, repeatsYearly } = input;
  if (typeof name !== "string" || name.trim() === "") invalid("name");
  if (typeof repeatsYearly !== "boolean") invalid("repeatsYearly");
  if (!Array.isArray(input.dates)) invalid("dates");
  const dates = input.dates.map((item: unknown, index) => {
    const entry = record(item, `dates.${index}`);
    if (!isLocalDate(entry.date)) invalid(`dates.${index}.date`);
    if (typeof entry.closedAllDay !== "boolean") invalid(`dates.${index}.closedAllDay`);
    return { date: entry.date, closedAllDay: entry.closedAllDay };
  });
  // A repeating day's dates meeting in a later year is refused by the save, once it knows which
  // dates follow a holiday's name.
  dates.forEach((entry, index) => {
    if (dates.slice(0, index).some((earlier) => earlier.date === entry.date))
      invalid(`dates.${index}.date`, { reason: "overlap" });
  });
  const held = new Set(dates.map((entry) => entry.date));
  const cutoversOf = cutoversFor(clocks, repeatsYearly);
  const paint = parseEntries(
    input.paint,
    "paint",
    "departmentId",
    cutoversOf,
    held,
    readPaintRange,
  );
  const zonePaint = parseEntries(
    input.zonePaint,
    "zonePaint",
    "zoneId",
    cutoversOf,
    held,
    readZoneRange,
  );
  return { name: name.trim(), repeatsYearly, dates, held, cutoversOf, paint, zonePaint };
}

/** Refuses the first painted department, then the first painted zone, in request order, that is not
 *  one of the venue's active departments or active service zones; gives each painted zone's
 *  department. */
async function assertPaintOwners(
  tx: Transaction,
  cfg: VenueScope,
  departmentIds: readonly string[],
  zoneIds: readonly string[],
): Promise<Map<string, string>> {
  if (departmentIds.length > 0) {
    const found = new Set(
      (
        await tx
          .select({ id: departments.id })
          .from(departments)
          .where(
            and(
              inArray(departments.id, [...new Set(departmentIds)]),
              eq(departments.locationId, cfg.locationId),
              eq(departments.active, true),
            ),
          )
      ).map((row) => row.id),
    );
    const missing = departmentIds.find((id) => !found.has(id));
    if (missing !== undefined)
      throw new AppError("department.not_found", { departmentId: missing });
  }
  if (zoneIds.length === 0) return new Map();
  const departmentOf = new Map(
    (
      await tx
        .select({ id: zoneServicePolicies.zoneId, departmentId: zoneServicePolicies.departmentId })
        .from(zoneServicePolicies)
        .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
        .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
        .where(
          and(
            eq(zoneServicePolicies.locationId, cfg.locationId),
            inArray(zoneServicePolicies.zoneId, [...new Set(zoneIds)]),
            eq(departments.active, true),
            eq(floorZones.active, true),
            eq(floorZones.locationId, cfg.locationId),
          ),
        )
    ).map((row) => [row.id, row.departmentId] as const),
  );
  const missing = zoneIds.find((id) => !departmentOf.has(id));
  if (missing !== undefined) throw new AppError("service_zone.not_found", { zoneId: missing });
  return departmentOf;
}

/** Refuses a painted period that is not the painted department's own. */
async function assertOwnPeriods(
  tx: Transaction,
  paint: readonly ParsedEntry<PaintRange>[],
): Promise<void> {
  const ids = [
    ...new Set(paint.flatMap((entry) => entry.ranges.flatMap((range) => range.periodId ?? []))),
  ];
  if (ids.length === 0) return;
  const owner = new Map(
    (
      await tx
        .select({ id: menuPeriods.id, departmentId: menuPeriods.departmentId })
        .from(menuPeriods)
        .where(inArray(menuPeriods.id, ids))
    ).map((row) => [row.id, row.departmentId]),
  );
  for (const entry of paint)
    entry.ranges.forEach((range) => {
      if (range.periodId !== null && owner.get(range.periodId) !== entry.ownerId)
        entry.refuse(`ranges.${range.position}.periodId`, { departmentId: entry.ownerId });
    });
}

/** Refuses a painted time the clocks skip on the date's business day; a repeating date is checked
 *  at its next occurrence from the venue's today. */
function assertNoSkippedTimes(
  clock: BusinessDayClock,
  today: LocalDate | null,
  ruleOf: (date: LocalDate) => SpecialDayDateRule,
  holidays: HolidayDates,
  entries: readonly ParsedEntry<ClosedRange>[],
): void {
  if (!isReadableClock(clock)) return;
  for (const entry of entries) {
    const skipped = firstSkippedEnd(
      clock,
      ruleOf(entry.date),
      today ?? entry.date,
      entry.ranges,
      holidays,
    );
    if (skipped !== null)
      entry.refuse(`ranges.${skipped.range.position}.${skipped.end}`, {
        reason: "clock_skips",
        date: skipped.date,
      });
  }
}

/** Refuses a date that another special day of the venue also stands on;
 *  `holidays` covers the rules' years through `holidayHorizon`. */
async function assertDatesFree(
  tx: Transaction,
  cfg: VenueScope,
  ownId: string | null,
  rules: readonly SpecialDayDateRule[],
  holidays: HolidayDates,
): Promise<void> {
  if (rules.length === 0) return;
  const dates = rules.map((rule) => rule.date);
  const others = await tx
    .select({
      specialDayId: specialDays.id,
      name: specialDays.name,
      repeats: specialDays.repeatsYearly,
      date: specialDayDates.date,
      holidayName: specialDayDates.holidayName,
    })
    .from(specialDayDates)
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))
    .where(
      and(
        eq(specialDayDates.locationId, cfg.locationId),
        ownId === null ? undefined : ne(specialDays.id, ownId),
        // A date following a holiday's name can meet any month and day in a later year.
        rules.some(followsHoliday)
          ? undefined
          : or(
              inArray(sql`substr(${specialDayDates.date}, 6)`, [...new Set(dates.map(repeatKey))]),
              and(eq(specialDays.repeatsYearly, true), isNotNull(specialDayDates.holidayName)),
            ),
      ),
    )
    .orderBy(asc(specialDayDates.date));
  for (const rule of rules)
    for (const other of others) {
      const shared = sharedSpecialDate(rule, other, holidays);
      if (shared !== null)
        throw new AppError("special_day.date_taken", {
          date: shared,
          specialDayId: other.specialDayId,
          name: other.name,
        });
    }
}

async function requireSpecialDay(tx: Transaction, cfg: VenueScope, id: string) {
  const [row] = await tx
    .select()
    .from(specialDays)
    .where(and(eq(specialDays.id, id), eq(specialDays.locationId, cfg.locationId)));
  if (row === undefined) throw new AppError("special_day.not_found", { specialDayId: id });
  return row;
}

const storedDate = (row: {
  date: LocalDate;
  closedAllDay: boolean;
  holidayName: string | null;
}): StoredSpecialDayDate => ({
  date: row.date,
  closedAllDay: row.closedAllDay,
  ...(row.holidayName === null ? {} : { holidayName: row.holidayName }),
});

/** Every special day of the venue with its dates, by name then id; no paint. */
export async function listSpecialDays(
  tx: Transaction,
  cfg: VenueScope,
): Promise<SpecialDaySummary[]> {
  const days = await tx
    .select({
      id: specialDays.id,
      name: specialDays.name,
      repeatsYearly: specialDays.repeatsYearly,
    })
    .from(specialDays)
    .where(eq(specialDays.locationId, cfg.locationId))
    .orderBy(asc(specialDays.name), asc(specialDays.id));
  if (days.length === 0) return [];
  const dates = await tx
    .select({
      specialDayId: specialDayDates.specialDayId,
      date: specialDayDates.date,
      closedAllDay: specialDayDates.closedAllDay,
      holidayName: specialDayDates.holidayName,
    })
    .from(specialDayDates)
    .where(
      inArray(
        specialDayDates.specialDayId,
        days.map((day) => day.id),
      ),
    )
    .orderBy(asc(specialDayDates.date));
  const byDay = new Map(days.map((day) => [day.id, [] as StoredSpecialDayDate[]]));
  for (const row of dates) byDay.get(row.specialDayId)!.push(storedDate(row));
  return days.map((day) => ({ ...day, dates: byDay.get(day.id)! }));
}

export async function readSpecialDay(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
): Promise<SpecialDayDetail> {
  const day = await requireSpecialDay(tx, cfg, id);
  const dates = await tx
    .select({
      id: specialDayDates.id,
      date: specialDayDates.date,
      closedAllDay: specialDayDates.closedAllDay,
      holidayName: specialDayDates.holidayName,
    })
    .from(specialDayDates)
    .where(eq(specialDayDates.specialDayId, id))
    .orderBy(asc(specialDayDates.date));
  const dateOf = new Map(dates.map((row) => [row.id, row.date]));
  const detail: SpecialDayDetail = {
    id: day.id,
    name: day.name,
    repeatsYearly: day.repeatsYearly,
    dates: dates.map(storedDate),
    paint: [],
    zonePaint: [],
  };
  if (dates.length === 0) return detail;
  const dateIds = [...dateOf.keys()];
  const paint = await tx
    .select({
      dateId: departmentDays.specialDayDateId,
      departmentId: departmentDays.departmentId,
      periodId: departmentDayRanges.periodId,
      startsAt: departmentDayRanges.startsAt,
      endsAt: departmentDayRanges.endsAt,
    })
    .from(departmentDays)
    .innerJoin(departmentDayRanges, eq(departmentDayRanges.dayId, departmentDays.id))
    .where(inArray(departmentDays.specialDayDateId, dateIds))
    .orderBy(asc(departmentDays.departmentId), asc(departmentDayRanges.startsAt));
  const zonePaint = await tx
    .select({
      dateId: zoneDays.specialDayDateId,
      zoneId: zoneDays.zoneId,
      kind: zoneDayRanges.kind,
      startsAt: zoneDayRanges.startsAt,
      endsAt: zoneDayRanges.endsAt,
    })
    .from(zoneDays)
    .innerJoin(zoneDayRanges, eq(zoneDayRanges.dayId, zoneDays.id))
    .where(inArray(zoneDays.specialDayDateId, dateIds))
    .orderBy(asc(zoneDays.zoneId), asc(zoneDayRanges.startsAt));
  const group = <T>(rows: readonly { dateId: string | null; ownerId: string; range: T }[]) => {
    const byKey = new Map<string, { ownerId: string; date: LocalDate; ranges: T[] }>();
    for (const row of rows) {
      const date = dateOf.get(row.dateId!)!;
      const key = `${date}|${row.ownerId}`;
      const entry = byKey.get(key) ?? { ownerId: row.ownerId, date, ranges: [] };
      byKey.set(key, entry);
      entry.ranges.push(row.range);
    }
    return [...byKey.values()].sort((a, b) =>
      a.date === b.date ? (a.ownerId < b.ownerId ? -1 : 1) : a.date < b.date ? -1 : 1,
    );
  };
  detail.paint = group(
    paint.map((row) => ({
      dateId: row.dateId,
      ownerId: row.departmentId,
      range: {
        periodId: row.periodId,
        startsAt: wireTime(row.startsAt),
        endsAt: wireTime(row.endsAt),
      },
    })),
  ).map(({ ownerId, date, ranges }) => ({ departmentId: ownerId, date, ranges }));
  detail.zonePaint = group(
    zonePaint.map((row) => ({
      dateId: row.dateId,
      ownerId: row.zoneId,
      range: { kind: row.kind, startsAt: wireTime(row.startsAt), endsAt: wireTime(row.endsAt) },
    })),
  ).map(({ ownerId, date, ranges }) => ({ zoneId: ownerId, date, ranges }));
  return detail;
}

/** Saves a special day in the caller's transaction. Dates are compared by value, so a kept date keeps
 *  its row and every paint the request does not name; a named (owner, date) is replaced whole, and
 *  given empty ranges it is cleared. Then runs `afterWrite` with the clock and the painted zones'
 *  departments this save read. */
export async function saveSpecialDay(
  tx: Transaction,
  cfg: VenueScope,
  id: string | null,
  input: unknown,
  at: Date,
  expectedClockRevision: number,
  afterWrite?: (read: ServingRead) => Promise<void>,
): Promise<SpecialDayDetail> {
  await assertBusinessDayScheduleWrite(tx, cfg, "time", expectedClockRevision);
  const stored = id === null ? null : await readSpecialDay(tx, cfg, id);
  const clock = await readLocationClock(tx, cfg.locationId);
  const inForce = inForceClock(clock, at);
  const parsed = parseInput(input, { settled: settledClock(clock, at), inForce });
  const zoneDepartments = await assertPaintOwners(
    tx,
    cfg,
    parsed.paint.map((entry) => entry.ownerId),
    parsed.zonePaint.map((entry) => entry.ownerId),
  );
  await assertOwnPeriods(tx, parsed.paint);
  // Kept paint changes meaning only when the repeat setting changes; otherwise a yearly day's next
  // occurrence moving on would refuse a rename over paint the request never touched.
  const recheck = stored !== null && stored.repeatsYearly !== parsed.repeatsYearly;
  const retainedPaint = retainedEntries(
    (recheck ? stored.paint : []).map(({ departmentId, ...entry }) => ({
      ownerId: departmentId,
      ...entry,
    })),
    "paint",
    "departmentId",
    parsed.paint,
    parsed.held,
    parsed.cutoversOf,
    readPaintRange,
  );
  const retainedZonePaint = retainedEntries(
    (recheck ? stored.zonePaint : []).map(({ zoneId, ...entry }) => ({
      ownerId: zoneId,
      ...entry,
    })),
    "zonePaint",
    "zoneId",
    parsed.zonePaint,
    parsed.held,
    parsed.cutoversOf,
    readZoneRange,
  );
  const keptNames = new Map(
    (stored?.dates ?? []).map((entry) => [entry.date, entry.holidayName ?? null]),
  );
  const holidays = await readHolidayDates(tx, cfg, ...holidayHorizon(parsed.dates));
  const rules = parsed.dates.map(({ date }): SpecialDayDateRule => ({
    date,
    repeats: parsed.repeatsYearly,
    holidayName: keptNames.has(date) ? keptNames.get(date)! : holidayNameOn(holidays, date),
  }));
  rules.forEach((rule, index) => {
    for (const earlier of rules.slice(0, index))
      if (sharedSpecialDate(earlier, rule, holidays) !== null)
        invalid(`dates.${index}.date`, { reason: "overlap" });
  });
  const ruleOf = new Map(rules.map((rule) => [rule.date, rule]));
  const today = venueLocalMoment(at, clock)?.civilDate ?? null;
  assertNoSkippedTimes(clock, today, (date) => ruleOf.get(date)!, holidays, [
    ...parsed.paint,
    ...parsed.zonePaint,
    ...retainedPaint,
    ...retainedZonePaint,
  ]);
  await assertDatesFree(tx, cfg, id, rules, holidays);

  const values = { name: parsed.name, repeatsYearly: parsed.repeatsYearly };
  const specialDayId = id ?? newId();
  if (id === null)
    await tx
      .insert(specialDays)
      .values({ id: specialDayId, locationId: cfg.locationId, ...values });
  else await tx.update(specialDays).set(values).where(eq(specialDays.id, id));

  const existing = await tx
    .select({
      id: specialDayDates.id,
      date: specialDayDates.date,
      closedAllDay: specialDayDates.closedAllDay,
    })
    .from(specialDayDates)
    .where(eq(specialDayDates.specialDayId, specialDayId));
  const wanted = new Map(parsed.dates.map((entry) => [entry.date, entry.closedAllDay]));
  const removed = existing.filter((row) => !wanted.has(row.date)).map((row) => row.id);
  if (removed.length > 0)
    await tx.delete(specialDayDates).where(inArray(specialDayDates.id, removed));
  const dateIds = new Map<LocalDate, string>();
  for (const row of existing) {
    const closedAllDay = wanted.get(row.date);
    if (closedAllDay === undefined) continue;
    dateIds.set(row.date, row.id);
    if (closedAllDay !== row.closedAllDay)
      await tx.update(specialDayDates).set({ closedAllDay }).where(eq(specialDayDates.id, row.id));
  }
  const added = parsed.dates
    .filter((entry) => !dateIds.has(entry.date))
    .map((entry) => ({
      ...entry,
      id: newId(),
      specialDayId,
      locationId: cfg.locationId,
      holidayName: ruleOf.get(entry.date)!.holidayName,
    }));
  if (added.length > 0) await tx.insert(specialDayDates).values(added);
  for (const row of added) dateIds.set(row.date, row.id);

  for (const entry of parsed.paint) {
    const specialDayDateId = dateIds.get(entry.date)!;
    await tx
      .delete(departmentDays)
      .where(
        and(
          eq(departmentDays.departmentId, entry.ownerId),
          eq(departmentDays.specialDayDateId, specialDayDateId),
        ),
      );
    if (entry.ranges.length === 0) continue;
    const dayId = newId();
    await tx
      .insert(departmentDays)
      .values({ id: dayId, departmentId: entry.ownerId, specialDayDateId });
    await tx.insert(departmentDayRanges).values(
      joinTouching(entry.ranges, (a, b) => a.periodId === b.periodId).map((range) => ({
        dayId,
        departmentId: entry.ownerId,
        periodId: range.periodId,
        startsAt: storedTime(range.startsAt),
        endsAt: storedTime(range.endsAt),
      })),
    );
  }
  for (const entry of parsed.zonePaint) {
    const specialDayDateId = dateIds.get(entry.date)!;
    await tx
      .delete(zoneDays)
      .where(
        and(eq(zoneDays.zoneId, entry.ownerId), eq(zoneDays.specialDayDateId, specialDayDateId)),
      );
    if (entry.ranges.length === 0) continue;
    const dayId = newId();
    await tx.insert(zoneDays).values({ id: dayId, zoneId: entry.ownerId, specialDayDateId });
    await tx.insert(zoneDayRanges).values(
      joinTouching(entry.ranges, (a, b) => a.kind === b.kind).map((range) => ({
        dayId,
        kind: range.kind,
        startsAt: storedTime(range.startsAt),
        endsAt: storedTime(range.endsAt),
      })),
    );
  }
  await afterWrite?.({ clock, departmentOf: zoneDepartments });
  await assertWaitingChangeFits(tx, cfg, at, clock);
  return readSpecialDay(tx, cfg, specialDayId);
}

/** Deletes a special day; its dates, and their paint, go with it and follow their seasons again. */
export async function deleteSpecialDay(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
  at: Date,
  expectedClockRevision: number,
): Promise<void> {
  await assertBusinessDayScheduleWrite(tx, cfg, "time", expectedClockRevision);
  await requireSpecialDay(tx, cfg, id);
  await tx.delete(specialDays).where(eq(specialDays.id, id));
  const clock = await readLocationClock(tx, cfg.locationId);
  await assertWaitingChangeFits(tx, cfg, at, clock);
}
