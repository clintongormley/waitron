import { currentLocale } from "@waitron/dashboard-kit";
import type { LocalDate } from "../hours-types.js";
import { t } from "./strings.js";

export function format(key: Parameters<typeof t>[0], values: Record<string, string> = {}): string {
  return t(key).replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? values[name]! : whole,
  );
}

/** One formatter per language and options: building one costs far more than using it, and the
 *  Year draws hundreds of dates on every render. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function dateFormat(options: Intl.DateTimeFormatOptions) {
  const locale = currentLocale().startsWith("es") ? "es-ES" : "en-GB";
  const key = `${locale} ${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    formatters.set(key, formatter);
  }
  return formatter;
}
const asUtc = (date: LocalDate) => new Date(`${date}T00:00:00Z`);

/** A date as the dashboard reads it, "Mon, 12 Oct 2026", in the dashboard's language. */
export function formatDate(date: LocalDate): string {
  return dateFormat({ weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(
    asUtc(date),
  );
}

/** A date's weekday, "M", "Mon" or "Monday", in the dashboard's language. */
export function formatWeekday(date: LocalDate, style: "narrow" | "short" | "long"): string {
  return dateFormat({ weekday: style }).format(asUtc(date));
}

/** A day of the year from its MM-DD, "1 Dec", in the dashboard's language. */
export function formatMonthDay(monthDay: string): string {
  // A leap year, so a leap year's last day of February, 02-29, reads as itself.
  return dateFormat({ day: "numeric", month: "short" }).format(asUtc(`2000-${monthDay}`));
}

/** A month's name from its number, 1 to 12, "December", in the dashboard's language. */
export function formatMonthName(month: number): string {
  return dateFormat({ month: "long" }).format(asUtc(`2001-${String(month).padStart(2, "0")}-01`));
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
