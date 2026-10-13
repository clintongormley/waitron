import { isLocalDate } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";

export interface RepeatRule {
  date: LocalDate;
  repeats: boolean;
}

export function repeatKey(date: LocalDate): string {
  return date.slice(5);
}

export function occurrenceIn(day: RepeatRule, year: number): LocalDate | null {
  const date = `${String(year).padStart(4, "0")}-${repeatKey(day.date)}`;
  if (!isLocalDate(date) || date < day.date || (!day.repeats && date !== day.date)) return null;
  return date;
}

export function occursOn(day: RepeatRule, on: LocalDate): boolean {
  return occurrenceIn(day, Number(on.slice(0, 4))) === on;
}

export function nextOccurrence(day: RepeatRule, from: LocalDate): LocalDate | null {
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

/** Which of `entries` stands on each day of `year` that any falls on. A date standing there on its
 *  own terms beats one following a holiday's name there; otherwise the first in `entries` wins. */
export function standingInYear<T>(
  entries: readonly T[],
  year: number,
  dateIn: (entry: T, year: number) => LocalDate | null,
  followsIn: (entry: T, year: number) => boolean,
): Map<LocalDate, T> {
  const standing = new Map<LocalDate, T>();
  for (const following of [false, true])
    for (const entry of entries) {
      if (followsIn(entry, year) !== following) continue;
      const date = dateIn(entry, year);
      if (date !== null && !standing.has(date)) standing.set(date, entry);
    }
  return standing;
}
