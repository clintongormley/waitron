import { venueMomentAt } from "@waitron/reporting";
import { isUuid } from "@waitron/shared";
import { addDays, weekdayOf } from "./hours-rules.js";
import { invalidTimetable } from "./menu-timetable-rules.js";

export interface ServiceRange {
  periodId: string;
  startsAt: string;
  endsAt: string;
}

export interface ServiceMoment {
  businessDay: string;
  weekday: number;
  minute: number;
}

export const SERVICE_STEP_MINUTES = 15;
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function clockMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function minuteOfServiceDay(time: string, cutover: string): number {
  return (clockMinutes(time) - clockMinutes(cutover) + 1440) % 1440;
}

export function rangeSpan(
  range: Pick<ServiceRange, "startsAt" | "endsAt">,
  cutover: string,
): { start: number; end: number } {
  return {
    start: minuteOfServiceDay(range.startsAt, cutover),
    // The changeover is the exclusive end, allowing one range to fill the whole day.
    end: minuteOfServiceDay(range.endsAt, cutover) || 1440,
  };
}

export function parseServiceDay(value: unknown, field: string, cutover: string): ServiceRange[] {
  if (!Array.isArray(value)) invalidTimetable(field);
  const ranges = value.map((entry: unknown, index): ServiceRange => {
    const at = `${field}.${index}`;
    if (typeof entry !== "object" || entry === null) invalidTimetable(at);
    const { periodId, startsAt, endsAt } = entry as Record<string, unknown>;
    if (typeof periodId !== "string" || !isUuid(periodId)) invalidTimetable(`${at}.periodId`);
    if (typeof startsAt !== "string" || !CLOCK_TIME.test(startsAt))
      invalidTimetable(`${at}.startsAt`);
    if (typeof endsAt !== "string" || !CLOCK_TIME.test(endsAt)) invalidTimetable(`${at}.endsAt`);
    const range = { periodId: periodId.toLowerCase(), startsAt, endsAt };
    const span = rangeSpan(range, cutover);
    if (span.start === span.end) invalidTimetable(field, { reason: "empty" });
    if (span.start > span.end) invalidTimetable(field, { reason: "order" });
    if (
      clockMinutes(startsAt) % SERVICE_STEP_MINUTES !== 0 ||
      clockMinutes(endsAt) % SERVICE_STEP_MINUTES !== 0
    )
      invalidTimetable(field, { reason: "step" });
    return range;
  });
  ranges.sort(
    (a, b) => minuteOfServiceDay(a.startsAt, cutover) - minuteOfServiceDay(b.startsAt, cutover),
  );
  for (let index = 1; index < ranges.length; index++) {
    if (rangeSpan(ranges[index]!, cutover).start < rangeSpan(ranges[index - 1]!, cutover).end)
      invalidTimetable(field, { reason: "overlap" });
  }
  return ranges;
}

export function serviceMomentAt(
  at: Date,
  clock: { timeZone: string; dayCutover: string },
): ServiceMoment | null {
  const moment = venueMomentAt(at, clock);
  if (moment === null) return null;
  return {
    businessDay: moment.businessDay,
    weekday: weekdayOf(moment.businessDay),
    minute: minuteOfServiceDay(moment.timeOfDay, clock.dayCutover),
  };
}

export function rangeInForce(
  ranges: readonly ServiceRange[],
  minute: number,
  cutover: string,
): ServiceRange | null {
  return (
    ranges.find((range) => {
      const { start, end } = rangeSpan(range, cutover);
      return start <= minute && minute < end;
    }) ?? null
  );
}

export function calendarDateOfTime(businessDay: string, time: string, cutover: string): string {
  return time < cutover ? addDays(businessDay, 1) : businessDay;
}
