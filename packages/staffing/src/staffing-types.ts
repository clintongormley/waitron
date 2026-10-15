// Browser-safe and type-only: the dashboard reads its shapes from here, never from a server file.
import type { CalendarColour } from "@waitron/venue-service/hours-types";
import type { AreaRef, StaffingBlock } from "./slots.js";

export type { CalendarColour };

/** An active department or station by name. */
export interface StaffingArea {
  area: AreaRef;
  name: string;
}

export interface StaffRole {
  id: string;
  name: string;
  colour: CalendarColour;
  position: number;
  holderIds: string[];
}

/** A stretch of a department's opening hours, drawn behind the paint. */
export interface StaffingGuideRange {
  startsAt: string;
  endsAt: string;
}

/** A season's staffing for every active area; `weekdays` holds 0 (Sunday) to 6, empty when unpainted. */
export interface SeasonStaffing {
  /** The location's current changeover, `HH:MM`. */
  cutover: string;
  /** Every season at the location, by start. */
  seasons: { id: string; name: string; startsOn: string }[];
  areas: { area: AreaRef; name: string; weekdays: Record<number, StaffingBlock[]> }[];
  /** areaKey → weekday → a department's opening hours, drawn behind the paint; a station's are
   *  empty. */
  guides: Record<string, Record<number, StaffingGuideRange[]>>;
}

export interface SpecialDayStaffing {
  /** The location's current changeover, `HH:MM`. */
  cutover: string;
  name: string;
  /** areaKey → dateId → a department's opening hours that date; a station's, and a date closed
   *  all day, are empty. */
  guides: Record<string, Record<string, StaffingGuideRange[]>>;
  areas: {
    area: AreaRef;
    name: string;
    /** `blocks` null: the date follows the season. */
    dates: { dateId: string; date: string; blocks: StaffingBlock[] | null }[];
  }[];
}

export interface SeasonStaffingEdit {
  area: AreaRef;
  weekday: number;
  /** Times as `HH:MM`, as `parseBlocks` returns them. */
  blocks: readonly StaffingBlock[];
}

export interface SpecialDayStaffingEdit {
  area: AreaRef;
  dateId: string;
  /** Times as `HH:MM`, as `parseBlocks` returns them; null: the date follows the season. */
  blocks: readonly StaffingBlock[] | null;
}

export interface StaffingSeason {
  id: string;
  name: string;
  /** MM-DD. */
  startsOn: string;
  /** The MM-DD before the next season starts. */
  lastDay: string;
}

/** A staffing area's slots on one business day; `unfilled` is null until the rota counts it. */
export interface StaffingMonthArea {
  area: AreaRef;
  needed: number;
  unfilled: number | null;
}

/** The whole Monday-to-Sunday weeks covering `month`, as the opening-hours month lists them. */
export interface StaffingMonth {
  month: string;
  today: string | null;
  /** Every active area, in `listStaffingAreas` order, painted in the month or not. */
  areas: StaffingArea[];
  /** The seasons the listed days touch, in the order they are first touched. */
  seasons: StaffingSeason[];
  days: {
    date: string;
    inMonth: boolean;
    seasonId: string | null;
    specialDay: { id: string; name: string } | null;
    closedAllDay: boolean;
    /** Only areas with paint on the day, in `listStaffingAreas` order. */
    areas: StaffingMonthArea[];
  }[];
}
