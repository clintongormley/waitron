import { civilDateOf, validateTimeZone, venueMomentAt } from "@waitron/reporting";
import { localTimeOccurrences, offsetMinutes } from "./hours-occurrences.js";
import { addDays } from "./hours-rules.js";
import type { DateHoursCell, LocalDate } from "./hours-types.js";

export interface VenueLocalMoment {
  readonly civilDate: LocalDate;
  readonly weekday: number;
  readonly timeOfDay: string;
  readonly businessDay: string;
}

/**
 * The venue's wall clock at `at`: its calendar date, which owns opening hours, and separately its
 * business day, which turns at the cutover and owns manual station overrides. `null` for a clock
 * that cannot be read.
 */
export function venueLocalMoment(
  at: Date,
  clock: { timeZone: string; dayCutover: string },
): VenueLocalMoment | null {
  const moment = venueMomentAt(at, clock);
  if (moment === null) return null;
  return { civilDate: civilDateOf(at, clock.timeZone), ...moment };
}

/** Whether the venue's zone and cutover can be read at all. */
export function isReadableClock(clock: { timeZone: string; dayCutover: string }): boolean {
  return venueMomentAt(new Date(0), clock) !== null;
}

/** Whether a zone alone can be read, by the rule {@link isReadableClock} applies to it. */
export function isReadableZone(timeZone: string): boolean {
  try {
    validateTimeZone(timeZone);
    return true;
  } catch {
    return false;
  }
}

const MINUTE_MS = 60_000;

/** The instants after `from`, up to `to`, at which the venue's clock jumps forward or back. */
export function clockChangesBetween(from: Date, to: Date, timeZone: string): Date[] {
  const step = 3 * 60 * MINUTE_MS;
  const changes: Date[] = [];
  for (let start = from.getTime(); start < to.getTime(); start += step) {
    const end = Math.min(start + step, to.getTime());
    if (offsetMinutes(start, timeZone) === offsetMinutes(end, timeZone)) continue;
    let low = Math.floor(start / MINUTE_MS);
    let high = Math.floor(end / MINUTE_MS);
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (offsetMinutes(middle * MINUTE_MS, timeZone) === offsetMinutes(start, timeZone))
        low = middle;
      else high = middle;
    }
    changes.push(new Date(high * MINUTE_MS));
  }
  return changes;
}

/**
 * The first period, by its cell's index and its own position, that opens or closes at a minute the
 * clock skips on `date`; a closing after midnight is checked on the next date.
 */
export function skippedEndpoint(
  date: LocalDate,
  cells: readonly Pick<DateHoursCell, "cell">[],
  timeZone: string,
): { index: number; position: number; end: "opensAt" | "closesAt" } | null {
  for (const [index, { cell }] of cells.entries())
    for (const [position, period] of cell.periods.entries()) {
      const closingDate = period.closesAt > period.opensAt ? date : addDays(date, 1);
      if (localTimeOccurrences(date, period.opensAt, timeZone).length === 0)
        return { index, position, end: "opensAt" };
      if (localTimeOccurrences(closingDate, period.closesAt, timeZone).length === 0)
        return { index, position, end: "closesAt" };
    }
  return null;
}
