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
  kind: "station";
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
