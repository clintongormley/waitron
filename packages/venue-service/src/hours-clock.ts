import { civilDateOf, venueMomentAt } from "@waitron/reporting";
import type { LocalDate } from "./hours-types.js";

export interface VenueLocalMoment {
  readonly civilDate: LocalDate;
  readonly weekday: number;
  readonly timeOfDay: string;
  readonly businessDay: string;
}

/**
 * The venue's wall clock at `at`: its calendar date, which owns opening hours, and separately its
 * business day, which turns at the cutover and owns manual station overrides. `null` for a clock
 * that cannot be read.
 */
export function venueLocalMoment(
  at: Date,
  clock: { timeZone: string; dayCutover: string },
): VenueLocalMoment | null {
  const moment = venueMomentAt(at, clock);
  if (moment === null) return null;
  return { civilDate: civilDateOf(at, clock.timeZone), ...moment };
}
