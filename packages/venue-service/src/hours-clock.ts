import { civilDateOf, venueMomentAt } from "@waitron/reporting";
import type { LocalDate } from "./hours-types.js";

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

const MINUTE_MS = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The zone's offset from UTC in whole minutes at the instant `ms`. */
function offsetMinutes(ms: number, timeZone: string): number {
  let format = formatters.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, format);
  }
  const part = Object.fromEntries(format.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const wall = Date.UTC(+part.year!, +part.month! - 1, +part.day!, +part.hour!, +part.minute!);
  return Math.round((wall - Math.floor(ms / MINUTE_MS) * MINUTE_MS) / MINUTE_MS);
}

/**
 * Every instant at which the venue's clock reads `time` on `date`, earlier first: none for a minute
 * a forward clock change skips, two for a minute a backward change repeats.
 */
export function localTimeOccurrences(date: LocalDate, time: string, timeZone: string): Date[] {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, Number(time.slice(0, 2)), Number(time.slice(3, 5)));
  const day = 24 * 60 * MINUTE_MS;
  const offsets = new Set([
    offsetMinutes(wall - day, timeZone),
    offsetMinutes(wall + day, timeZone),
  ]);
  return [...offsets]
    .map((offset) => wall - offset * MINUTE_MS)
    .filter((instant) => instant + offsetMinutes(instant, timeZone) * MINUTE_MS === wall)
    .sort((a, b) => a - b)
    .map((instant) => new Date(instant));
}

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
