import { currentLocale, dateTimeFormat } from "@waitron/dashboard-kit";

function parts(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const out: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of dateTimeFormat(currentLocale(), { timeZone, ...options }).formatToParts(
    new Date(iso),
  )) {
    out[part.type] = part.value;
  }
  return out;
}

export function day(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone, { day: "numeric", month: "short", year: "numeric" });
  return `${p.day} ${p.month} ${p.year}`;
}

export function time(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${p.hour}:${p.minute}`;
}

/** A calendar date the server already took in the venue's zone, `YYYY-MM-DD`, as "1 Oct 2026". */
export function calendarDay(date: string): string {
  return day(`${date}T00:00:00Z`, "UTC");
}
