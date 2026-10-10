import { currentLocale } from "@waitron/dashboard-kit";
import type { LocalDate } from "../hours-types.js";
import { t } from "./strings.js";

export function format(key: Parameters<typeof t>[0], values: Record<string, string> = {}): string {
  return t(key).replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? values[name]! : whole,
  );
}

function dateFormat(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(currentLocale().startsWith("es") ? "es-ES" : "en-GB", {
    ...options,
    timeZone: "UTC",
  });
}
const asUtc = (date: LocalDate) => new Date(`${date}T00:00:00Z`);

/** A date as the dashboard reads it, "Mon 12 Oct 2026", in the dashboard's language. */
export function formatDate(date: LocalDate): string {
  return dateFormat({ weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(
    asUtc(date),
  );
}

/** A date written out in full, "Monday, 12 October 2026", for a name read aloud. */
export function formatLongDate(date: LocalDate): string {
  return dateFormat({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
    asUtc(date),
  );
}

/** The browser's own date, which stands in for the venue's until the venue's date is read. */
export function browserToday(): LocalDate {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
