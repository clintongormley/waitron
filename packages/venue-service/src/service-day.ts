import { venueMomentAt } from "@waitron/reporting";
import { AppError, isUuid } from "@waitron/shared";
import { addDays, weekdayOf } from "./hours-rules.js";
import { localTimeOccurrences } from "./hours-occurrences.js";
import { invalidTimetable } from "./menu-timetable-rules.js";
import "./errors.js";

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

export interface ClosedRange {
  startsAt: string;
  endsAt: string;
}
type RangeReason = "empty" | "order" | "step" | "overlap";
function parseRanges<T extends ClosedRange>(
  value: unknown,
  field: string,
  cutover: string,
  invalid: (field: string, reason?: RangeReason) => never,
  read: (entry: Record<string, unknown>, at: string, range: ClosedRange) => T,
): T[] {
  if (!Array.isArray(value)) invalid(field);
  const ranges = value.map((entry: unknown, index): T => {
    const at = `${field}.${index}`;
    if (typeof entry !== "object" || entry === null) invalid(at);
    const { startsAt, endsAt } = entry as Record<string, unknown>;
    if (typeof startsAt !== "string" || !CLOCK_TIME.test(startsAt)) invalid(`${at}.startsAt`);
    if (typeof endsAt !== "string" || !CLOCK_TIME.test(endsAt)) invalid(`${at}.endsAt`);
    const range = { startsAt, endsAt };
    const span = rangeSpan(range, cutover);
    if (span.start === span.end) invalid(field, "empty");
    if (span.start > span.end) invalid(field, "order");
    if (
      clockMinutes(startsAt) % SERVICE_STEP_MINUTES !== 0 ||
      clockMinutes(endsAt) % SERVICE_STEP_MINUTES !== 0
    )
      invalid(field, "step");
    return read(entry as Record<string, unknown>, at, range);
  });
  ranges.sort(
    (a, b) => minuteOfServiceDay(a.startsAt, cutover) - minuteOfServiceDay(b.startsAt, cutover),
  );
  for (let index = 1; index < ranges.length; index++) {
    if (rangeSpan(ranges[index]!, cutover).start < rangeSpan(ranges[index - 1]!, cutover).end)
      invalid(field, "overlap");
  }
  return ranges;
}

export function parseServiceDay(value: unknown, field: string, cutover: string): ServiceRange[] {
  return parseRanges(
    value,
    field,
    cutover,
    (field, reason) => invalidTimetable(field, reason === undefined ? undefined : { reason }),
    (entry, at, range) => {
      const { periodId } = entry;
      if (typeof periodId !== "string" || !isUuid(periodId)) invalidTimetable(`${at}.periodId`);
      return { periodId: periodId.toLowerCase(), ...range };
    },
  );
}

export function parseClosedRanges(value: unknown, field: string, cutover: string): ClosedRange[] {
  return parseRanges(
    value,
    field,
    cutover,
    (field, reason) => {
      throw new AppError("zone_closed_time.invalid", {
        field,
        ...(reason === undefined ? {} : { reason }),
      });
    },
    (_entry, _at, range) => range,
  );
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

export type ServiceExtension = ServiceRange;

export function withExtension(
  ranges: readonly ServiceRange[],
  extension: ServiceExtension | null,
  cutover: string,
): ServiceRange[] {
  const result: ServiceRange[] = [];
  const extended = extension === null ? null : rangeSpan(extension, cutover);
  for (const range of ranges) {
    const span = rangeSpan(range, cutover);
    if (
      extension === null ||
      extended === null ||
      span.end <= extended.start ||
      span.start >= extended.end
    ) {
      result.push({ ...range });
      continue;
    }
    if (span.start < extended.start) result.push({ ...range, endsAt: extension.startsAt });
    if (span.end > extended.end) result.push({ ...range, startsAt: extension.endsAt });
  }
  if (extension !== null) result.push({ ...extension });
  return result.sort((a, b) => rangeSpan(a, cutover).start - rangeSpan(b, cutover).start);
}

export function clockTimeSkipped(
  businessDay: string,
  time: string,
  cutover: string,
  timeZone: string,
  asEnd: boolean,
): boolean {
  const date =
    asEnd && time === cutover
      ? addDays(businessDay, 1)
      : calendarDateOfTime(businessDay, time, cutover);
  return localTimeOccurrences(date, time, timeZone).length === 0;
}
