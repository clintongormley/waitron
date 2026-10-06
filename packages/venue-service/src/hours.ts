import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, or, type SQL } from "drizzle-orm";
import { kitchenStations, newId, type Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { isReadableClock, localTimeOccurrences, venueLocalMoment } from "./hours-clock.js";
import {
  addDays,
  calendarTone,
  cellIntervals,
  effective,
  invalidHours,
  isLocalDate,
  parseDuplicateDates,
  parseSpecialDateInput,
  parseSubject,
  pairMatters,
  parseWeek,
  tailOverlaps,
  weekdayOf,
  type DateState,
  type Interval,
} from "./hours-rules.js";
import {
  HOURS_RANGE_MAX_DAYS,
  type CalendarDay,
  type DateCell,
  type DateHoursCell,
  type HolidayFact,
  type HourPeriod,
  type HoursModel,
  type HoursModelSubject,
  type HoursSubject,
  type LocalDate,
  type ResolvedHours,
  type SpecialDate,
  type SpecialDateInput,
  type WeekCell,
  type WeekDay,
} from "./hours-types.js";
import { storedTime, type VenueScope } from "./operations.js";
import type { DayPeriod, WeeklyInterval } from "./routing.js";
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

const bySubjectId = (a: DateHoursCell, b: DateHoursCell) =>
  Number(a.subject.id > b.subject.id) - Number(a.subject.id < b.subject.id);

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
 * Resolves each subject within the venue, one read per kind: `hours.invalid` naming its `field`
 * when it is not this venue's, `station.always_open` for the default station when `writing`.
 * Returns the ids of the listed stations that are the default.
 */
async function requireSubjects(
  tx: Transaction,
  cfg: VenueScope,
  entries: readonly { subject: HoursSubject; field: string; writing: boolean }[],
): Promise<Set<string>> {
  const idsOf = (kind: HoursSubject["kind"]) =>
    entries.filter((entry) => entry.subject.kind === kind).map((entry) => entry.subject.id);
  const departmentIds = idsOf("department");
  const stationIds = idsOf("station");
  const found = new Set<string>();
  if (departmentIds.length > 0)
    for (const row of await tx
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(inArray(departments.id, departmentIds), eq(departments.locationId, cfg.locationId)),
      ))
      found.add(keyOf({ kind: "department", id: row.id }));
  const defaults = new Set<string>();
  if (stationIds.length > 0)
    for (const row of await tx
      .select({ id: kitchenStations.id, isDefault: kitchenStations.isDefault })
      .from(kitchenStations)
      .where(
        and(
          inArray(kitchenStations.id, stationIds),
          eq(kitchenStations.locationId, cfg.locationId),
        ),
      )) {
      found.add(keyOf({ kind: "station", id: row.id }));
      if (row.isDefault) defaults.add(row.id);
    }
  for (const { subject, field, writing } of entries) {
    if (!found.has(keyOf(subject))) invalidHours(field);
    if (writing && subject.kind === "station" && defaults.has(subject.id))
      throw new AppError("station.always_open", { stationId: subject.id });
  }
  return defaults;
}

async function defaultStationIds(tx: Transaction, cfg: VenueScope): Promise<Set<string>> {
  const rows = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(eq(kitchenStations.locationId, cfg.locationId), eq(kitchenStations.isDefault, true)),
    );
  return new Set(rows.map((row) => row.id));
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
 * reordering cannot trip the position index midway (CLAUDE.md §3).
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
 * Refuses a period id that belongs to a cell other than the one it is being saved into.
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

export async function readWeekHours(
  tx: Transaction,
  cfg: VenueScope,
  subject: HoursSubject,
): Promise<WeekDay[]> {
  await requireSubjects(tx, cfg, [{ subject, field: "subject", writing: false }]);
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
  await requireSubjects(tx, cfg, [{ subject: parsedSubject, field: "subject", writing: true }]);
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

/** The special dates, with their cells. */
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

/** A special date's stored cells, sorted by subject id. */
async function readDateCells(tx: Transaction, id: string): Promise<DateHoursCell[]> {
  const cells = await tx
    .select()
    .from(specialDateHours)
    .where(eq(specialDateHours.specialDateId, id));
  const periods = await periodsByCell(
    tx,
    specialDateHoursPeriods,
    cells.map((cell) => cell.id),
  );
  return cells
    .map((cell) => ({
      subject: subjectOfRow(cell),
      cell: cellOf(cell.mode, periods.get(cell.id) ?? []),
    }))
    .sort(bySubjectId);
}

export async function readSpecialDate(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
): Promise<SpecialDate & { cells: DateHoursCell[] }> {
  const row = await requireSpecialDate(tx, cfg, id);
  return {
    id: row.id,
    date: row.date,
    name: row.name,
    colour: row.colour,
    closeWholeVenue: row.closeWholeVenue,
    cells: await readDateCells(tx, id),
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

function dateState(closeWholeVenue: boolean, cells: readonly DateHoursCell[]): DateState {
  return {
    closeWholeVenue,
    cells: new Map(
      cells
        .filter((entry) => entry.cell.mode !== "inherit")
        .map((entry) => [keyOf(entry.subject), cellIntervals(entry.cell)]),
    ),
  };
}

/**
 * Refuses proposed special dates whose hours clash with the dates either side of each `touched`
 * date. `proposed` replaces whatever is stored on its dates; a touched date it leaves out reads as
 * an ordinary day. `clash` names the refusal from the touched date and the other date of the pair.
 */
async function assertDatesBesideNeighbours(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
  proposed: Map<LocalDate, DateState>,
  touched: readonly LocalDate[],
  exceptId: string | null,
  clash: (date: LocalDate, other: LocalDate, subject: HoursSubject) => never,
): Promise<void> {
  const now = await today(tx, cfg, at);
  const neighbours = touched.flatMap((date) => [addDays(date, -1), addDays(date, 1)]);
  const dates = await readDateStates(
    tx,
    cfg,
    inArray(specialDates.date, neighbours),
    null,
    exceptId,
  );
  for (const date of touched) dates.delete(date);
  for (const [date, state] of proposed) dates.set(date, state);
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
          tailOverlaps(
            effective(earlier, key, dates, week).intervals,
            effective(later, key, dates, week).intervals,
          )
        )
          clash(date, earlier === date ? later : earlier, subject);
      }
  }
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
  const touched =
    previous === null || previous === input.date ? [input.date] : [input.date, previous];
  const cellIndex = new Map(input.cells.map((entry, index) => [keyOf(entry.subject), index]));
  await assertDatesBesideNeighbours(
    tx,
    cfg,
    at,
    new Map([[input.date, dateState(input.closeWholeVenue, input.cells)]]),
    touched,
    exceptId,
    (date, other, subject) => {
      if (date !== input.date) invalidHours("date", { date, subjectId: subject.id });
      const index = cellIndex.get(keyOf(subject));
      const ownCell = index !== undefined && input.cells[index]!.cell.mode !== "inherit";
      invalidHours(ownCell ? `cells.${index}.cell` : "cells", {
        date: other,
        subjectId: subject.id,
      });
    },
  );
}

/** The venue's time zone, or null when its clock cannot be read. */
async function readableZone(tx: Transaction, cfg: VenueScope): Promise<string | null> {
  const clock = await readLocationClock(tx, cfg.locationId);
  return isReadableClock(clock) ? clock.timeZone : null;
}

/**
 * The first period, as its cell's index and its own field, that opens or closes at a minute the
 * clock skips on `date`; a closing after midnight is checked on the next date.
 */
function skippedEndpoint(
  date: LocalDate,
  cells: readonly DateHoursCell[],
  timeZone: string,
): { index: number; field: string } | null {
  for (const [index, { cell }] of cells.entries())
    for (const [position, period] of cell.periods.entries()) {
      const field = `cells.${index}.cell.periods.${position}`;
      const closingDate = period.closesAt > period.opensAt ? date : addDays(date, 1);
      if (localTimeOccurrences(date, period.opensAt, timeZone).length === 0)
        return { index, field: `${field}.opensAt` };
      if (localTimeOccurrences(closingDate, period.closesAt, timeZone).length === 0)
        return { index, field: `${field}.closesAt` };
    }
  return null;
}

/**
 * Refuses a period that opens or closes at a minute the venue's clock skips on that date. A clock
 * that cannot be read checks nothing.
 */
async function assertEndpointsOccur(
  tx: Transaction,
  cfg: VenueScope,
  input: SpecialDateInput,
): Promise<void> {
  const zone = await readableZone(tx, cfg);
  if (zone === null) return;
  const skipped = skippedEndpoint(input.date, input.cells, zone);
  if (skipped !== null) invalidHours(skipped.field);
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
  await requireSubjects(
    tx,
    cfg,
    parsed.cells.map((entry, index) => ({
      subject: entry.subject,
      field: `cells.${index}.subject`,
      writing: entry.cell.mode !== "inherit",
    })),
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
  await assertEndpointsOccur(tx, cfg, parsed);
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
  // A default station's cell is dormant rather than dropped: no request can carry it, and it
  // applies again if the station stops being the default.
  const dormant = existingCells.length === 0 ? new Set<string>() : await defaultStationIds(tx, cfg);
  const dropped = existingCells
    .filter(
      (cell) => !kept.has(cell.id) && !(cell.stationId !== null && dormant.has(cell.stationId)),
    )
    .map((cell) => cell.id);
  if (dropped.length > 0)
    await tx.delete(specialDateHours).where(inArray(specialDateHours.id, dropped));
  return { id: specialDateId, ...values };
}

/**
 * A module that keeps its own rows per special date, such as a menu timetable's overrides. It
 * works inside the caller's transaction and never opens its own. `copy` runs after the target date
 * and its hours are written; `beforeDelete` may only refuse, since the date's own foreign keys
 * remove what hangs from it.
 */
export interface SpecialDateParticipant {
  copy(tx: Transaction, cfg: VenueScope, sourceId: string, targetId: string): Promise<void>;
  beforeDelete(tx: Transaction, cfg: VenueScope, id: string): Promise<void>;
}

/**
 * Copies a special date's name, colour, closure and every cell to each target date under new ids,
 * then hands each copy to every participant. The whole batch is checked before anything is
 * written, so one refusal creates no target at all.
 */
export async function duplicateSpecialDate(
  tx: Transaction,
  cfg: VenueScope,
  sourceId: string,
  dates: readonly LocalDate[],
  at: Date,
  participants: readonly SpecialDateParticipant[] = [],
): Promise<SpecialDate[]> {
  const targets = parseDuplicateDates(dates);
  const source = await requireSpecialDate(tx, cfg, sourceId);
  const taken = new Set(
    (
      await tx
        .select({ date: specialDates.date })
        .from(specialDates)
        .where(
          and(eq(specialDates.locationId, cfg.locationId), inArray(specialDates.date, targets)),
        )
    ).map((row) => row.date),
  );
  const occupied = targets.find((date) => taken.has(date));
  if (occupied !== undefined) throw new AppError("special_date.date_taken", { date: occupied });

  const cells = await readDateCells(tx, sourceId);
  // A default station's dormant cell is copied as it is: it is checked only for its subject.
  const defaults = await requireSubjects(
    tx,
    cfg,
    cells.map((entry, index) => ({
      subject: entry.subject,
      field: `cells.${index}.subject`,
      writing: false,
    })),
  );
  const applied = cells.filter(
    ({ subject }) => !(subject.kind === "station" && defaults.has(subject.id)),
  );
  const zone = await readableZone(tx, cfg);
  if (zone !== null)
    for (const [index, date] of targets.entries()) {
      const skipped = skippedEndpoint(date, applied, zone);
      if (skipped !== null)
        invalidHours(`dates.${index}`, { date, subjectId: applied[skipped.index]!.subject.id });
    }
  const state = dateState(source.closeWholeVenue, cells);
  await assertDatesBesideNeighbours(
    tx,
    cfg,
    at,
    new Map(targets.map((date) => [date, state])),
    targets,
    null,
    (date, other, subject) =>
      invalidHours(`dates.${targets.indexOf(date)}`, { date: other, subjectId: subject.id }),
  );

  const values = {
    name: source.name,
    colour: source.colour,
    closeWholeVenue: source.closeWholeVenue,
  };
  const copies: SpecialDate[] = [];
  for (const date of targets) {
    const [row] = await tx
      .insert(specialDates)
      .values({ ...values, date, locationId: cfg.locationId })
      .returning({ id: specialDates.id });
    const targetId = row!.id;
    for (const { subject, cell } of cells)
      await writeCell(
        tx,
        { cells: specialDateHours, periods: specialDateHoursPeriods },
        undefined,
        {
          specialDateId: targetId,
          ...(subject.kind === "department"
            ? { departmentId: subject.id }
            : { stationId: subject.id }),
        },
        {
          mode: cell.mode as StoredMode,
          periods: cell.periods.map((period) => ({ ...period, id: newId() })),
        },
      );
    for (const participant of participants) await participant.copy(tx, cfg, sourceId, targetId);
    copies.push({ id: targetId, date, ...values });
  }
  return copies;
}

/**
 * Deletes a special date once every participant has agreed; its cells and periods go with it, so
 * its subjects read their standard week again. Refused when those standard hours would clash with
 * a neighbouring date's, as a save would be.
 */
export async function deleteSpecialDate(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
  at: Date,
  participants: readonly SpecialDateParticipant[] = [],
): Promise<void> {
  const row = await requireSpecialDate(tx, cfg, id);
  await assertDatesBesideNeighbours(tx, cfg, at, new Map(), [row.date], id, (_, other, subject) =>
    invalidHours("date", { date: other, subjectId: subject.id }),
  );
  for (const participant of participants) await participant.beforeDelete(tx, cfg, id);
  await tx.delete(specialDates).where(eq(specialDates.id, id));
}

/**
 * Each subject's hours on one opening date, in a fixed number of reads however many subjects,
 * with the date's special date if it has one. The subjects must already be this venue's, and
 * `defaults` names those of them that are the default station.
 */
async function resolveSubjects(
  tx: Transaction,
  cfg: VenueScope,
  subjects: readonly HoursSubject[],
  defaults: ReadonlySet<string>,
  date: LocalDate,
): Promise<{ special: SpecialDate | null; resolved: ResolvedHours[] }> {
  const departmentIds = subjects.filter((s) => s.kind === "department").map((s) => s.id);
  const stationIds = subjects.filter((s) => s.kind === "station").map((s) => s.id);
  const owners = (cells: CellTable) =>
    or(
      and(isNotNull(cells.departmentId), inArray(cells.departmentId, departmentIds)),
      and(isNotNull(cells.stationId), inArray(cells.stationId, stationIds)),
    );
  const [special] = await tx
    .select({
      id: specialDates.id,
      date: specialDates.date,
      name: specialDates.name,
      colour: specialDates.colour,
      closeWholeVenue: specialDates.closeWholeVenue,
    })
    .from(specialDates)
    .where(and(eq(specialDates.locationId, cfg.locationId), eq(specialDates.date, date)));
  const dateCells =
    special === undefined
      ? []
      : await tx
          .select()
          .from(specialDateHours)
          .where(and(eq(specialDateHours.specialDateId, special.id), owners(specialDateHours)));
  const weekCells = await tx
    .select()
    .from(hoursWeekCells)
    .where(and(eq(hoursWeekCells.weekday, weekdayOf(date)), owners(hoursWeekCells)));
  const datePeriods = await periodsByCell(
    tx,
    specialDateHoursPeriods,
    dateCells.map((cell) => cell.id),
  );
  const weekPeriods = await periodsByCell(
    tx,
    hoursWeekPeriods,
    weekCells.map((cell) => cell.id),
  );
  const resolved = subjects.map((subject): ResolvedHours => {
    const base = { subject, openingDate: date, specialDateId: special?.id ?? null };
    if (subject.kind === "station" && defaults.has(subject.id))
      return { ...base, source: "default_station", cell: { mode: "always_open", periods: [] } };
    if (special?.closeWholeVenue)
      return { ...base, source: "whole_venue", cell: { mode: "closed", periods: [] } };
    const key = keyOf(subject);
    const own = dateCells.find((cell) => keyOf(subjectOfRow(cell)) === key);
    if (own !== undefined)
      return {
        ...base,
        source: "special",
        cell: cellOf(own.mode, datePeriods.get(own.id) ?? []),
      };
    const standard = weekCells.find((cell) => keyOf(subjectOfRow(cell)) === key);
    return {
      ...base,
      source: "standard",
      cell:
        standard === undefined
          ? { mode: "not_set", periods: [] }
          : cellOf(standard.mode, weekPeriods.get(standard.id) ?? []),
    };
  });
  return { special: special ?? null, resolved };
}

/**
 * One subject's hours on one opening date: the default station is always open, a whole-venue
 * closure closes everything else, then the date's own cell, then the standard week.
 */
export async function resolveOpeningDateHours(
  tx: Transaction,
  cfg: VenueScope,
  subject: HoursSubject,
  openingDate: LocalDate,
): Promise<ResolvedHours> {
  const parsed = parseSubject(subject, "subject");
  if (!isLocalDate(openingDate)) invalidHours("openingDate");
  const defaults = await requireSubjects(tx, cfg, [
    { subject: parsed, field: "subject", writing: false },
  ]);
  return (await resolveSubjects(tx, cfg, [parsed], defaults, openingDate)).resolved[0]!;
}

/** Every date from `from` to `to`, both included: real dates, in order, at most a leap year. */
function rangeDates(from: unknown, to: unknown): LocalDate[] {
  if (!isLocalDate(from)) invalidHours("from");
  if (!isLocalDate(to) || to < from) invalidHours("to");
  const dates: LocalDate[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (dates.length === HOURS_RANGE_MAX_DAYS) invalidHours("to");
    dates.push(date);
  }
  return dates;
}

/**
 * The venue's subjects, their standard weeks and the special dates in `dates`, and any from
 * `listFrom` onward, with their cells, in a fixed number of reads however many dates, subjects and
 * special dates there are.
 */
async function readRange(
  tx: Transaction,
  cfg: VenueScope,
  dates: readonly LocalDate[],
  listFrom?: LocalDate,
) {
  const departmentRows = await tx
    .select({
      id: departments.id,
      name: departments.name,
      active: departments.active,
      isDefault: departments.isDefault,
    })
    .from(departments)
    .where(eq(departments.locationId, cfg.locationId))
    .orderBy(desc(departments.isDefault), asc(departments.name), asc(departments.id));
  const stationRows = await tx
    .select({
      id: kitchenStations.id,
      name: kitchenStations.name,
      active: kitchenStations.active,
      isDefault: kitchenStations.isDefault,
    })
    .from(kitchenStations)
    .where(eq(kitchenStations.locationId, cfg.locationId))
    .orderBy(asc(kitchenStations.displayOrder), asc(kitchenStations.name), asc(kitchenStations.id));
  const subjects: HoursModelSubject[] = [
    ...departmentRows.map((row) => ({ kind: "department" as const, ...row })),
    ...stationRows.map((row) => ({ kind: "station" as const, ...row })),
  ];
  const weekCells = await tx
    .select()
    .from(hoursWeekCells)
    .where(
      or(
        and(
          isNotNull(hoursWeekCells.departmentId),
          inArray(
            hoursWeekCells.departmentId,
            departmentRows.map((row) => row.id),
          ),
        ),
        and(
          isNotNull(hoursWeekCells.stationId),
          inArray(
            hoursWeekCells.stationId,
            stationRows.map((row) => row.id),
          ),
        ),
      ),
    );
  const weekPeriods = await periodsByCell(
    tx,
    hoursWeekPeriods,
    weekCells.map((cell) => cell.id),
  );
  const weeks = new Map<string, (WeekCell | undefined)[]>();
  for (const cell of weekCells) {
    const key = keyOf(subjectOfRow(cell));
    const week = weeks.get(key) ?? [];
    week[cell.weekday] = cellOf(cell.mode, weekPeriods.get(cell.id) ?? []);
    weeks.set(key, week);
  }
  const specials = await tx
    .select({
      id: specialDates.id,
      date: specialDates.date,
      name: specialDates.name,
      colour: specialDates.colour,
      closeWholeVenue: specialDates.closeWholeVenue,
    })
    .from(specialDates)
    .where(
      and(
        eq(specialDates.locationId, cfg.locationId),
        or(
          and(gte(specialDates.date, dates[0]!), lte(specialDates.date, dates[dates.length - 1]!)),
          listFrom === undefined ? undefined : gte(specialDates.date, listFrom),
        ),
      ),
    )
    .orderBy(asc(specialDates.date));
  const dateCells =
    specials.length === 0
      ? []
      : await tx
          .select()
          .from(specialDateHours)
          .where(
            inArray(
              specialDateHours.specialDateId,
              specials.map((special) => special.id),
            ),
          );
  const datePeriods = await periodsByCell(
    tx,
    specialDateHoursPeriods,
    dateCells.map((cell) => cell.id),
  );
  const cellsByDate = new Map<string, DateHoursCell[]>(specials.map((s) => [s.id, []]));
  for (const cell of dateCells)
    cellsByDate.get(cell.specialDateId)!.push({
      subject: subjectOfRow(cell),
      cell: cellOf(cell.mode, datePeriods.get(cell.id) ?? []),
    });
  for (const cells of cellsByDate.values()) cells.sort(bySubjectId);
  return { subjects, weeks, specials, cellsByDate };
}

/**
 * Each date of the range with its special date and calendar colour. The colour is Closed only
 * when every active department is Closed that date, by its week, the date's cell or a whole-venue
 * closure.
 */
function calendarDays(
  dates: readonly LocalDate[],
  range: Awaited<ReturnType<typeof readRange>>,
  holidays: readonly HolidayFact[],
): CalendarDay[] {
  const specialOn = new Map(range.specials.map((special) => [special.date, special]));
  const factsOn = new Map<LocalDate, HolidayFact[]>();
  for (const fact of holidays) {
    const facts = factsOn.get(fact.date);
    if (facts === undefined) factsOn.set(fact.date, [fact]);
    else facts.push(fact);
  }
  const active = range.subjects.filter((s) => s.kind === "department" && s.active);
  return dates.map((date) => {
    const special = specialOn.get(date) ?? null;
    const cells = special === null ? [] : range.cellsByDate.get(special.id)!;
    const modes = active.map((department) => {
      if (special?.closeWholeVenue) return "closed";
      const own = cells.find((entry) => entry.subject.id === department.id);
      if (own !== undefined) return own.cell.mode;
      return range.weeks.get(keyOf(department))?.[weekdayOf(date)]?.mode ?? "not_set";
    });
    return {
      date,
      specialDate: special,
      holidays: factsOn.get(date) ?? [],
      tone: calendarTone(special?.colour ?? null, modes as ResolvedHours["cell"]["mode"][]),
    };
  });
}

/**
 * Public holiday facts for a range of dates. A reader must read on the caller's transaction, must
 * make no network call while it is open, and must not derive its facts from special dates.
 */
export type HolidayReader = (
  tx: Transaction,
  cfg: VenueScope,
  from: LocalDate,
  to: LocalDate,
) => Promise<readonly HolidayFact[]>;

async function readHolidays(
  tx: Transaction,
  cfg: VenueScope,
  dates: readonly LocalDate[],
  holidays: HolidayReader | undefined,
): Promise<readonly HolidayFact[]> {
  return holidays === undefined ? [] : holidays(tx, cfg, dates[0]!, dates[dates.length - 1]!);
}

/** The calendar from `from` to `to`, both included, with any holiday facts `holidays` supplies. */
export async function readCalendarDays(
  tx: Transaction,
  cfg: VenueScope,
  from: LocalDate,
  to: LocalDate,
  holidays?: HolidayReader,
): Promise<CalendarDay[]> {
  const dates = rangeDates(from, to);
  const range = await readRange(tx, cfg, dates);
  return calendarDays(dates, range, await readHolidays(tx, cfg, dates, holidays));
}

/** Everything the Hours page shows for one range of dates, with the venue's date at `at`. */
export async function readHoursModel(
  tx: Transaction,
  cfg: VenueScope,
  from: LocalDate,
  to: LocalDate,
  at: Date,
  holidays?: HolidayReader,
): Promise<HoursModel> {
  const dates = rangeDates(from, to);
  const clock = await readLocationClock(tx, cfg.locationId);
  const civilDate = venueLocalMoment(at, clock)?.civilDate ?? null;
  const listFrom = civilDate === null ? from : addDays(civilDate, -1);
  const range = await readRange(tx, cfg, dates, listFrom);
  return {
    timeZone: clock.timeZone,
    dayCutover: clock.dayCutover,
    civilDate,
    clockReadable: civilDate !== null,
    subjects: range.subjects,
    week: range.subjects.map(({ kind, id }) => ({
      subject: { kind, id },
      days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        cell: range.weeks.get(keyOf({ kind, id }))?.[weekday] ?? { mode: "not_set", periods: [] },
      })),
    })),
    days: calendarDays(dates, range, await readHolidays(tx, cfg, dates, holidays)),
    specialDates: range.specials.filter((special) => special.date >= listFrom),
    specialCells: range.specials.map((special) => ({
      specialDateId: special.id,
      cells: range.cellsByDate.get(special.id)!,
    })),
  };
}

/** A station's opening schedule as routing reads it. */
export interface StationSchedule {
  /** Whether the standard week has hours set; with none, the week makes no claim. */
  weekSet: boolean;
  hours: WeeklyInterval[];
  /** Special-date hours by date, `[]` for Closed; dates where the station inherits are absent. */
  dates: Map<LocalDate, DayPeriod[]>;
}

const ALL_DAY: DayPeriod = { opensAt: "00:00", closesAt: "00:00" };

function dayPeriods(mode: StoredMode, periods: HourPeriod[]): DayPeriod[] {
  if (mode === "closed") return [];
  if (mode === "all_day") return [ALL_DAY];
  return periods.map(({ opensAt, closesAt }) => ({ opensAt, closesAt }));
}

/**
 * Every listed station's standard week, and its special-date hours from `from` to `to` (none when
 * `dates` is null), in a fixed number of reads however many stations and dates there are.
 */
export async function readStationSchedules(
  tx: Transaction,
  cfg: VenueScope,
  stationIds: readonly string[],
  dates: { from: LocalDate; to: LocalDate } | null,
): Promise<Map<string, StationSchedule>> {
  const schedules = new Map<string, StationSchedule>(
    stationIds.map((id) => [id, { weekSet: false, hours: [], dates: new Map() }]),
  );
  if (stationIds.length === 0) return schedules;
  const weekCells = await tx
    .select()
    .from(hoursWeekCells)
    .where(inArray(hoursWeekCells.stationId, [...stationIds]))
    .orderBy(asc(hoursWeekCells.weekday));
  const weekPeriods = await periodsByCell(
    tx,
    hoursWeekPeriods,
    weekCells.map((cell) => cell.id),
  );
  for (const cell of weekCells) {
    const schedule = schedules.get(cell.stationId!)!;
    schedule.weekSet = true;
    for (const period of dayPeriods(cell.mode, weekPeriods.get(cell.id) ?? []))
      schedule.hours.push({ weekday: cell.weekday, ...period });
  }
  if (dates === null) return schedules;
  const specials = await tx
    .select({
      id: specialDates.id,
      date: specialDates.date,
      closeWholeVenue: specialDates.closeWholeVenue,
    })
    .from(specialDates)
    .where(
      and(
        eq(specialDates.locationId, cfg.locationId),
        gte(specialDates.date, dates.from),
        lte(specialDates.date, dates.to),
      ),
    );
  if (specials.length === 0) return schedules;
  const dateCells = await tx
    .select()
    .from(specialDateHours)
    .where(
      and(
        inArray(
          specialDateHours.specialDateId,
          specials.map((special) => special.id),
        ),
        inArray(specialDateHours.stationId, [...stationIds]),
      ),
    );
  const datePeriods = await periodsByCell(
    tx,
    specialDateHoursPeriods,
    dateCells.map((cell) => cell.id),
  );
  const specialById = new Map(specials.map((special) => [special.id, special]));
  for (const cell of dateCells) {
    const special = specialById.get(cell.specialDateId)!;
    schedules
      .get(cell.stationId!)!
      .dates.set(special.date, dayPeriods(cell.mode, datePeriods.get(cell.id) ?? []));
  }
  for (const special of specials)
    if (special.closeWholeVenue)
      for (const schedule of schedules.values()) schedule.dates.set(special.date, []);
  return schedules;
}
