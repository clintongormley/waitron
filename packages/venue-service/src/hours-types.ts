// Browser-safe: types and constants only, no database or server imports.

/** A real venue-local calendar date, `YYYY-MM-DD`. */
export type LocalDate = string;

/** One opening period on the wire, `HH:MM`. A close at or before the open runs past midnight. */
export interface HourPeriod {
  id: string;
  opensAt: string;
  closesAt: string;
}

/**
 * One weekday of a subject's standard week. `not_set` is a whole-week state (no hours stored at
 * all), never one day of a configured week.
 */
export type WeekCell =
  | { mode: "not_set" | "closed" | "all_day"; periods: [] }
  | { mode: "periods"; periods: HourPeriod[] };

/** One subject's hours on a special date. `inherit` stores nothing and reads the standard week. */
export type DateCell =
  | { mode: "inherit" | "closed" | "all_day"; periods: [] }
  | { mode: "periods"; periods: HourPeriod[] };

export interface HoursSubject {
  kind: "department" | "station";
  id: string;
}

/** `weekday` is JavaScript's numbering: Sunday 0, Monday 1. */
export interface WeekDay {
  weekday: number;
  cell: WeekCell;
}

export interface DateHoursCell {
  subject: HoursSubject;
  cell: DateCell;
}

export const CALENDAR_COLOURS = ["red", "amber", "grey", "blue", "green", "purple"] as const;
export type CalendarColour = (typeof CALENDAR_COLOURS)[number];

export interface SpecialDate {
  id: string;
  date: LocalDate;
  name: string;
  colour: CalendarColour;
  closeWholeVenue: boolean;
}

export type SpecialDateInput = Omit<SpecialDate, "id"> & { cells: DateHoursCell[] };

/** The order a week is shown in, Monday first. It never relabels a stored weekday. */
export const WEEK_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
