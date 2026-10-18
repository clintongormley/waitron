import { businessDayAt, cutoverForBusinessDay, type BusinessDayClock } from "@waitron/shared";
import { rangeSpan, type ClosedRange } from "./service-day.js";
import type { ServiceDayContext } from "./service-day-context.js";

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const wallTime = (minute: number) => {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** The start in force at `at`; the venue's first start when `at`'s business day cannot be read. */
export function calendarCutAnchor(clock: BusinessDayClock, at: Date): string {
  try {
    return cutoverForBusinessDay(clock, businessDayAt(clock, at));
  } catch {
    return clock.dayCutover;
  }
}

function fits(range: ClosedRange, cutover: string): boolean {
  const { start, end } = rangeSpan(range, cutover);
  return start < end;
}

/** A weekly range as a day draws it, cut at the day's ends: placed by the day's own start when it
 *  fits that start, else by `anchor` when it fits `anchor`; null when nothing of it is left. A
 *  range fitting neither, or fitting the day's own start and ending within the day, is returned
 *  as given. */
export function cutToOwnDay<T extends ClosedRange>(
  range: T,
  day: Pick<ServiceDayContext, "dayCutover" | "endMinute">,
  anchor: string,
): T | null {
  const own = fits(range, day.dayCutover);
  if (!own && !fits(range, anchor)) return range;
  const span = rangeSpan(range, own ? day.dayCutover : anchor);
  if (own && span.end <= day.endMinute) return range;
  const offset = own ? 0 : minutes(anchor) - minutes(day.dayCutover);
  const start = Math.max(span.start + offset, 0);
  const end = Math.min(span.end + offset, day.endMinute);
  if (start >= end) return null;
  const base = minutes(day.dayCutover);
  return { ...range, startsAt: wallTime(base + start), endsAt: wallTime(base + end) };
}
