// Browser-safe: types and constants only, no database or server imports.

/** A real venue-local calendar date, `YYYY-MM-DD`. */
export type LocalDate = string;

export const CALENDAR_COLOURS = ["red", "amber", "grey", "blue", "green", "purple"] as const;
export type CalendarColour = (typeof CALENDAR_COLOURS)[number];

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
  /** The whole venue is closed all day, or no active department has hours. */
  closed: boolean;
}

/** The most dates one Hours read covers: a whole leap year. */
export const HOURS_RANGE_MAX_DAYS = 366;

/** The order a week is shown in, Monday first. It never relabels a stored weekday. */
export const WEEK_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export { serviceDayContext, type ServiceDayContext } from "./service-day-context.js";
