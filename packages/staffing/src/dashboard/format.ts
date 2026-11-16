import { dateFormat, formatWeekTitleParts } from "@waitron/venue-service/dashboard/hours-view";

/** A Monday, so its week names the columns Monday first. */
const A_MONDAY = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;

export const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** The `index`-th day of a week, Monday 0. */
export const mondayFirst = (index: number) => new Date(A_MONDAY + index * DAY_MS);

/** A day of a week by its JavaScript weekday, Sunday 0. */
export const weekdayDate = (weekday: number) => mondayFirst((weekday + 6) % 7);

/** A date's short weekday, day and month, without the separators a locale puts between them. */
export const dateLabel = (date: string) =>
  dateFormat({ weekday: "short", day: "numeric", month: "short" })
    .formatToParts(utc(date))
    .filter(({ type }) => type !== "literal")
    .map(({ type, value }) => (type === "month" ? value.slice(0, 3) : value))
    .join(" ");

/** A Monday-to-Sunday title, with each month linked to its calendar month. */
export function weekTitleParts(monday: string, language?: string) {
  const sunday = new Date(utc(monday).getTime() + 6 * DAY_MS).toISOString().slice(0, 10);
  return formatWeekTitleParts(monday, sunday, language);
}
