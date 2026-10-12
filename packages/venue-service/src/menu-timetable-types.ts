import type { BusinessDayScheduleStatus } from "./service-day-context.js";
// Browser-safe: types only, no database or server imports.
import type { ClosedRange, ServiceRange } from "./service-day.js";
import type { CalendarColour, LocalDate } from "./hours-types.js";

export interface MenuPeriodInput {
  name: string;
  colour?: CalendarColour;
  menuId: string;
  staffMenuIds: readonly string[];
  endOffsetMinutes?: number;
}

export interface MenuSlot {
  periodId: string;
  startsAt: string;
  endsAt: string;
}

export interface MenuWeekDay {
  weekday: number;
  slots: MenuSlot[];
}

export type MenuPeriodUse =
  | { kind: "week"; weekday: number }
  | { kind: "special_day"; specialDayId: string; name: string; date: LocalDate };

export interface DepartmentService {
  departmentId: string;
  open: boolean;
  periodId: string | null;
  periodName: string | null;
  customerMenuId: string | null;
  orderableMenuIds: readonly string[];
  sendableMenuIds: readonly string[];
  endedMenuIds: readonly string[];
  readonly keepOpen: {
    periodId: string;
    periodName: string;
    endsAt: string;
    running: boolean;
    extendedUntil: string | null;
  } | null;
}

/** A routing cell with a line for a period; `zoneName: null` is Every zone. */
export type PeriodRoutingUse = (
  | { rowKind: "all" | "no_category"; rowLabel: null }
  | { rowKind: "category" | "product"; rowLabel: string }
) & { zoneName: string | null };

export interface OpeningHoursModel extends BusinessDayScheduleStatus {
  timeZone: string;
  clockReadable: boolean;
  dayCutover: string;
  menus: readonly { id: string; name: string; active: boolean; includes: readonly string[] }[];
  /** Ordered by `startsOn`. */
  seasons: readonly { id: string; name: string; startsOn: string }[];
  /** The season of the business day `at` falls in; null when the clock cannot be read or the venue has no seasons. */
  currentSeasonId: string | null;
  departments: readonly {
    id: string;
    name: string;
    active: boolean;
    zones: readonly {
      id: string;
      name: string;
      /** One entry per season, in `seasons` order; a season never written is an empty week. */
      seasonWeeks: readonly {
        seasonId: string;
        week: readonly { weekday: number; ranges: readonly ClosedRange[] }[];
      }[];
    }[];
    periods: readonly {
      id: string;
      name: string;
      colour: CalendarColour;
      menuId: string;
      staffMenuIds: readonly string[];
      endOffsetMinutes: number;
      /** The weekdays the period is painted on in any season. */
      weekdays: readonly number[];
      routingUses: readonly PeriodRoutingUse[];
    }[];
    /** One entry per season, in `seasons` order; a season never written is an empty week. */
    seasonWeeks: readonly {
      seasonId: string;
      week: readonly { weekday: number; slots: readonly ServiceRange[] }[];
    }[];
  }[];
}
