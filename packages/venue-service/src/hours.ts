import { and, asc, eq, gte, inArray, isNotNull, ne, or, type SQL } from "drizzle-orm";
import { kitchenStations, newId, type Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { venueLocalMoment } from "./hours-clock.js";
import {
  addDays,
  cellIntervals,
  invalidHours,
  parseSpecialDateInput,
  parseSubject,
  parseWeek,
  tailOverlaps,
  weekdayOf,
  type Interval,
} from "./hours-rules.js";
import type {
  DateCell,
  DateHoursCell,
  HourPeriod,
  HoursSubject,
  LocalDate,
  SpecialDate,
  SpecialDateInput,
  WeekCell,
  WeekDay,
} from "./hours-types.js";
import { storedTime, type VenueScope } from "./operations.js";
import {
  hoursWeekCells,
  hoursWeekPeriods,
  specialDateHours,
  specialDateHoursPeriods,
  specialDates,
} from "./schema/hours.js";
import { departments } from "./schema/service.js";
import "./errors.js";

export { cellIntervals } from "./hours-rules.js";

type StoredMode = "closed" | "all_day" | "periods";
type CellTable = typeof hoursWeekCells | typeof specialDateHours;
type PeriodTable = typeof hoursWeekPeriods | typeof specialDateHoursPeriods;

const keyOf = (subject: HoursSubject) => `${subject.kind}:${subject.id}`;

function ownerOf(cells: CellTable, subject: HoursSubject): SQL {
  return subject.kind === "department"
    ? eq(cells.departmentId, subject.id)
    : eq(cells.stationId, subject.id);
}

function subjectOfRow(row: { departmentId: string | null; stationId: string | null }) {
  return row.departmentId !== null
    ? { kind: "department" as const, id: row.departmentId }
    : { kind: "station" as const, id: row.stationId! };
}

/**
 * Resolves a subject within the venue: `hours.invalid` naming `field` when it is not this venue's,
 * `station.always_open` for the default station when `writing`.
 */
async function requireSubject(
  tx: Transaction,
  cfg: VenueScope,
  subject: HoursSubject,
  field: string,
  writing: boolean,
): Promise<void> {
  if (subject.kind === "department") {
    const [row] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, subject.id), eq(departments.locationId, cfg.locationId)));
    if (row === undefined) invalidHours(field);
    return;
  }
  const [row] = await tx
    .select({ isDefault: kitchenStations.isDefault })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.id, subject.id), eq(kitchenStations.locationId, cfg.locationId)));
  if (row === undefined) invalidHours(field);
  if (writing && row.isDefault)
    throw new AppError("station.always_open", { stationId: subject.id });
}

/** Periods by cell id, in their saved order, wire times. */
async function periodsByCell(
  tx: Transaction,
  periods: PeriodTable,
  cellIds: string[],
): Promise<Map<string, HourPeriod[]>> {
  const byCell = new Map<string, HourPeriod[]>();
  if (cellIds.length === 0) return byCell;
  const rows = await tx
    .select()
    .from(periods)
    .where(inArray(periods.cellId, cellIds))
    .orderBy(asc(periods.cellId), asc(periods.position));
  for (const row of rows)
    byCell.set(row.cellId, [
      ...(byCell.get(row.cellId) ?? []),
      { id: row.id, opensAt: row.opensAt.slice(0, 5), closesAt: row.closesAt.slice(0, 5) },
    ]);
  return byCell;
}

function cellOf(mode: StoredMode, periods: HourPeriod[]): WeekCell & DateCell {
  return mode === "periods" ? { mode, periods } : { mode, periods: [] };
}

/**
 * Writes one cell's mode and replaces its periods by deleting then inserting the whole set, so a
 * reordering cannot trip the position index midway (CLAUDE.md §3). Returns the cell id.
 */
async function writeCell(
  tx: Transaction,
  tables: { cells: CellTable; periods: PeriodTable },
  existingId: string | undefined,
  values: Record<string, unknown>,
  cell: { mode: StoredMode; periods: HourPeriod[] },
): Promise<void> {
  const id = existingId ?? newId();
  if (existingId === undefined)
    await tx.insert(tables.cells).values({ id, ...values, mode: cell.mode } as never);
  else {
    await tx.update(tables.cells).set({ mode: cell.mode }).where(eq(tables.cells.id, id));
    await tx.delete(tables.periods).where(eq(tables.periods.cellId, id));
  }
  if (cell.periods.length > 0)
    await tx.insert(tables.periods).values(
      cell.periods.map((period, position) => ({
        id: period.id,
        cellId: id,
        position,
        opensAt: storedTime(period.opensAt),
        closesAt: storedTime(period.closesAt),
      })),
    );
}

/**
 * Refuses a period id that belongs to a cell other than the one it is being saved into. `owner`
 * gives the cell id each request field's periods are allowed to come from, if it exists yet.
 */
async function assertPeriodOwnership(
  tx: Transaction,
  cells: { field: string; periods: HourPeriod[]; ownCellId: string | undefined; week: boolean }[],
): Promise<void> {
  const ids = cells.flatMap((cell) => cell.periods.map((period) => period.id));
  if (ids.length === 0) return;
  const owners = new Map<string, { cellId: string; week: boolean }>();
  for (const row of await tx
    .select({ id: hoursWeekPeriods.id, cellId: hoursWeekPeriods.cellId })
    .from(hoursWeekPeriods)
    .where(inArray(hoursWeekPeriods.id, ids)))
    owners.set(row.id, { cellId: row.cellId, week: true });
  for (const row of await tx
    .select({ id: specialDateHoursPeriods.id, cellId: specialDateHoursPeriods.cellId })
    .from(specialDateHoursPeriods)
    .where(inArray(specialDateHoursPeriods.id, ids)))
    owners.set(row.id, { cellId: row.cellId, week: false });
  for (const cell of cells)
    cell.periods.forEach((period, index) => {
      const owner = owners.get(period.id);
      if (owner !== undefined && (owner.week !== cell.week || owner.cellId !== cell.ownCellId))
        invalidHours(`${cell.field}.periods.${index}.id`);
    });
}

async function today(tx: Transaction, cfg: VenueScope, at: Date): Promise<LocalDate | null> {
  return venueLocalMoment(at, await readLocationClock(tx, cfg.locationId))?.civilDate ?? null;
}

/**
 * Whether a clash between `earlier` and the day after it still matters at `today`: a pair ending
 * before today is history and does not block a current or future schedule. An unreadable clock
 * checks every pair.
 */
const pairMatters = (earlier: LocalDate, today: LocalDate | null) =>
  today === null || addDays(earlier, 1) >= today;

export async function readWeekHours(
  tx: Transaction,
  cfg: VenueScope,
  subject: HoursSubject,
): Promise<WeekDay[]> {
  await requireSubject(tx, cfg, subject, "subject", false);
  const cells = await tx.select().from(hoursWeekCells).where(ownerOf(hoursWeekCells, subject));
  const periods = await periodsByCell(
    tx,
    hoursWeekPeriods,
    cells.map((cell) => cell.id),
  );
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const cell = cells.find((row) => row.weekday === weekday);
    return {
      weekday,
      cell:
        cell === undefined
          ? { mode: "not_set", periods: [] }
          : cellOf(cell.mode, periods.get(cell.id) ?? []),
    };
  });
}

/**
 * Replaces a subject's whole standard week. Seven unset days clear it; otherwise all seven are
 * stored. Refused when the new week's hours clash with a current or future special date's.
 */
export async function replaceWeekHours(
  tx: Transaction,
  cfg: VenueScope,
  subject: HoursSubject,
  days: readonly WeekDay[],
  at: Date,
): Promise<void> {
  const parsedSubject = parseSubject(subject, "subject");
  const week = parseWeek(days);
  await requireSubject(tx, cfg, parsedSubject, "subject", true);
  const existing = await tx
    .select({ id: hoursWeekCells.id, weekday: hoursWeekCells.weekday })
    .from(hoursWeekCells)
    .where(ownerOf(hoursWeekCells, parsedSubject));
  const cellIdOf = (weekday: number) => existing.find((row) => row.weekday === weekday)?.id;
  await assertPeriodOwnership(
    tx,
    week.cells.map((cell, weekday) => ({
      field: `days.${week.indexOf[weekday]}.cell`,
      periods: cell.periods,
      ownCellId: cellIdOf(weekday),
      week: true,
    })),
  );
  await assertWeekBesideSpecialDates(tx, cfg, parsedSubject, week, at);

  if (week.cells[0]!.mode === "not_set") {
    await tx.delete(hoursWeekCells).where(ownerOf(hoursWeekCells, parsedSubject));
    return;
  }
  const owner =
    parsedSubject.kind === "department"
      ? { departmentId: parsedSubject.id }
      : { stationId: parsedSubject.id };
  for (const [weekday, cell] of week.cells.entries())
    await writeCell(
      tx,
      { cells: hoursWeekCells, periods: hoursWeekPeriods },
      cellIdOf(weekday),
      { ...owner, weekday },
      cell as { mode: StoredMode; periods: HourPeriod[] },
    );
}

/** One special date as the clash check sees it: its closure flag and its stored cells. */
interface DateState {
  closeWholeVenue: boolean;
  cells: Map<string, Interval[] | null>;
}

/** The special dates on or after `from` (every one when `from` is null), with their cells. */
async function readDateStates(
  tx: Transaction,
  cfg: VenueScope,
  where: SQL | undefined,
  subject: HoursSubject | null,
  exceptId: string | null,
): Promise<Map<LocalDate, DateState>> {
  const dates = await tx
    .select({
      id: specialDates.id,
      date: specialDates.date,
      closeWholeVenue: specialDates.closeWholeVenue,
    })
    .from(specialDates)
    .where(
      and(
        eq(specialDates.locationId, cfg.locationId),
        where,
        exceptId === null ? undefined : ne(specialDates.id, exceptId),
      ),
    );
  const states = new Map<LocalDate, DateState>();
  if (dates.length === 0) return states;
  const cells = await tx
    .select()
    .from(specialDateHours)
    .where(
      and(
        inArray(
          specialDateHours.specialDateId,
          dates.map((date) => date.id),
        ),
        subject === null ? undefined : ownerOf(specialDateHours, subject),
      ),
    );
  const periods = await periodsByCell(
    tx,
    specialDateHoursPeriods,
    cells.map((cell) => cell.id),
  );
  for (const date of dates)
    states.set(date.date, {
      closeWholeVenue: date.closeWholeVenue,
      cells: new Map(
        cells
          .filter((cell) => cell.specialDateId === date.id)
          .map((cell) => [
            keyOf(subjectOfRow(cell)),
            cellIntervals(cellOf(cell.mode, periods.get(cell.id) ?? [])),
          ]),
      ),
    });
  return states;
}

/** A subject's hours on one date: the special date's cell or closure, else its standard week. */
function effective(
  date: LocalDate,
  key: string,
  dates: Map<LocalDate, DateState>,
  week: (weekday: number) => Interval[] | null,
): { intervals: Interval[] | null; fromWeek: boolean } {
  const special = dates.get(date);
  if (special?.closeWholeVenue) return { intervals: [], fromWeek: false };
  if (special?.cells.has(key)) return { intervals: special.cells.get(key)!, fromWeek: false };
  return { intervals: week(weekdayOf(date)), fromWeek: true };
}

async function assertWeekBesideSpecialDates(
  tx: Transaction,
  cfg: VenueScope,
  subject: HoursSubject,
  week: ReturnType<typeof parseWeek>,
  at: Date,
): Promise<void> {
  const now = await today(tx, cfg, at);
  const dates = await readDateStates(
    tx,
    cfg,
    now === null ? undefined : gte(specialDates.date, addDays(now, -1)),
    subject,
    null,
  );
  const key = keyOf(subject);
  const weekIntervals = (weekday: number) => cellIntervals(week.cells[weekday]!);
  for (const special of [...dates.keys()].sort())
    for (const earlier of [addDays(special, -1), special]) {
      if (!pairMatters(earlier, now)) continue;
      const later = addDays(earlier, 1);
      const before = effective(earlier, key, dates, weekIntervals);
      const after = effective(later, key, dates, weekIntervals);
      if (!before.fromWeek && !after.fromWeek) continue;
      if (!tailOverlaps(before.intervals, after.intervals)) continue;
      const blamed = after.fromWeek ? later : earlier;
      invalidHours(`days.${week.indexOf[weekdayOf(blamed)]}.cell`, {
        date: special,
        subjectId: subject.id,
      });
    }
}

async function requireSpecialDate(tx: Transaction, cfg: VenueScope, id: string) {
  const [row] = await tx
    .select()
    .from(specialDates)
    .where(and(eq(specialDates.id, id), eq(specialDates.locationId, cfg.locationId)));
  if (row === undefined) throw new AppError("special_date.not_found", { specialDateId: id });
  return row;
}

export async function readSpecialDate(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
): Promise<SpecialDate & { cells: DateHoursCell[] }> {
  const row = await requireSpecialDate(tx, cfg, id);
  const cells = await tx
    .select()
    .from(specialDateHours)
    .where(eq(specialDateHours.specialDateId, id));
  const periods = await periodsByCell(
    tx,
    specialDateHoursPeriods,
    cells.map((cell) => cell.id),
  );
  return {
    id: row.id,
    date: row.date,
    name: row.name,
    colour: row.colour,
    closeWholeVenue: row.closeWholeVenue,
    cells: cells
      .map((cell) => ({
        subject: subjectOfRow(cell),
        cell: cellOf(cell.mode, periods.get(cell.id) ?? []),
      }))
      .sort((a, b) => (a.subject.id < b.subject.id ? -1 : 1)),
  };
}

/** The venue's departments and non-default stations, which are the subjects hours apply to. */
async function scheduledSubjects(tx: Transaction, cfg: VenueScope): Promise<HoursSubject[]> {
  const departmentRows = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.locationId, cfg.locationId));
  const stationRows = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(eq(kitchenStations.locationId, cfg.locationId), eq(kitchenStations.isDefault, false)),
    );
  return [
    ...departmentRows.map((row) => ({ kind: "department" as const, id: row.id })),
    ...stationRows.map((row) => ({ kind: "station" as const, id: row.id })),
  ];
}

/** Every subject's standard week in the venue, as intervals by subject key and weekday. */
async function weekIntervalsBySubject(
  tx: Transaction,
  subjects: HoursSubject[],
): Promise<Map<string, (Interval[] | null)[]>> {
  const departmentIds = subjects.filter((s) => s.kind === "department").map((s) => s.id);
  const stationIds = subjects.filter((s) => s.kind === "station").map((s) => s.id);
  const cells = await tx
    .select()
    .from(hoursWeekCells)
    .where(
      or(
        and(
          isNotNull(hoursWeekCells.departmentId),
          inArray(hoursWeekCells.departmentId, departmentIds),
        ),
        and(isNotNull(hoursWeekCells.stationId), inArray(hoursWeekCells.stationId, stationIds)),
      ),
    );
  const periods = await periodsByCell(
    tx,
    hoursWeekPeriods,
    cells.map((cell) => cell.id),
  );
  const weeks = new Map<string, (Interval[] | null)[]>();
  for (const cell of cells) {
    const key = keyOf(subjectOfRow(cell));
    const week = weeks.get(key) ?? Array<Interval[] | null>(7).fill(null);
    week[cell.weekday] = cellIntervals(cellOf(cell.mode, periods.get(cell.id) ?? []));
    weeks.set(key, week);
  }
  return weeks;
}

/**
 * Refuses a special date whose hours clash with the dates either side of it, and, for a moved
 * date, with the hours either side of the date it leaves.
 */
async function assertSpecialDateBesideNeighbours(
  tx: Transaction,
  cfg: VenueScope,
  input: SpecialDateInput,
  previous: LocalDate | null,
  exceptId: string | null,
  at: Date,
): Promise<void> {
  const now = await today(tx, cfg, at);
  const touched =
    previous === null || previous === input.date ? [input.date] : [input.date, previous];
  const neighbours = touched.flatMap((date) => [addDays(date, -1), addDays(date, 1)]);
  const dates = await readDateStates(
    tx,
    cfg,
    inArray(specialDates.date, neighbours),
    null,
    exceptId,
  );
  dates.delete(input.date);
  if (previous !== null) dates.delete(previous);
  const cellIndex = new Map(input.cells.map((entry, index) => [keyOf(entry.subject), index]));
  dates.set(input.date, {
    closeWholeVenue: input.closeWholeVenue,
    cells: new Map(
      input.cells
        .filter((entry) => entry.cell.mode !== "inherit")
        .map((entry) => [keyOf(entry.subject), cellIntervals(entry.cell)]),
    ),
  });
  const subjects = await scheduledSubjects(tx, cfg);
  const weeks = await weekIntervalsBySubject(tx, subjects);
  for (const subject of subjects) {
    const key = keyOf(subject);
    const week = (weekday: number) => weeks.get(key)?.[weekday] ?? null;
    for (const date of touched)
      for (const earlier of [addDays(date, -1), date]) {
        if (!pairMatters(earlier, now)) continue;
        const later = addDays(earlier, 1);
        if (
          !tailOverlaps(
            effective(earlier, key, dates, week).intervals,
            effective(later, key, dates, week).intervals,
          )
        )
          continue;
        if (date !== input.date) invalidHours("date", { date, subjectId: subject.id });
        const index = cellIndex.get(key);
        const ownCell = index !== undefined && input.cells[index]!.cell.mode !== "inherit";
        invalidHours(ownCell ? `cells.${index}.cell` : "cells", {
          date: earlier === date ? later : earlier,
          subjectId: subject.id,
        });
      }
  }
}

/**
 * Creates a special date (`id` null) or edits one in place, keeping its id. Its cells replace the
 * stored ones; an `inherit` cell stores nothing.
 */
export async function saveSpecialDate(
  tx: Transaction,
  cfg: VenueScope,
  id: string | null,
  input: SpecialDateInput,
  at: Date,
): Promise<SpecialDate> {
  const parsed = parseSpecialDateInput(input);
  const current = id === null ? null : await requireSpecialDate(tx, cfg, id);
  for (const [index, entry] of parsed.cells.entries())
    await requireSubject(
      tx,
      cfg,
      entry.subject,
      `cells.${index}.subject`,
      entry.cell.mode !== "inherit",
    );
  const [taken] = await tx
    .select({ id: specialDates.id })
    .from(specialDates)
    .where(
      and(
        eq(specialDates.locationId, cfg.locationId),
        eq(specialDates.date, parsed.date),
        id === null ? undefined : ne(specialDates.id, id),
      ),
    );
  if (taken !== undefined) throw new AppError("special_date.date_taken", { date: parsed.date });

  const existingCells =
    id === null
      ? []
      : await tx.select().from(specialDateHours).where(eq(specialDateHours.specialDateId, id));
  const cellIdOf = (subject: HoursSubject) =>
    existingCells.find((cell) => keyOf(subjectOfRow(cell)) === keyOf(subject))?.id;
  await assertPeriodOwnership(
    tx,
    parsed.cells.map((entry, index) => ({
      field: `cells.${index}.cell`,
      periods: entry.cell.periods,
      ownCellId: cellIdOf(entry.subject),
      week: false,
    })),
  );
  await assertSpecialDateBesideNeighbours(tx, cfg, parsed, current?.date ?? null, id, at);

  const values = {
    date: parsed.date,
    name: parsed.name,
    colour: parsed.colour,
    closeWholeVenue: parsed.closeWholeVenue,
  };
  let specialDateId: string;
  if (id === null) {
    const [row] = await tx
      .insert(specialDates)
      .values({ ...values, locationId: cfg.locationId })
      .returning({ id: specialDates.id });
    specialDateId = row!.id;
  } else {
    await tx.update(specialDates).set(values).where(eq(specialDates.id, id));
    specialDateId = id;
  }
  const kept = new Set<string>();
  for (const entry of parsed.cells) {
    if (entry.cell.mode === "inherit") continue;
    const own = cellIdOf(entry.subject);
    if (own !== undefined) kept.add(own);
    await writeCell(
      tx,
      { cells: specialDateHours, periods: specialDateHoursPeriods },
      own,
      {
        specialDateId,
        ...(entry.subject.kind === "department"
          ? { departmentId: entry.subject.id }
          : { stationId: entry.subject.id }),
      },
      entry.cell as { mode: StoredMode; periods: HourPeriod[] },
    );
  }
  const dropped = existingCells.filter((cell) => !kept.has(cell.id)).map((cell) => cell.id);
  if (dropped.length > 0)
    await tx.delete(specialDateHours).where(inArray(specialDateHours.id, dropped));
  return { id: specialDateId, ...values };
}
