import { dateTimeFormat, formatBusinessDate } from "@waitron/dashboard-kit";
import type { ManagerHours, PersonHours } from "@waitron/dashboard-modules";
import { localTimeOccurrences } from "@waitron/venue-service/hours-occurrences";
import { MS_PER_DAY, wallClock } from "./date-utils.js";
import { currentLocale } from "./i18n/t.js";

type Period = ManagerHours["period"];
const utc = (date: string) => new Date(date);
const dateOf = (date: Date) => date.toISOString().slice(0, 10);
const previousDay = (date: string) => new Date(utc(date).getTime() - MS_PER_DAY);

export function wholeMonth(period: Period): boolean {
  return (
    period.start.endsWith("-01") &&
    period.end.endsWith("-01") &&
    dateOf(previousDay(period.end)).slice(0, 7) === period.start.slice(0, 7)
  );
}

export function periodLabel(period: Period): string {
  return wholeMonth(period)
    ? dateTimeFormat(currentLocale(), { month: "long", year: "numeric", timeZone: "UTC" }).format(
        utc(period.start),
      )
    : dateTimeFormat(currentLocale(), { dateStyle: "medium", timeZone: "UTC" }).formatRange(
        utc(period.start),
        previousDay(period.end),
      );
}

export function periodStep(period: Period, direction: -1 | 1): string {
  return direction === -1 ? dateOf(previousDay(period.start)) : period.end;
}

export function requestedPeriodLabel(from: Period, date: string): string {
  if (date === from.start) return periodLabel(from);
  const at = utc(date);
  if (!wholeMonth(from))
    return dateTimeFormat(currentLocale(), { dateStyle: "medium", timeZone: "UTC" }).format(at);
  at.setUTCDate(1);
  const start = dateOf(at);
  at.setUTCMonth(at.getUTCMonth() + 1);
  return periodLabel({ start, end: dateOf(at) });
}

export function hoursZone(view: PersonHours, date: string): string {
  const saved = view.closures.find(({ period }) => period.start <= date && date < period.end);
  return saved?.clock.timeZone ?? view.clock.timeZone;
}

export function hoursDate(date: string, periodStart?: string): string {
  const label = formatBusinessDate(date);
  return periodStart && date.slice(0, 4) !== periodStart.slice(0, 4)
    ? `${label} ${date.slice(0, 4)}`
    : label;
}

export function hoursTime(
  at: string,
  offset: number,
  timeZone: string,
  sameDay?: string,
  periodStart?: string,
): string {
  const { date, time } = wallClock(at, offset);
  const label = sameDay === date ? time : `${hoursDate(date, periodStart)}, ${time}`;
  if (localTimeOccurrences(date, time, timeZone).length < 2) return label;
  const abs = Math.abs(offset);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `${label} ${offset < 0 ? "-" : "+"}${hours}:${minutes}`;
}
