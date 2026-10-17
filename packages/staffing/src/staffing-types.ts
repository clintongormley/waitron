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

export interface ListedStaffRole extends StaffRole {
  /** Every holder's display name, whatever their status, in name order. */
  holderNames: string[];
}

/** A period's opening or sending range, drawn behind the staffing paint. */
export interface StaffingGuideRange {
  periodId: string;
  periodName: string;
  periodColour: CalendarColour;
  departmentId: string;
  departmentName: string;
  startsAt: string;
  endsAt: string;
}

/** A season's staffing for every active area; `weekdays` holds 0 (Sunday) to 6, empty when unpainted. */
export interface SeasonStaffing {
  /** The location's current changeover, `HH:MM`. */
  cutover: string;
  /** Every season at the location, by start. */
  seasons: { id: string; name: string; startsOn: string; colour: CalendarColour }[];
  areas: { area: AreaRef; name: string; weekdays: Record<number, StaffingBlock[]> }[];
  /** areaKey → weekday → opening ranges or station sending ranges. */
  guides: Record<string, Record<number, StaffingGuideRange[]>>;
}

export interface SpecialDayStaffing {
  /** The location's current changeover, `HH:MM`. */
  cutover: string;
  name: string;
  /** areaKey → dateId → opening ranges or station sending ranges. */
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
  colour: CalendarColour;
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

export interface RotaWeek {
  locationId: string;
  timeZone: string;
  week: string;
  version: { id: string; status: "draft" | "published"; changedSincePublished: boolean } | null;
  /** The seasons the week's days fall in, in the order the days first name them. */
  seasons: { id: string; name: string }[];
  days: {
    businessDay: string;
    cutover: string;
    /** Some active department has opening hours that business day. */
    hasHours: boolean;
    seasonId: string | null;
    specialDay: { id: string; name: string } | null;
    areas: { area: AreaRef; match: import("./slots.js").AreaDayMatch }[];
    notInSlot: { shiftId: string; outsideWeek: boolean }[];
  }[];
  shifts: import("./slots.js").PlacedShift[];
  openSwaps: { swapId: string; fromShiftId: string; toShiftId: string | null }[];
  people: {
    personId: string;
    name: string;
    staffRoleIds: string[];
    contractedMinutes: number | null;
    plannedMinutes: number;
  }[];
  absences: { personId: string; startsOn: string; endsOn: string }[];
  areas: { area: AreaRef; name: string; active: boolean }[];
  staffRoles: StaffRole[];
}

export interface RotaShiftInput {
  week: string;
  personId: string;
  businessDay: string;
  area: AreaRef;
  staffRoleId: string;
  startsAt: string;
  endsAt: string;
}
export type RotaShiftPatch = Partial<Omit<RotaShiftInput, "week" | "businessDay">>;
