// Browser-safe structural rules for opening hours, shared by the writers in `./hours.ts`.
import { AppError } from "@waitron/shared";
import { HOURS_RANGE_MAX_DAYS, type LocalDate, type SpecialDateInput } from "./hours-types.js";
import { NAMED_DAY_KINDS, type NamedDayKind } from "./named-day-rules.js";
import "./errors.js";

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function invalidHours(field: string, clash?: { date: LocalDate; subjectId: string }): never {
  throw new AppError("hours.invalid", { field, ...clash });
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string" || !DATE_SHAPE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Every date from `from` to `to`, both included: real dates, in order, at most a leap year. */
export function rangeDates(from: unknown, to: unknown): LocalDate[] {
  if (!isLocalDate(from)) invalidHours("from");
  if (!isLocalDate(to) || to < from) invalidHours("to");
  const dates: LocalDate[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (dates.length === HOURS_RANGE_MAX_DAYS) invalidHours("to");
    dates.push(date);
  }
  return dates;
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

/** A special date's name, trimmed; a blank one is refused. */
export function specialDateName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") invalidHours("name");
  return value.trim();
}

export function parseSpecialDateInput(value: unknown): SpecialDateInput {
  if (typeof value !== "object" || value === null) invalidHours("input");
  const { date, name, kind, repeats, ownHours, closeWholeVenue } = value as Record<string, unknown>;
  if (!isLocalDate(date)) invalidHours("date");
  const trimmed = specialDateName(name);
  if (
    kind !== undefined &&
    (typeof kind !== "string" || !NAMED_DAY_KINDS.includes(kind as NamedDayKind))
  )
    invalidHours("kind");
  if (repeats !== undefined && typeof repeats !== "boolean") invalidHours("repeats");
  if (ownHours !== undefined && typeof ownHours !== "boolean") invalidHours("ownHours");
  if (typeof closeWholeVenue !== "boolean") invalidHours("closeWholeVenue");
  return {
    date,
    name: trimmed,
    kind: kind as NamedDayKind | undefined,
    repeats: repeats as boolean | undefined,
    ownHours: ownHours as boolean | undefined,
    closeWholeVenue,
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
