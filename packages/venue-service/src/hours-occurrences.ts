// Browser-safe: the dashboard loads this, so it must not import `@waitron/reporting`.
import { addDays } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";

const MINUTE_MS = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The zone's offset from UTC in whole minutes at the instant `ms`. */
export function offsetMinutes(ms: number, timeZone: string): number {
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

const CLOCK_TIME = /^\d{2}:\d{2}$/;

/**
 * The opening and closing times of `periods` on `date` that the clock shows twice, each once and
 * in order; a closing after midnight is checked on the next date. A period missing either time is
 * skipped.
 */
export function repeatedTimes(
  date: LocalDate,
  periods: readonly { opensAt: string; closesAt: string }[],
  timeZone: string,
): string[] {
  const times = new Set<string>();
  for (const { opensAt, closesAt } of periods) {
    if (!CLOCK_TIME.test(opensAt) || !CLOCK_TIME.test(closesAt)) continue;
    if (localTimeOccurrences(date, opensAt, timeZone).length > 1) times.add(opensAt);
    const closingDate = closesAt > opensAt ? date : addDays(date, 1);
    if (localTimeOccurrences(closingDate, closesAt, timeZone).length > 1) times.add(closesAt);
  }
  return [...times];
}
