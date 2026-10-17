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
function dateFormat(options: Intl.DateTimeFormatOptions, language = currentLocale()) {
  const locale = language.startsWith("es") ? "es-ES" : "en-GB";
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

/** A date's day and short month, "14 Dec", or with its year, "14 Dec 2026", in the dashboard's
 *  language. */
export function formatShortDate(date: LocalDate, year: boolean): string {
  return dateFormat(
    year ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" },
  ).format(asUtc(date));
}

/** A month's name from its number, 1 to 12, "December", in `language`, else the dashboard's. */
export function formatMonthName(month: number, language?: string): string {
  return dateFormat({ month: "long" }, language).format(
    asUtc(`2001-${String(month).padStart(2, "0")}-01`),
  );
}

/** A date's day, month and year, "12 October 2026", in the dashboard's language. */
export function formatDayMonthYear(date: LocalDate): string {
  return dateFormat({ day: "numeric", month: "long", year: "numeric" }).format(asUtc(date));
}

/** A date written out in full, "Monday, 12 October 2026", for a name read aloud. */
export function formatLongDate(date: LocalDate): string {
  return dateFormat({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
    asUtc(date),
  );
}

/** A date formatted with `options` in the dashboard's language, as the text before and after its
 *  day number: "Tuesday, " and " December 2026", or "martes, " and " de diciembre de 2026". */
export function dateAroundDay(
  date: LocalDate,
  options: Intl.DateTimeFormatOptions & { day: "numeric" },
): { before: string; after: string } {
  const parts = dateFormat(options).formatToParts(asUtc(date));
  const at = parts.findIndex((part) => part.type === "day");
  const text = (some: Intl.DateTimeFormatPart[]) => some.map((part) => part.value).join("");
  return { before: text(parts.slice(0, at)), after: text(parts.slice(at + 1)) };
}

/** A day's column heading, "Mon 12 Oct", in the dashboard's language. */
export function formatDayHeading(date: LocalDate): string {
  return dateFormat({ weekday: "short", day: "numeric", month: "short" }).format(asUtc(date));
}

/** A phone's day title in parts, "Fri 16" and "Oct", in `language`, else the dashboard's: the
 *  weekday and day as one part marked `day`, the month part carrying the `YYYY-MM` it names. */
export function formatDayTitleParts(
  date: LocalDate,
  language?: string,
): { text: string; day?: true; month?: string }[] {
  const parts = dateFormat(
    { weekday: "short", day: "numeric", month: "short" },
    language,
  ).formatToParts(asUtc(date));
  const ends = [
    parts.findIndex((part) => part.type === "weekday"),
    parts.findIndex((part) => part.type === "day"),
  ];
  const [first, last] = [Math.min(...ends), Math.max(...ends)];
  const text = (some: Intl.DateTimeFormatPart[]) => some.map((part) => part.value).join("");
  return [
    ...parts.slice(0, first).map((part) => ({ text: part.value })),
    { text: text(parts.slice(first, last + 1)), day: true as const },
    ...parts
      .slice(last + 1)
      .map((part) =>
        part.type === "month"
          ? { text: part.value, month: date.slice(0, 7) }
          : { text: part.value },
      ),
  ];
}

/** A week's title in parts, "12 – 18 Oct 2026", in `language`, else the dashboard's. A month part
 *  carries the `YYYY-MM` it names and a year part its year, read from `from` for a part the range
 *  starts with or shares and from `to` for a part it ends with. */
export function formatWeekTitleParts(
  from: LocalDate,
  to: LocalDate,
  language?: string,
): { text: string; month?: string; year?: number }[] {
  return dateFormat({ day: "numeric", month: "short", year: "numeric" }, language)
    .formatRangeToParts(asUtc(from), asUtc(to))
    .map(({ type, value, source }) => {
      const date = source === "endRange" ? to : from;
      if (type === "month") return { text: value, month: date.slice(0, 7) };
      if (type === "year") return { text: value, year: Number(date.slice(0, 4)) };
      return { text: value };
    });
}

/** The browser's own date, which stands in for the venue's until the venue's date is read. */
export function browserToday(): LocalDate {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
