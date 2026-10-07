// Browser-safe: types only, no database or server imports.
import type { LocalDate } from "./hours-types.js";

/** A department's named period, such as "Mañanas", and the menu its zones start on in it. */
export interface MenuPeriod {
  id: string;
  name: string;
  menuId: string;
}

/** One placement of a named period on a day, wall-clock `HH:MM`. An end at or before the start
 * runs past midnight and belongs to the day it starts. */
export interface MenuSlot {
  periodId: string;
  startsAt: string;
  endsAt: string;
}

/** `weekday` is JavaScript's numbering: Sunday 0, Monday 1. */
export interface MenuWeekDay {
  weekday: number;
  slots: MenuSlot[];
}

/** Where a named period is placed. */
export type MenuPeriodUse =
  | { kind: "week"; weekday: number }
  | { kind: "special_date"; specialDateId: string; date: LocalDate };

export interface ZoneMenuChoice {
  departmentId: string;
  /** Active member menus in department order; publication not checked here. */
  availableMenuIds: string[];
  /** In a slot: the zone's override of its named period, else the period's menu. In a gap: the
   *  zone's all-day, else the department's. Null when none is set. Before the publication fallback. */
  defaultMenuId: string | null;
  /** The named period in force; null in a gap or when the clock cannot be read. */
  periodId: string | null;
}

export interface MenuTimetableZone {
  id: string;
  name: string;
  active: boolean;
  /** The zone's own all-day menu; null inherits the department's. */
  allDayMenuId: string | null;
  periodMenus: { periodId: string; menuId: string }[];
}

export interface MenuTimetableDepartment {
  id: string;
  name: string;
  active: boolean;
  menuIds: string[];
  allDayMenuId: string | null;
  /** By name; each with every day that places it, past special dates included. */
  periods: (MenuPeriod & { uses: MenuPeriodUse[] })[];
  /** Seven days, Sunday first. */
  week: MenuWeekDay[];
  zones: MenuTimetableZone[];
}

export interface MenuTimetableSpecialDate {
  id: string;
  date: LocalDate;
  name: string;
  /** The departments with a timetable of their own that date; any other follows its week. */
  timetables: { departmentId: string; slots: MenuSlot[] }[];
}

export interface MenuTimetableModel {
  /** Every menu, to name the ones the departments list; a venue viewer cannot read the menus. */
  menus: { id: string; name: string; active: boolean }[];
  timeZone: string;
  clockReadable: boolean;
  /** The venue's date now; null when its clock cannot be read. */
  civilDate: LocalDate | null;
  /** Inactive departments included. */
  departments: MenuTimetableDepartment[];
  /**
   * Every special date from the venue's yesterday onward (every one while the clock cannot be
   * read), and every earlier one holding a menu timetable, in date order.
   */
  specialDates: MenuTimetableSpecialDate[];
}
