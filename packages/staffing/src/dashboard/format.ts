import { currentLocale } from "@waitron/dashboard-kit";

/** A Monday, so its week names the columns Monday first. */
const A_MONDAY = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;

export const formatLocale = (language = currentLocale()) =>
  language.startsWith("es") ? "es-ES" : "en-GB";

const formatters = new Map<string, Intl.DateTimeFormat>();
export function dateFormat(
  options: Intl.DateTimeFormatOptions,
  language?: string,
): Intl.DateTimeFormat {
  const locale = formatLocale(language);
  const key = `${locale} ${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    formatters.set(key, formatter);
  }
  return formatter;
}

export const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** A date as `formatter` writes it, split into the text before and after its day number. */
export function dateAroundDay(
  date: string,
  formatter: Intl.DateTimeFormat,
): { before: string; after: string } {
  const parts = formatter.formatToParts(utc(date));
  const at = parts.findIndex((part) => part.type === "day");
  const text = (some: Intl.DateTimeFormatPart[]) => some.map((part) => part.value).join("");
  return { before: text(parts.slice(0, at)), after: text(parts.slice(at + 1)) };
}

/** The `index`-th day of a week, Monday 0. */
export const mondayFirst = (index: number) => new Date(A_MONDAY + index * DAY_MS);

/** A day of a week by its JavaScript weekday, Sunday 0. */
export const weekdayDate = (weekday: number) => mondayFirst((weekday + 6) % 7);

/** A leap year, so a season ending 29 February reads as itself. */
export const monthDay = (md: string) =>
  dateFormat({ day: "numeric", month: "short" }).format(utc(`2000-${md}`));

/** A date's short weekday, day and month, without the separators a locale puts between them. */
export const dateLabel = (date: string) =>
  dateFormat({ weekday: "short", day: "numeric", month: "short" })
    .formatToParts(utc(date))
    .filter(({ type }) => type !== "literal")
    .map(({ value }) => value)
    .join(" ");

/** A week's title in parts, "30 Nov – 6 Dec 2026", from its Monday, in `language`, else the
 *  dashboard's. A month part carries the `YYYY-MM` it names. A copy of venue-service's
 *  `formatWeekTitleParts` (`hours-view.ts`), which its package does not export. */
export function weekTitleParts(
  monday: string,
  language?: string,
): { text: string; month?: string }[] {
  const sunday = new Date(utc(monday).getTime() + 6 * DAY_MS).toISOString().slice(0, 10);
  return dateFormat({ day: "numeric", month: "short", year: "numeric" }, language)
    .formatRangeToParts(utc(monday), utc(sunday))
    .map(({ type, value, source }) =>
      type === "month"
        ? { text: value, month: (source === "endRange" ? sunday : monday).slice(0, 7) }
        : { text: value },
    );
}
