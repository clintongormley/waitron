// Browser-safe: types and constants only, no database or server imports.

/** A real venue-local calendar date, `YYYY-MM-DD`. */
export type LocalDate = string;

export { CALENDAR_COLOURS, type CalendarColour } from "@waitron/shared";

export type CalendarTone = "public_holiday" | "special_day" | "closed" | "standard";

/** A public holiday fact for a date, supplied by a `HolidayReader` (`./hours.ts`) when one is given. */
export interface HolidayFact {
  id: string;
  date: LocalDate;
  name: string;
  scope: "national" | "regional" | "local";
  sourceId: string;
}

export interface CalendarDay {
  date: LocalDate;
  specialDay: { id: string; name: string } | null;
  holidays: HolidayFact[];
  tone: CalendarTone;
  /** No active department has hours on the date; a date Closed all day included. */
  closed: boolean;
}

/** The most dates one Hours read covers: a whole leap year. */
export const HOURS_RANGE_MAX_DAYS = 366;

/** The years a whole-year read can serve: `isLocalDate` reads years 0–99 as 1900–1999, and
 *  `rangeDates` cannot step past 9999-12-31. */
export const CALENDAR_YEAR_MIN = 100;
export const CALENDAR_YEAR_MAX = 9998;

/** The most dates one season-days read serves; the dashboard splits a longer list. */
export const SEASON_DAYS_MAX_DATES = 62;

/** The order a week is shown in, Monday first. It never relabels a stored weekday. */
export const WEEK_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export { serviceDayContext, type ServiceDayContext } from "./service-day-context.js";
