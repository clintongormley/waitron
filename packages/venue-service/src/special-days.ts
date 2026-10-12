import { and, asc, eq, inArray, lte, ne, or, sql } from "drizzle-orm";
import { newId, type Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError, isUuid, type BusinessDayClock, type ErrorParams } from "@waitron/shared";
import { assertBusinessDayScheduleWrite } from "./business-day-schedule.js";
import type { PaintRange, ZonePaint } from "./day-paint.js";
import { isReadableClock, venueLocalMoment } from "./hours-clock.js";
import { isLocalDate } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";
import { nextOccurrence, occurrenceIn, repeatKey } from "./named-day-rules.js";
import {
  assertDepartment,
  resolveZoneContext,
  storedTime,
  wireTime,
  type VenueScope,
} from "./operations.js";
import {
  departmentDayRanges,
  departmentDays,
  specialDayDates,
  specialDays,
  ZONE_PAINT_KINDS,
  zoneDayRanges,
  zoneDays,
} from "./schema/seasons.js";
import { specialDates } from "./schema/hours.js";
import { menuPeriods } from "./schema/menus.js";
import { scheduleEndOffsetClash } from "./menu-timetable.js";
import { joinTouching } from "./season-weeks.js";
import { scheduleCutovers } from "./service-day-context.js";
import { clockTimeSkippedInDay, parseRanges, type ClosedRange } from "./service-day.js";
import "./errors.js";

export interface SpecialDayDateRule {
  date: LocalDate;
  repeats: boolean;
}

/** Where a special-day date falls in `year`: a one-off only in its own year, a repeating one from
 *  its first year on, and a 29 February only in leap years. Null when it does not fall in `year`. */
export function specialDateIn(rule: SpecialDayDateRule, year: number): LocalDate | null {
  return occurrenceIn(rule, year);
}

/** The first day two special-day dates would both stand on, or null when they never meet. */
export function sharedSpecialDate(a: SpecialDayDateRule, b: SpecialDayDateRule): LocalDate | null {
  if (specialDateIn(a, Number(b.date.slice(0, 4))) === b.date) return b.date;
  if (specialDateIn(b, Number(a.date.slice(0, 4))) === a.date) return a.date;
  return null;
}

export interface SpecialDayOccurrence {
  specialDayId: string;
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
): Promise<Map<LocalDate, SpecialDayOccurrence | null>> {
  const found = new Map<LocalDate, SpecialDayOccurrence | null>(days.map((day) => [day, null]));
  if (days.length === 0) return found;
  const ordered = [...new Set(days)].sort();
  const dates = await tx
    .select({
      specialDayId: specialDayDates.specialDayId,
      dateId: specialDayDates.id,
      date: specialDayDates.date,
      closedAllDay: specialDayDates.closedAllDay,
      repeats: specialDays.repeatsYearly,
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
            inArray(sql`substr(${specialDayDates.date}, 6)`, [...new Set(ordered.map(repeatKey))]),
            lte(specialDayDates.date, ordered[ordered.length - 1]!),
          ),
        ),
      ),
    )
    .orderBy(asc(specialDayDates.date), asc(specialDayDates.id));
  const matched = new Map<LocalDate, (typeof dates)[number]>();
  for (const day of ordered) {
    const row = dates.find(
      (row) =>
        specialDateIn({ date: row.date, repeats: row.repeats }, Number(day.slice(0, 4))) === day,
    );
    if (row !== undefined) matched.set(day, row);
  }
  if (matched.size === 0) return found;
  const dateIds = [...new Set([...matched.values()].map((row) => row.dateId))];
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
    .where(inArray(departmentDays.specialDayDateId, dateIds))
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
        .where(inArray(zoneDays.specialDayDateId, dateIds)),
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
  for (const [day, row] of matched)
    found.set(day, {
      specialDayId: row.specialDayId,
      dateId: row.dateId,
      storedDate: row.date,
      closedAllDay: row.closedAllDay,
      paint: departmentPaint.get(row.dateId) ?? new Map(),
      zonePaint: zonePaint.get(row.dateId) ?? new Map(),
    });
  return found;
}

export interface SpecialDaySchedule {
  specialDayId: string;
  name: string;
  date: LocalDate;
  repeats: boolean;
  closedAllDay: boolean;
  /** By department. */
  paint: ReadonlyMap<string, PaintRange[]>;
}

/** Every special-day date of the venue with its department paint (of `departmentIds` only, when
 *  given): one read of the dates and one of the paint. */
export async function readSpecialDaySchedules(
  tx: Transaction,
  cfg: VenueScope,
  departmentIds?: readonly string[],
): Promise<SpecialDaySchedule[]> {
  const dates = await tx
    .select({
      dateId: specialDayDates.id,
      specialDayId: specialDays.id,
      name: specialDays.name,
      date: specialDayDates.date,
      repeats: specialDays.repeatsYearly,
      closedAllDay: specialDayDates.closedAllDay,
    })
    .from(specialDayDates)
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))
    .where(eq(specialDayDates.locationId, cfg.locationId))
    .orderBy(asc(specialDayDates.date), asc(specialDayDates.id));
  if (dates.length === 0) return [];
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
    .where(
      and(
        inArray(
          departmentDays.specialDayDateId,
          dates.map((row) => row.dateId),
        ),
        departmentIds === undefined
          ? undefined
          : inArray(departmentDays.departmentId, departmentIds),
      ),
    );
  const byDate = new Map<string, Map<string, PaintRange[]>>();
  for (const row of paint) {
    const owners = byDate.get(row.dateId!) ?? new Map<string, PaintRange[]>();
    byDate.set(row.dateId!, owners);
    owners.set(row.departmentId, [
      ...(owners.get(row.departmentId) ?? []),
      { periodId: row.periodId, startsAt: wireTime(row.startsAt), endsAt: wireTime(row.endsAt) },
    ]);
  }
  return dates.map(({ dateId, ...row }) => ({ ...row, paint: byDate.get(dateId) ?? new Map() }));
}

export interface SpecialDayInput {
  name: string;
  repeatsYearly: boolean;
  dates: readonly { date: LocalDate; closedAllDay: boolean }[];
  paint?: readonly { departmentId: string; date: LocalDate; ranges: readonly PaintRange[] }[];
  zonePaint?: readonly { zoneId: string; date: LocalDate; ranges: readonly ZonePaint[] }[];
}

export interface SpecialDayDetail extends Omit<SpecialDayInput, "paint" | "zonePaint"> {
  id: string;
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
  (clock: BusinessDayClock, repeats: boolean): CutoversOf =>
  (date) =>
    scheduleCutovers(clock, repeats ? undefined : date);

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
      (item, at, range): Placed<T> => ({
        ...read(item, at, range),
        position: Number(at.slice(at.lastIndexOf(".") + 1)),
      }),
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

function parseInput(value: unknown, clock: BusinessDayClock) {
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
  dates.forEach((entry, index) => {
    for (const earlier of dates.slice(0, index))
      if (
        sharedSpecialDate(
          { date: earlier.date, repeats: repeatsYearly },
          { date: entry.date, repeats: repeatsYearly },
        ) !== null
      )
        invalid(`dates.${index}.date`, { reason: "overlap" });
  });
  const held = new Set(dates.map((entry) => entry.date));
  const cutoversOf = cutoversFor(clock, repeatsYearly);
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
  repeats: boolean,
  entries: readonly ParsedEntry<ClosedRange>[],
): void {
  if (!isReadableClock(clock)) return;
  for (const entry of entries) {
    const date = repeats
      ? (nextOccurrence({ date: entry.date, repeats }, today ?? entry.date) ?? entry.date)
      : entry.date;
    for (const range of entry.ranges)
      for (const end of ["startsAt", "endsAt"] as const)
        if (clockTimeSkippedInDay(clock, date, range[end], end === "endsAt"))
          entry.refuse(`ranges.${range.position}.${end}`, { reason: "clock_skips", date });
  }
}

/** Refuses a date that another special day, or a named day, of the venue also stands on. */
async function assertDatesFree(
  tx: Transaction,
  cfg: VenueScope,
  ownId: string | null,
  repeats: boolean,
  dates: readonly LocalDate[],
): Promise<void> {
  if (dates.length === 0) return;
  const others = await tx
    .select({
      specialDayId: specialDays.id,
      name: specialDays.name,
      repeats: specialDays.repeatsYearly,
      date: specialDayDates.date,
    })
    .from(specialDayDates)
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))
    .where(
      and(
        eq(specialDayDates.locationId, cfg.locationId),
        ownId === null ? undefined : ne(specialDays.id, ownId),
        inArray(sql`substr(${specialDayDates.date}, 6)`, [...new Set(dates.map(repeatKey))]),
      ),
    )
    .orderBy(asc(specialDayDates.date));
  for (const date of dates)
    for (const other of others) {
      const shared = sharedSpecialDate({ date, repeats }, other);
      if (shared !== null)
        throw new AppError("special_day.date_taken", {
          date: shared,
          specialDayId: other.specialDayId,
          name: other.name,
        });
    }
  const named = await tx
    .select({
      specialDateId: specialDates.id,
      name: specialDates.name,
      date: specialDates.date,
      repeatOn: specialDates.repeatOn,
    })
    .from(specialDates)
    .where(
      and(
        eq(specialDates.locationId, cfg.locationId),
        inArray(sql`substr(${specialDates.date}, 6)`, [...new Set(dates.map(repeatKey))]),
      ),
    )
    .orderBy(asc(specialDates.date));
  for (const date of dates)
    for (const other of named) {
      const shared = sharedSpecialDate(
        { date, repeats },
        { date: other.date, repeats: other.repeatOn !== null },
      );
      if (shared !== null)
        throw new AppError("special_day.date_taken", {
          date: shared,
          specialDateId: other.specialDateId,
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

/** Every department, since a Closed-all-day tick touches them all. */
async function checkScheduleAfterWrite(tx: Transaction, cfg: VenueScope): Promise<void> {
  const clash = await scheduleEndOffsetClash(tx, cfg);
  if (clash !== null)
    invalid("paint", {
      reason: "end_offset",
      date: clash.date,
      periodId: clash.periodId,
      departmentId: clash.departmentId,
    });
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
    })
    .from(specialDayDates)
    .where(eq(specialDayDates.specialDayId, id))
    .orderBy(asc(specialDayDates.date));
  const dateOf = new Map(dates.map((row) => [row.id, row.date]));
  const detail: SpecialDayDetail = {
    id: day.id,
    name: day.name,
    repeatsYearly: day.repeatsYearly,
    dates: dates.map((row) => ({ date: row.date, closedAllDay: row.closedAllDay })),
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
 *  given empty ranges it is cleared. */
export async function saveSpecialDay(
  tx: Transaction,
  cfg: VenueScope,
  id: string | null,
  input: unknown,
  at: Date,
  expectedClockRevision: number,
): Promise<SpecialDayDetail> {
  await assertBusinessDayScheduleWrite(tx, cfg, "time", at, expectedClockRevision);
  const stored = id === null ? null : await readSpecialDay(tx, cfg, id);
  const clock = await readLocationClock(tx, cfg.locationId);
  const parsed = parseInput(input, clock);
  for (const departmentId of new Set(parsed.paint.map((entry) => entry.ownerId)))
    await assertDepartment(tx, cfg, departmentId);
  for (const zoneId of new Set(parsed.zonePaint.map((entry) => entry.ownerId)))
    await resolveZoneContext(tx, cfg, zoneId);
  await assertOwnPeriods(tx, parsed.paint);
  const retainedPaint = retainedEntries(
    (stored?.paint ?? []).map(({ departmentId, ...entry }) => ({
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
    (stored?.zonePaint ?? []).map(({ zoneId, ...entry }) => ({ ownerId: zoneId, ...entry })),
    "zonePaint",
    "zoneId",
    parsed.zonePaint,
    parsed.held,
    parsed.cutoversOf,
    readZoneRange,
  );
  const today = venueLocalMoment(at, clock)?.civilDate ?? null;
  assertNoSkippedTimes(clock, today, parsed.repeatsYearly, [
    ...parsed.paint,
    ...parsed.zonePaint,
    ...retainedPaint,
    ...retainedZonePaint,
  ]);
  await assertDatesFree(
    tx,
    cfg,
    id,
    parsed.repeatsYearly,
    parsed.dates.map((entry) => entry.date),
  );

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
    .map((entry) => ({ ...entry, id: newId(), specialDayId, locationId: cfg.locationId }));
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
  await checkScheduleAfterWrite(tx, cfg);
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
  await assertBusinessDayScheduleWrite(tx, cfg, "time", at, expectedClockRevision);
  await requireSpecialDay(tx, cfg, id);
  await tx.delete(specialDays).where(eq(specialDays.id, id));
  await checkScheduleAfterWrite(tx, cfg);
}
