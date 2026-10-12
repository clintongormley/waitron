import { isLocalDate } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";

export const NAMED_DAY_KINDS = ["holiday", "working_day"] as const;
export type NamedDayKind = (typeof NAMED_DAY_KINDS)[number];

export interface NamedDayRule {
  date: LocalDate;
  repeats: boolean;
}

export function repeatKey(date: LocalDate): string {
  return date.slice(5);
}

export function occurrenceIn(day: NamedDayRule, year: number): LocalDate | null {
  const date = `${String(year).padStart(4, "0")}-${repeatKey(day.date)}`;
  if (!isLocalDate(date) || date < day.date || (!day.repeats && date !== day.date)) return null;
  return date;
}

export function occursOn(day: NamedDayRule, on: LocalDate): boolean {
  return occurrenceIn(day, Number(on.slice(0, 4))) === on;
}

export function nextOccurrence(day: NamedDayRule, from: LocalDate): LocalDate | null {
  if (!day.repeats) return day.date >= from ? day.date : null;
  for (
    let year = Math.max(Number(day.date.slice(0, 4)), Number(from.slice(0, 4)));
    year <= 9999;
    year++
  ) {
    const date = occurrenceIn(day, year);
    if (date !== null && date >= from) return date;
  }
  return null;
}
