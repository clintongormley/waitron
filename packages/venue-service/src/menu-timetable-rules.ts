// Browser-safe structural rules for menu timetables, built on the Hours rules in `./hours-rules.ts`.
import { AppError, isUuid } from "@waitron/shared";
import {
  addDays,
  cellIntervals,
  effective,
  pairMatters,
  tailOverlaps,
  type DateState,
  type Interval,
} from "./hours-rules.js";
import type { HourPeriod, LocalDate } from "./hours-types.js";
import type { MenuSlot } from "./menu-timetable-types.js";
import "./errors.js";

const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const KEY = "menu";

export function invalidTimetable(
  field: string,
  clash?: {
    date?: LocalDate;
    departmentId?: string;
    reason: "overlap" | "clock_skips" | "empty" | "order" | "step";
  },
): never {
  throw new AppError("menu_timetable.invalid", { field, ...clash });
}

/** The slots as an Hours periods cell, so the Hours interval and clock rules read them. */
export function slotCell(slots: readonly MenuSlot[]): {
  mode: "periods";
  periods: HourPeriod[];
} {
  return {
    mode: "periods",
    periods: slots.map((slot) => ({
      id: slot.periodId,
      opensAt: slot.startsAt,
      closesAt: slot.endsAt,
    })),
  };
}

/** Each slot on its own day's timeline; one past midnight ends after 1440. */
export function slotIntervals(slots: readonly MenuSlot[]): Interval[] {
  return cellIntervals(slotCell(slots))!;
}

/** One day's slots: real times, an end differing from the start, and no two overlapping. */
export function parseSlots(value: unknown, field: string): MenuSlot[] {
  if (!Array.isArray(value)) invalidTimetable(field);
  const slots = value.map((entry: unknown, index): MenuSlot => {
    const at = `${field}.${index}`;
    if (typeof entry !== "object" || entry === null) invalidTimetable(at);
    const { periodId, startsAt, endsAt } = entry as Record<string, unknown>;
    if (typeof periodId !== "string" || !isUuid(periodId)) invalidTimetable(`${at}.periodId`);
    if (typeof startsAt !== "string" || !CLOCK_TIME.test(startsAt))
      invalidTimetable(`${at}.startsAt`);
    if (typeof endsAt !== "string" || !CLOCK_TIME.test(endsAt) || endsAt === startsAt)
      invalidTimetable(`${at}.endsAt`);
    return { periodId: periodId.toLowerCase(), startsAt, endsAt };
  });
  const intervals = slotIntervals(slots);
  intervals.forEach((interval, index) => {
    if (intervals.slice(0, index).some((o) => interval.start < o.end && o.start < interval.end))
      invalidTimetable(`${field}.${index}`);
  });
  return slots;
}

export interface ParsedMenuWeek {
  /** Indexed by weekday, Sunday first. */
  slots: MenuSlot[][];
  /** The request's index of each weekday, for naming the refused field. */
  indexOf: number[];
}

/**
 * A whole menu week: one entry per weekday, no two slots overlapping on one day or across a
 * midnight, Sunday into Monday included.
 */
export function parseMenuWeek(
  value: unknown,
  parseDay?: (value: unknown, field: string) => MenuSlot[],
): ParsedMenuWeek {
  if (!Array.isArray(value) || value.length !== 7) invalidTimetable("days");
  const slots: MenuSlot[][] = [];
  const indexOf: number[] = [];
  value.forEach((entry: unknown, index) => {
    if (typeof entry !== "object" || entry === null) invalidTimetable(`days.${index}`);
    const day = entry as Record<string, unknown>;
    const weekday = day.weekday;
    if (
      typeof weekday !== "number" ||
      !Number.isInteger(weekday) ||
      weekday < 0 ||
      weekday > 6 ||
      indexOf[weekday] !== undefined
    )
      invalidTimetable(`days.${index}.weekday`);
    slots[weekday] = (parseDay ?? parseSlots)(day.slots, `days.${index}.slots`);
    indexOf[weekday] = index;
  });
  for (let weekday = 0; parseDay === undefined && weekday < 7; weekday++)
    if (tailOverlaps(slotIntervals(slots[(weekday + 6) % 7]!), slotIntervals(slots[weekday]!)))
      invalidTimetable(`days.${indexOf[weekday]}.slots`);
  return { slots, indexOf };
}

/** A named period's name, trimmed; a blank one is refused. */
export function menuPeriodName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") invalidTimetable("name");
  return value.trim();
}

/**
 * The slot in force at wall time `time`: one of today's that has started and not ended (or runs
 * past midnight), else one of yesterday's running past midnight that has not ended. Today's wins
 * when both match, which only data a writer refused can produce.
 */
export function slotInForce<S extends MenuSlot>(
  today: readonly S[],
  yesterday: readonly S[],
  time: string,
): S | null {
  const overnight = (slot: MenuSlot) => slot.endsAt <= slot.startsAt;
  return (
    today.find((slot) => slot.startsAt <= time && (time < slot.endsAt || overnight(slot))) ??
    yesterday.find((slot) => overnight(slot) && time < slot.endsAt) ??
    null
  );
}

/**
 * The first pair of neighbouring dates, one of them a `touched` date, on which one department's
 * menu slots overlap across a midnight: the touched date and the other date of the pair. `dates`
 * holds the department's special-date timetables; any other date follows `week` (by weekday,
 * Sunday first). Pairs already past at `today` are left out, and with `involvingWeek` so is a pair
 * of two special dates. A whole-venue closure plays no part: menus are offered on a closed date too.
 */
export function firstMenuClash(
  dates: ReadonlyMap<LocalDate, Interval[]>,
  week: readonly Interval[][],
  touched: readonly LocalDate[],
  today: LocalDate | null,
  involvingWeek = false,
): { date: LocalDate; other: LocalDate } | null {
  const states = new Map<LocalDate, DateState>(
    [...dates].map(([date, intervals]) => [
      date,
      { closeWholeVenue: false, cells: new Map([[KEY, intervals]]) },
    ]),
  );
  const weekOf = (weekday: number) => week[weekday]!;
  for (const date of touched)
    for (const earlier of [addDays(date, -1), date]) {
      if (!pairMatters(earlier, today)) continue;
      const later = addDays(earlier, 1);
      const before = effective(earlier, KEY, states, weekOf);
      const after = effective(later, KEY, states, weekOf);
      if (involvingWeek && !before.fromWeek && !after.fromWeek) continue;
      if (tailOverlaps(before.intervals, after.intervals))
        return { date, other: earlier === date ? later : earlier };
    }
  return null;
}
