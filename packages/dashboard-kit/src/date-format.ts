import { currentLocale } from "./i18n.js";

/** An ISO-8601 instant as `YYYY-MM-DD HH:MM` in the BROWSER's local timezone, not UTC: an operator
 * reads it against the clock on the wall. */
export function formatIsoMinute(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per locale and options, shared: building one costs far more than using it, and
 *  render paths format on every render. */
export function dateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale} ${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, formatter);
  }
  return formatter;
}

function partsOf(
  at: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of dateTimeFormat(locale, options).formatToParts(at)) {
    parts[part.type] = part.value;
  }
  return parts;
}

/** Built from parts rather than Intl's own pattern, which in es-ES puts a comma after the weekday. */
export function formatChangeoverMoment(
  iso: string,
  timeZone: string,
  locale: string = currentLocale(),
): string {
  const p = partsOf(new Date(iso), locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

/** A `YYYY-MM-DD` business date names a calendar day, so it is read in UTC, never the browser's zone. */
export function formatBusinessDate(day: string, locale: string = currentLocale()): string {
  const p = partsOf(new Date(`${day}T00:00:00.000Z`), locale, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${p.weekday} ${p.day} ${p.month}`;
}

export function formatDayLength(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours > 0 ? `${hours} h` : "", rest > 0 ? `${rest} min` : ""].filter(Boolean).join(" ");
}
