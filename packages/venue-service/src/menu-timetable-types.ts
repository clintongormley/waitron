// Browser-safe: types only, no database or server imports.
import type { ServiceRange } from "./service-day.js";
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
  | { kind: "special_date"; specialDateId: string; date: LocalDate };

export interface DepartmentService {
  departmentId: string;
  open: boolean;
  periodId: string | null;
  periodName: string | null;
  customerMenuId: string | null;
  orderableMenuIds: readonly string[];
  endedMenuIds: readonly string[];
}

export interface OpeningHoursModel {
  timeZone: string;
  clockReadable: boolean;
  dayCutover: string;
  menus: readonly { id: string; name: string; active: boolean; includes: readonly string[] }[];
  specialDates: readonly {
    id: string;
    date: string;
    name: string;
    colour: CalendarColour;
    closeWholeVenue: boolean;
  }[];
  departments: readonly {
    id: string;
    name: string;
    active: boolean;
    periods: readonly {
      id: string;
      name: string;
      colour: CalendarColour;
      menuId: string;
      staffMenuIds: readonly string[];
      endOffsetMinutes: number;
      weekdays: readonly number[];
    }[];
    week: readonly { weekday: number; slots: readonly ServiceRange[] }[];
    dates: readonly { specialDateId: string; slots: readonly ServiceRange[] }[];
  }[];
}
