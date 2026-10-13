// Browser-safe structural rules for opening hours, shared by the writers in `./hours.ts`.
import { AppError } from "@waitron/shared";
import {
  CALENDAR_YEAR_MAX,
  CALENDAR_YEAR_MIN,
  HOURS_RANGE_MAX_DAYS,
  type LocalDate,
} from "./hours-types.js";
import "./errors.js";

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function invalidHours(field: string): never {
  throw new AppError("hours.invalid", { field });
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string" || !DATE_SHAPE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** A four-digit year from `CALENDAR_YEAR_MIN` to `CALENDAR_YEAR_MAX`, or null. */
export function parseCalendarYear(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return year >= CALENDAR_YEAR_MIN && year <= CALENDAR_YEAR_MAX ? year : null;
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

/** Midnight UTC of a date; unlike `Date.UTC`, which reads years 0 to 99 as 1900 to 1999. */
function utcDay(y: number, m: number, d: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return utcDay(y, m, d + days)
    .toISOString()
    .slice(0, 10);
}

/** Sunday 0, Monday 1. */
export function weekdayOf(date: LocalDate): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return utcDay(y, m, d).getUTCDay();
}
