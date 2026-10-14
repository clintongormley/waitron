import type { HolidayFact, LocalDate } from "../hours-types.js";

export interface SpecialDayRef {
  id: string;
  name: string;
}

/** A request to open the special-day painter on `date`, or to delete the special day holding it. */
export interface SpecialDayAction {
  kind: "open" | "delete";
  date: LocalDate;
  /** Absent when the sender does not know; the host then looks the date up itself. */
  specialDay?: SpecialDayRef | null;
  holidays: readonly HolidayFact[];
  /** Every public holiday the sender shows, for the painter's note on dates added there. */
  visibleHolidays?: readonly HolidayFact[];
  returnTo: () => HTMLElement | null;
}
