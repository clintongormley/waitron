// Browser-safe and type-only: the dashboard reads its shapes from here, never from a server file.
import type { CalendarColour } from "@waitron/venue-service/hours-types";
import type { AreaRef, StaffingBlock } from "./slots.js";

export type { CalendarColour };

export interface StaffRole {
  id: string;
  name: string;
  colour: CalendarColour;
  position: number;
  holderIds: string[];
}

/** A season's staffing for every active area; `weekdays` holds 0 (Sunday) to 6, empty when unpainted. */
export interface SeasonStaffing {
  areas: { area: AreaRef; name: string; weekdays: Record<number, StaffingBlock[]> }[];
  /** areaKey → weekday → a department's opening hours, drawn behind the paint; a station's are
   *  empty. */
  guides: Record<string, Record<number, { startsAt: string; endsAt: string }[]>>;
}

export interface SpecialDayStaffing {
  areas: {
    area: AreaRef;
    name: string;
    /** `blocks` null: the date follows the season. */
    dates: { dateId: string; date: string; blocks: StaffingBlock[] | null }[];
  }[];
}
