import type { LocalDate } from "../hours-types.js";
import { addDays, weekdayOf } from "../hours-rules.js";

/** The year's months, "01" to "12". */
export const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));

/** A month, `YYYY-MM`. */
export type Month = string;

export function addMonths(month: Month, months: number): Month {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, number - 1 + months, 1)).toISOString().slice(0, 7);
}

export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/** Every date of the weeks that hold `month`, Monday first: the month and its real neighbours. */
export function monthGrid(month: Month): LocalDate[] {
  const first = `${month}-01`;
  const start = mondayOf(first);
  const last = addDays(`${addMonths(month, 1)}-01`, -1);
  const end = addDays(last, (7 - weekdayOf(last)) % 7);
  const dates: LocalDate[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}
