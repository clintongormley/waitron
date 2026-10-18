import { currentLocale, dateTimeFormat } from "@waitron/dashboard-kit";
import type { LocalDate } from "../hours-types.js";
import { t } from "./strings.js";

export function format(key: Parameters<typeof t>[0], values: Record<string, string> = {}): string {
  return t(key).replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? values[name]! : whole,
  );
}

function dateFormat(options: Intl.DateTimeFormatOptions, language = currentLocale()) {
  return dateTimeFormat(language.startsWith("es") ? "es-ES" : "en-GB", {
    ...options,
    timeZone: "UTC",
  });
}
const asUtc = (date: LocalDate) => new Date(`${date}T00:00:00Z`);
const joined = (parts: Intl.DateTimeFormatPart[]) => parts.map((part) => part.value).join("");

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
  return { before: joined(parts.slice(0, at)), after: joined(parts.slice(at + 1)) };
}

/** A day's column heading, "Mon 12 Oct", in the dashboard's language. */
export function formatDayHeading(date: LocalDate): string {
  return dateFormat({ weekday: "short", day: "numeric", month: "short" }).format(asUtc(date));
}

/** A phone's day title in parts, "Fri 16" and "Oct", in `language`, else the dashboard's; see
 *  `dayTitleFromParts`. */
export function formatDayTitleParts(
  date: LocalDate,
  language?: string,
): { text: string; day?: true; month?: string }[] {
  return dayTitleFromParts(
    dateFormat({ weekday: "short", day: "numeric", month: "short" }, language).formatToParts(
      asUtc(date),
    ),
    date,
  );
}

/** A day title's formatted parts as one part marked `day`, its first letter a capital, holding the
 *  weekday, the day and the literals between them — or the day alone where the month falls between
 *  them — and the month part carrying `date`'s `YYYY-MM`. */
export function dayTitleFromParts(
  parts: Intl.DateTimeFormatPart[],
  date: LocalDate,
): { text: string; day?: true; month?: string }[] {
  const at = (type: Intl.DateTimeFormatPartTypes) => parts.findIndex((part) => part.type === type);
  const [weekday, day, month] = [at("weekday"), at("day"), at("month")];
  const between = month > Math.min(weekday, day) && month < Math.max(weekday, day);
  const [first, last] = between ? [day, day] : [Math.min(weekday, day), Math.max(weekday, day)];
  const plain = (part: Intl.DateTimeFormatPart) =>
    part.type === "month" ? { text: part.value, month: date.slice(0, 7) } : { text: part.value };
  const shaped = [
    ...parts.slice(0, first).map(plain),
    { text: joined(parts.slice(first, last + 1)), day: true as const },
    ...parts.slice(last + 1).map(plain),
  ];
  const [head] = shaped;
  head!.text = head!.text.charAt(0).toUpperCase() + head!.text.slice(1);
  return shaped;
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
