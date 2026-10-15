import { currentLocale } from "@waitron/dashboard-kit";

/** A Monday, so its week names the columns Monday first. */
const A_MONDAY = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;

export const formatLocale = () => (currentLocale().startsWith("es") ? "es-ES" : "en-GB");

const formatters = new Map<string, Intl.DateTimeFormat>();
export function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = formatLocale();
  const key = `${locale} ${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    formatters.set(key, formatter);
  }
  return formatter;
}

export const utc = (date: string) => new Date(`${date}T00:00:00Z`);

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
