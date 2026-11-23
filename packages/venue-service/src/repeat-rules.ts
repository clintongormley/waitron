import { isLocalDate } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";

export interface RepeatRule {
  date: LocalDate;
  repeats: boolean;
}

export interface SpecialDayDateRule extends RepeatRule {
  /** The official name of the public holiday on `date` when it was saved, if any. */
  holidayName?: string | null;
}

/** Official public holidays by year, then by name, each at its date that year. */
export type HolidayDates = ReadonlyMap<number, ReadonlyMap<string, LocalDate>>;

export const NO_HOLIDAY_DATES: HolidayDates = new Map();

export const yearOf = (date: LocalDate) => Number(date.slice(0, 4));

export const followsHoliday = (rule: SpecialDayDateRule) =>
  rule.repeats && rule.holidayName !== undefined && rule.holidayName !== null;

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
export function nextSpecialDate(
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
