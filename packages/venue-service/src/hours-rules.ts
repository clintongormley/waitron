// Browser-safe structural rules for opening hours, shared by the writers in `./hours.ts`.
import { AppError, isUuid } from "@waitron/shared";
import {
  CALENDAR_COLOURS,
  type CalendarColour,
  type CalendarTone,
  type DateCell,
  type DateHoursCell,
  type HourPeriod,
  type HoursSubject,
  type LocalDate,
  type ResolvedHours,
  type SpecialDateInput,
  type WeekCell,
} from "./hours-types.js";
import "./errors.js";

const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MINUTES = 24 * 60;

/** Minutes from the opening date's midnight, start included and end excluded. */
export interface Interval {
  start: number;
  end: number;
}

export function invalidHours(field: string, clash?: { date: LocalDate; subjectId: string }): never {
  throw new AppError("hours.invalid", { field, ...clash });
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string" || !DATE_SHAPE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Sunday 0, Monday 1. */
export function weekdayOf(date: LocalDate): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return hours * 60 + minutes;
}

/**
 * The cell's opening on its own date's timeline. A period whose close is at or before its open
 * ends the next day, so its `end` passes 1440. `null` makes no claim at all (unset or inherit),
 * which is different from Closed's empty list.
 */
export function cellIntervals(cell: WeekCell | DateCell): Interval[] | null {
  if (cell.mode === "not_set" || cell.mode === "inherit") return null;
  if (cell.mode === "closed") return [];
  if (cell.mode === "all_day") return [{ start: 0, end: DAY_MINUTES }];
  return cell.periods.map((period) => {
    const start = minutesOf(period.opensAt);
    const end = minutesOf(period.closesAt);
    return { start, end: end > start ? end : end + DAY_MINUTES };
  });
}

/** Whether one date's hours running past midnight overlap the next date's own hours. */
export function tailOverlaps(earlier: Interval[] | null, later: Interval[] | null): boolean {
  if (earlier === null || later === null) return false;
  return earlier.some(
    (tail) => tail.end > DAY_MINUTES && later.some((next) => next.start < tail.end - DAY_MINUTES),
  );
}

/** One special date as the clash check sees it: its closure flag and its stored cells. */
export interface DateState {
  closeWholeVenue: boolean;
  cells: Map<string, Interval[] | null>;
}

/** A subject's hours on one date: the special date's cell or closure, else its standard week. */
export function effective(
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

type CellOf<M extends string> = { mode: M; periods: HourPeriod[] };

function parseCell<M extends string>(
  value: unknown,
  modes: readonly M[],
  field: string,
): CellOf<M> {
  if (typeof value !== "object" || value === null) invalidHours(field);
  const { mode, periods } = value as Record<string, unknown>;
  if (typeof mode !== "string" || !modes.includes(mode as M)) invalidHours(`${field}.mode`);
  if (!Array.isArray(periods)) invalidHours(`${field}.periods`);
  if ((mode === "periods") !== periods.length > 0) invalidHours(`${field}.periods`);
  const parsed: HourPeriod[] = periods.map((entry: unknown, index) => {
    const at = `${field}.periods.${index}`;
    if (typeof entry !== "object" || entry === null) invalidHours(at);
    const { id, opensAt, closesAt } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !isUuid(id)) invalidHours(`${at}.id`);
    if (typeof opensAt !== "string" || !CLOCK_TIME.test(opensAt)) invalidHours(`${at}.opensAt`);
    if (typeof closesAt !== "string" || !CLOCK_TIME.test(closesAt) || closesAt === opensAt)
      invalidHours(`${at}.closesAt`);
    return { id: id.toLowerCase(), opensAt, closesAt };
  });
  const intervals = cellIntervals({ mode: "periods", periods: parsed })!;
  intervals.forEach((interval, index) => {
    if (intervals.slice(0, index).some((o) => interval.start < o.end && o.start < interval.end))
      invalidHours(`${field}.periods.${index}`);
  });
  return { mode: mode as M, periods: parsed };
}

/** Refuses a period id used twice anywhere in one request. */
function assertDistinctPeriodIds(cells: { cell: { periods: HourPeriod[] }; field: string }[]) {
  const seen = new Set<string>();
  for (const { cell, field } of cells)
    cell.periods.forEach((period, index) => {
      if (seen.has(period.id)) invalidHours(`${field}.periods.${index}.id`);
      seen.add(period.id);
    });
}

export function parseSubject(value: unknown, field: string): HoursSubject {
  if (typeof value !== "object" || value === null) invalidHours(field);
  const { kind, id } = value as Record<string, unknown>;
  if (kind !== "department" && kind !== "station") invalidHours(`${field}.kind`);
  if (typeof id !== "string") invalidHours(field);
  return { kind, id };
}

export interface ParsedWeek {
  /** Indexed by weekday, Sunday first. */
  cells: WeekCell[];
  /** The request's index of each weekday, for naming the refused field. */
  indexOf: number[];
}

/**
 * A whole standard week: exactly one cell per weekday, either all seven unset or all seven
 * configured, with no two periods overlapping on one date or across a midnight, Sunday into Monday
 * included.
 */
export function parseWeek(value: unknown): ParsedWeek {
  if (!Array.isArray(value) || value.length !== 7) invalidHours("days");
  const cells: WeekCell[] = [];
  const indexOf: number[] = [];
  const asSent = value.map((entry: unknown, index) => {
    if (typeof entry !== "object" || entry === null) invalidHours(`days.${index}`);
    const { weekday, cell } = entry as Record<string, unknown>;
    if (
      typeof weekday !== "number" ||
      !Number.isInteger(weekday) ||
      weekday < 0 ||
      weekday > 6 ||
      indexOf[weekday] !== undefined
    )
      invalidHours(`days.${index}.weekday`);
    const parsed = parseCell(
      cell,
      ["not_set", "closed", "all_day", "periods"] as const,
      `days.${index}.cell`,
    ) as WeekCell;
    cells[weekday] = parsed;
    indexOf[weekday] = index;
    return { cell: parsed, field: `days.${index}.cell` };
  });
  const unset = asSent.findIndex(({ cell }) => cell.mode === "not_set");
  if (unset !== -1 && asSent.some(({ cell }) => cell.mode !== "not_set"))
    invalidHours(`days.${unset}.cell.mode`);
  assertDistinctPeriodIds(asSent);
  for (let weekday = 0; weekday < 7; weekday++)
    if (tailOverlaps(cellIntervals(cells[(weekday + 6) % 7]!), cellIntervals(cells[weekday]!)))
      invalidHours(`days.${indexOf[weekday]}.cell`);
  return { cells, indexOf };
}

/** A special date's own fields and cells, structurally; ownership and clashes are the writer's. */
export function parseSpecialDateInput(value: unknown): SpecialDateInput {
  if (typeof value !== "object" || value === null) invalidHours("input");
  const { date, name, colour, closeWholeVenue, cells } = value as Record<string, unknown>;
  if (!isLocalDate(date)) invalidHours("date");
  if (typeof name !== "string" || name.trim() === "") invalidHours("name");
  if (!CALENDAR_COLOURS.includes(colour as CalendarColour)) invalidHours("colour");
  if (typeof closeWholeVenue !== "boolean") invalidHours("closeWholeVenue");
  if (!Array.isArray(cells)) invalidHours("cells");
  const seen = new Set<string>();
  const parsed: DateHoursCell[] = cells.map((entry: unknown, index) => {
    if (typeof entry !== "object" || entry === null) invalidHours(`cells.${index}`);
    const record = entry as Record<string, unknown>;
    const subject = parseSubject(record.subject, `cells.${index}.subject`);
    const key = `${subject.kind}:${subject.id}`;
    if (seen.has(key)) invalidHours(`cells.${index}.subject`);
    seen.add(key);
    const cell = parseCell(
      record.cell,
      ["inherit", "closed", "all_day", "periods"] as const,
      `cells.${index}.cell`,
    ) as DateCell;
    return { subject, cell };
  });
  assertDistinctPeriodIds(
    parsed.map(({ cell }, index) => ({ cell, field: `cells.${index}.cell` })),
  );
  return {
    date,
    name: name.trim(),
    colour: colour as CalendarColour,
    closeWholeVenue,
    cells: parsed,
  };
}

/** The target dates of a duplication: a non-empty list of real dates, none of them twice. */
export function parseDuplicateDates(value: unknown): LocalDate[] {
  if (!Array.isArray(value) || value.length === 0) invalidHours("dates");
  const seen = new Set<LocalDate>();
  return value.map((date: unknown, index) => {
    if (!isLocalDate(date) || seen.has(date)) invalidHours(`dates.${index}`);
    seen.add(date);
    return date;
  });
}

/**
 * Closed only when the venue has active departments and every one of them is Closed that date;
 * stations play no part, and a department with no hours set is not Closed.
 */
export function calendarTone(
  colour: CalendarColour | null,
  activeDepartments: readonly ResolvedHours["cell"]["mode"][],
): CalendarTone {
  if (activeDepartments.length > 0 && activeDepartments.every((mode) => mode === "closed"))
    return "closed";
  return colour ?? "standard";
}
