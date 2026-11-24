import { AppError, isUuid } from "@waitron/shared";
import type { LastOrderAdjustment, MenuSlot } from "./menu-timetable-types.js";
import "./errors.js";

export function invalidTimetable(
  field: string,
  refusal?: { reason: "overlap" | "clock_skips" | "empty" | "order" | "step" },
): never {
  throw new AppError("menu_timetable.invalid", { field, ...refusal });
}

export interface ParsedMenuWeek<T extends MenuSlot> {
  slots: T[][];
  indexOf: number[];
}

export function parseMenuWeek<T extends MenuSlot>(
  value: unknown,
  parseDay: (value: unknown, field: string) => T[],
): ParsedMenuWeek<T> {
  if (!Array.isArray(value) || value.length !== 7) invalidTimetable("days");
  const slots: T[][] = [];
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

export const LAST_ORDER_MINUTES: readonly number[] = [
  -60, -45, -30, -15, 0, 15, 30, 45, 60, 90, 120,
];

export function invalidLastOrders(): never {
  throw new AppError("menu_period.invalid", { field: "lastOrders" });
}

export function parseLastOrders(value: unknown): LastOrderAdjustment[] {
  if (!Array.isArray(value)) invalidLastOrders();
  const targets = new Set<string>();
  return value.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) invalidLastOrders();
    const { kind, stationId, minutes, ...other } = entry as Record<string, unknown>;
    if (
      Object.keys(other).length ||
      typeof minutes !== "number" ||
      !LAST_ORDER_MINUTES.includes(minutes)
    )
      invalidLastOrders();
    if (kind === "no_preparation" && !Object.hasOwn(entry, "stationId")) {
      if (targets.has(kind)) invalidLastOrders();
      targets.add(kind);
      return { kind, minutes };
    }
    if (kind !== "station" || typeof stationId !== "string" || !isUuid(stationId))
      invalidLastOrders();
    const id = stationId.toLowerCase();
    if (targets.has(id)) invalidLastOrders();
    targets.add(id);
    return { kind, stationId: id, minutes };
  });
}
