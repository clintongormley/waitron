import { AppError } from "@waitron/shared";
import type { LocalDate } from "./hours-types.js";
import type { MenuSlot } from "./menu-timetable-types.js";
import "./errors.js";

export function invalidTimetable(
  field: string,
  clash?: {
    date?: LocalDate;
    departmentId?: string;
    periodId?: string;
    reason: "overlap" | "clock_skips" | "empty" | "order" | "step" | "end_offset";
  },
): never {
  throw new AppError("menu_timetable.invalid", { field, ...clash });
}

export interface ParsedMenuWeek {
  slots: MenuSlot[][];
  indexOf: number[];
}

export function parseMenuWeek(
  value: unknown,
  parseDay: (value: unknown, field: string) => MenuSlot[],
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
    slots[weekday] = parseDay(day.slots, `days.${index}.slots`);
    indexOf[weekday] = index;
  });
  return { slots, indexOf };
}

export function menuPeriodName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") invalidTimetable("name");
  return value.trim();
}
