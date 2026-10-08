import { addDays, weekdayOf } from "./hours-rules.js";
import { rangeSpan, type ServiceRange } from "./service-day.js";
import { AppError } from "@waitron/shared";
import "./errors.js";

export function parseEndOffsetMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new AppError("menu_period.invalid", {
      field: "endOffsetMinutes",
      reason: "whole_minutes",
    });
  if (value < -1439 || value > 1439)
    throw new AppError("menu_period.invalid", { field: "endOffsetMinutes", reason: "range" });
  return value;
}

export function periodOrderCutoff(range: ServiceRange, offset: number, cutover: string): number {
  return rangeSpan(range, cutover).end + offset;
}

export function findEndOffsetClash(
  days: readonly (readonly ServiceRange[])[],
  offsets: ReadonlyMap<string, number>,
  cutover: string,
): { periodId: string; dayIndex: number; slotIndex: number } | null {
  const placements = days
    .flatMap((slots, dayIndex) =>
      slots.map((slot, slotIndex) => {
        const span = rangeSpan(slot, cutover);
        return {
          periodId: slot.periodId,
          dayIndex,
          slotIndex,
          start: dayIndex * 1440 + span.start,
          end: dayIndex * 1440 + span.end,
        };
      }),
    )
    .sort((a, b) => a.start - b.start);
  for (const [index, placement] of placements.entries()) {
    const offset = offsets.get(placement.periodId) ?? 0;
    const cutoff = placement.end + offset;
    const next = placements[index + 1];
    if (cutoff <= placement.start || (offset > 0 && next !== undefined && cutoff >= next.start))
      return {
        periodId: placement.periodId,
        dayIndex: placement.dayIndex,
        slotIndex: placement.slotIndex,
      };
  }
  return null;
}

export interface OffsetScheduleDay {
  weekday: number | null;
  date: string | null;
  slots: readonly ServiceRange[];
}

export function findScheduleEndOffsetClash(
  days: readonly OffsetScheduleDay[],
  dates: readonly { date: string; closeWholeVenue: boolean }[],
  offsets: ReadonlyMap<string, number>,
  cutover: string,
): { periodId: string; slotIndex: number; weekday?: number; date?: string } | null {
  const week = Array.from(
    { length: 7 },
    (_, weekday) => days.find((day) => day.weekday === weekday)?.slots ?? [],
  );
  for (let weekday = 0; weekday < 7; weekday++) {
    const clash = findEndOffsetClash([week[weekday]!, week[(weekday + 1) % 7]!], offsets, cutover);
    if (clash !== null)
      return {
        periodId: clash.periodId,
        slotIndex: clash.slotIndex,
        weekday: (weekday + clash.dayIndex) % 7,
      };
  }
  const special = new Map(dates.map((date) => [date.date, date]));
  const overrides = new Map(
    days.filter((day) => day.date !== null).map((day) => [day.date!, day.slots]),
  );
  const effective = (date: string): readonly ServiceRange[] =>
    special.get(date)?.closeWholeVenue === true
      ? []
      : (overrides.get(date) ?? week[weekdayOf(date)]!);
  // Less than one day's grace can meet only a placement on this or the next business day.
  const boundaries = new Set(dates.flatMap(({ date }) => [addDays(date, -1), date]));
  for (const date of [...boundaries].sort()) {
    const clash = findEndOffsetClash(
      [effective(date), effective(addDays(date, 1))],
      offsets,
      cutover,
    );
    if (clash !== null)
      return {
        periodId: clash.periodId,
        slotIndex: clash.slotIndex,
        date: addDays(date, clash.dayIndex),
      };
  }
  return null;
}
