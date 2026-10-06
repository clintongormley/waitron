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

/**
 * One subject's hours on one opening date and where they came from. `specialDateId` names the
 * date's special date whenever it has one, even where the subject inherits its standard week.
 */
export interface ResolvedHours {
  subject: HoursSubject;
  openingDate: LocalDate;
  specialDateId: string | null;
  source: "standard" | "special" | "whole_venue" | "default_station";
  cell: WeekCell | { mode: "always_open"; periods: [] };
}

/** How the calendar colours a date: a special date's own colour, or one of the two reserved. */
export type CalendarTone = CalendarColour | "standard" | "closed";

/** A public holiday fact for a date. Step 5 supplies none; a later holiday provider fills them. */
export interface HolidayFact {
  id: string;
  date: LocalDate;
  name: string;
  scope: "national" | "regional" | "local";
  sourceId: string;
}

export interface CalendarDay {
  date: LocalDate;
  specialDate: SpecialDate | null;
  holidays: HolidayFact[];
  tone: CalendarTone;
}

export interface HoursModelSubject extends HoursSubject {
  name: string;
  active: boolean;
  isDefault: boolean;
}

/** Everything the Hours page shows for one range of dates, read in one request. */
export interface HoursModel {
  timeZone: string;
  dayCutover: string;
  /** The venue's date now; null when its clock cannot be read. */
  civilDate: LocalDate | null;
  clockReadable: boolean;
  /** Departments first, then stations, inactive ones included. */
  subjects: HoursModelSubject[];
  /** Each subject's standard week, Sunday first, in `subjects` order. */
  week: { subject: HoursSubject; days: WeekDay[] }[];
  /** Every date of the range, in order. */
  days: CalendarDay[];
  /** The stored cells of each special date in the range; a subject with no cell inherits. */
  specialCells: { specialDateId: string; cells: DateHoursCell[] }[];
}

/** The most dates one Hours read covers: a whole leap year. */
export const HOURS_RANGE_MAX_DAYS = 366;

/** The order a week is shown in, Monday first. It never relabels a stored weekday. */
export const WEEK_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
