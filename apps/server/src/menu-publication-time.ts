import { AppError } from "@waitron/shared";
import type { LocalTime } from "@waitron/catalogue";
import { civilDateOf, validateTimeZone } from "@waitron/reporting";
import { isLocalDate, localTimeOccurrences, offsetMinutes } from "@waitron/venue-service";
import "./errors.js";

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTE_MS = 60_000;

function invalid(field: string): never {
  throw new AppError("management.request_invalid", { field });
}

/** The zone, refused `time_zone.unreadable` unless it is a named zone. */
export function checkedTimeZone(timeZone: string): string {
  try {
    validateTimeZone(timeZone);
  } catch {
    throw new AppError("time_zone.unreadable", {});
  }
  return timeZone;
}

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const whole = Math.abs(minutes);
  const hours = String(Math.floor(whole / 60)).padStart(2, "0");
  return `${sign}${hours}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * The instant a request's `{ date, time, occurrence? }` names on the venue clock. A repeated minute
 * needs `occurrence`; it is ignored when the minute occurs once.
 */
export function activationInstant(value: unknown, timeZone: string): Date {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("activatesAt");
  const { date, time, occurrence } = value as Record<string, unknown>;
  if (!isLocalDate(date)) invalid("activatesAt.date");
  if (typeof time !== "string" || !CLOCK_TIME.test(time)) invalid("activatesAt.time");
  if (occurrence !== undefined && occurrence !== "earlier" && occurrence !== "later")
    invalid("activatesAt.occurrence");
  const occurrences = localTimeOccurrences(date, time, checkedTimeZone(timeZone));
  const [earlier, later] = occurrences;
  if (earlier === undefined) throw new AppError("menu_publication.time_skipped", { date, time });
  if (later === undefined) return earlier;
  if (occurrence === undefined) {
    throw new AppError("menu_publication.time_repeated", {
      date,
      time,
      occurrences: occurrences.map((at) => ({
        at: at.toISOString(),
        offset: offsetText(offsetMinutes(at.getTime(), timeZone)),
      })),
    });
  }
  return occurrence === "earlier" ? earlier : later;
}

/** `instant` as the venue clock shows it. The caller checks `timeZone` first. */
export function localTimeOf(instant: Date, timeZone: string): LocalTime {
  const offset = offsetMinutes(instant.getTime(), timeZone);
  const date = civilDateOf(instant, timeZone);
  const time = new Date(instant.getTime() + offset * MINUTE_MS).toISOString().slice(11, 16);
  return {
    date,
    time,
    offset: offsetText(offset),
    repeated: localTimeOccurrences(date, time, timeZone).length > 1,
  };
}
