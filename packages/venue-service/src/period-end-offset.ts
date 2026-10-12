import { addDays, weekdayOf } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";
import { seasonOn } from "./season-rules.js";
import { rangeSpan, type ServiceRange } from "./service-day.js";
import { scheduleCutovers, serviceDayWallContext } from "./service-day-context.js";
import type { BusinessDayClock } from "@waitron/shared";
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

const wallMinutes = (time: string): number =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function findEndOffsetClash(
  days: readonly (readonly ServiceRange[])[],
  offsets: ReadonlyMap<string, number>,
  cutover: string,
  dayCutovers: readonly string[] = days.map(() => cutover),
): { periodId: string; dayIndex: number; slotIndex: number } | null {
  const placements = days
    .flatMap((slots, dayIndex) =>
      slots.map((slot, slotIndex) => {
        const span = rangeSpan(slot, dayCutovers[dayIndex]!);
        const origin = dayIndex * 1440 + wallMinutes(dayCutovers[dayIndex]!) - wallMinutes(cutover);
        return {
          periodId: slot.periodId,
          dayIndex,
          slotIndex,
          start: origin + span.start,
          end: origin + span.end,
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
  dates: readonly {
    date: string;
    closeWholeVenue: boolean;
    repeatOn?: string | null;
    ownHours?: boolean;
  }[],
  offsets: ReadonlyMap<string, number>,
  clock: string | BusinessDayClock,
): { periodId: string; slotIndex: number; weekday?: number; date?: string } | null {
  const week = Array.from(
    { length: 7 },
    (_, weekday) => days.find((day) => day.weekday === weekday)?.slots ?? [],
  );
  const cutovers = typeof clock === "string" ? [clock] : scheduleCutovers(clock);
  for (const cutover of cutovers)
    for (let weekday = 0; weekday < 7; weekday++) {
      const clash = findEndOffsetClash(
        [week[weekday]!, week[(weekday + 1) % 7]!],
        offsets,
        cutover,
      );
      if (clash !== null)
        return {
          periodId: clash.periodId,
          slotIndex: clash.slotIndex,
          weekday: (weekday + clash.dayIndex) % 7,
        };
    }
  const years = new Set(dates.map(({ date }) => Number(date.slice(0, 4))));
  if (typeof clock !== "string")
    for (const change of clock.cutoverChanges)
      years.add(Number(change.effectiveBusinessDay.slice(0, 4)));
  for (const day of dates) {
    if (day.repeatOn == null) continue;
    const firstYear = Number(day.date.slice(0, 4));
    for (let year = firstYear; year < Math.min(firstYear + 400, 10000); year++) years.add(year);
    if (typeof clock !== "string")
      for (const change of clock.cutoverChanges) {
        const start = Math.max(firstYear, Number(change.effectiveBusinessDay.slice(0, 4)));
        for (let year = start; year < Math.min(start + 400, 10000); year++) years.add(year);
      }
  }
  const occurrences = dates.flatMap((day) =>
    day.repeatOn == null
      ? [day]
      : [...years].flatMap((year) => {
          const date = `${String(year).padStart(4, "0")}-${day.repeatOn}`;
          return date >= day.date &&
            new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
            ? [{ ...day, date }]
            : [];
        }),
  );
  const special = new Map(occurrences.map((day) => [day.date, day]));
  const overrides = new Map(
    days.filter((day) => day.date !== null).map((day) => [day.date!, day.slots]),
  );
  const effective = (date: string): readonly ServiceRange[] => {
    const day = special.get(date);
    if (day?.closeWholeVenue === true) return [];
    const stored = dates.find(
      (entry) =>
        entry.date === date ||
        (entry.repeatOn != null && entry.repeatOn === date.slice(5) && entry.date <= date),
    );
    return day?.ownHours === false
      ? week[weekdayOf(date)]!
      : (overrides.get(stored?.date ?? date) ?? week[weekdayOf(date)]!);
  };
  // Less than one day's grace can meet only a placement on this or the next business day.
  const boundaries = new Set(occurrences.flatMap(({ date }) => [addDays(date, -1), date]));
  if (typeof clock !== "string")
    for (const change of clock.cutoverChanges) {
      boundaries.add(addDays(change.effectiveBusinessDay, -1));
      boundaries.add(change.effectiveBusinessDay);
    }
  for (const date of [...boundaries].sort()) {
    const next = addDays(date, 1);
    const contexts =
      typeof clock === "string"
        ? [clock, clock]
        : [date, next].map((day) => serviceDayWallContext(clock, day).dayCutover);
    const clash = findEndOffsetClash(
      [effective(date), effective(next)],
      offsets,
      contexts[0]!,
      contexts,
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

export interface SeasonSchedule {
  seasonId: string;
  startsOn: string;
  /** Index = weekday. */
  week: readonly (readonly ServiceRange[])[];
}

/** A named day; `slots` null when it keeps its season's hours. */
export interface DatedSchedule {
  date: LocalDate;
  closeWholeVenue: boolean;
  repeatOn?: string | null;
  ownHours?: boolean;
  slots: readonly ServiceRange[] | null;
}

export function findSeasonEndOffsetClash(
  seasons: readonly SeasonSchedule[],
  dated: readonly DatedSchedule[],
  offsets: ReadonlyMap<string, number>,
  clock: string | BusinessDayClock,
): {
  periodId: string;
  slotIndex: number;
  seasonId?: string;
  weekday?: number;
  date?: LocalDate;
} | null {
  const ordered = [...seasons].sort((a, b) =>
    a.startsOn < b.startsOn ? -1 : Number(a.startsOn > b.startsOn),
  );
  const weekOf = (season: SeasonSchedule, weekday: number) => season.week[weekday] ?? [];
  // Each season with itself, then each season's last day with the next season's first.
  const pairs = ordered.map((season) => [season, season] as const);
  if (ordered.length > 1)
    pairs.push(
      ...ordered.map((season, index) => [season, ordered[(index + 1) % ordered.length]!] as const),
    );
  const cutovers = typeof clock === "string" ? [clock] : scheduleCutovers(clock);
  for (const [first, second] of pairs)
    for (const cutover of cutovers)
      for (let weekday = 0; weekday < 7; weekday++) {
        const clash = findEndOffsetClash(
          [weekOf(first, weekday), weekOf(second, (weekday + 1) % 7)],
          offsets,
          cutover,
        );
        if (clash !== null)
          return {
            periodId: clash.periodId,
            slotIndex: clash.slotIndex,
            seasonId: (clash.dayIndex === 0 ? first : second).seasonId,
            weekday: (weekday + clash.dayIndex) % 7,
          };
      }
  const years = new Set(dated.map(({ date }) => Number(date.slice(0, 4))));
  if (typeof clock !== "string")
    for (const change of clock.cutoverChanges)
      years.add(Number(change.effectiveBusinessDay.slice(0, 4)));
  for (const day of dated) {
    if (day.repeatOn == null) continue;
    const firstYear = Number(day.date.slice(0, 4));
    for (let year = firstYear; year < Math.min(firstYear + 400, 10000); year++) years.add(year);
    if (typeof clock !== "string")
      for (const change of clock.cutoverChanges) {
        const start = Math.max(firstYear, Number(change.effectiveBusinessDay.slice(0, 4)));
        for (let year = start; year < Math.min(start + 400, 10000); year++) years.add(year);
      }
  }
  const occurrences = dated.flatMap((day) =>
    day.repeatOn == null
      ? [day]
      : [...years].flatMap((year) => {
          const date = `${String(year).padStart(4, "0")}-${day.repeatOn}`;
          return date >= day.date &&
            new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
            ? [{ ...day, date }]
            : [];
        }),
  );
  const special = new Map(occurrences.map((day) => [day.date, day]));
  const seasonal = (date: LocalDate): readonly ServiceRange[] => {
    const season = seasonOn(ordered, date);
    return season === null ? [] : weekOf(season, weekdayOf(date));
  };
  const effective = (date: LocalDate): readonly ServiceRange[] => {
    if (special.get(date)?.closeWholeVenue === true) return [];
    const stored = dated.find(
      (entry) =>
        entry.date === date ||
        (entry.repeatOn != null && entry.repeatOn === date.slice(5) && entry.date <= date),
    );
    return stored === undefined || stored.ownHours === false
      ? seasonal(date)
      : (stored.slots ?? seasonal(date));
  };
  // Less than one day's grace can meet only a placement on this or the next business day.
  const boundaries = new Set(occurrences.flatMap(({ date }) => [addDays(date, -1), date]));
  if (typeof clock !== "string")
    for (const change of clock.cutoverChanges) {
      boundaries.add(addDays(change.effectiveBusinessDay, -1));
      boundaries.add(change.effectiveBusinessDay);
    }
  for (const date of [...boundaries].sort()) {
    const next = addDays(date, 1);
    const contexts =
      typeof clock === "string"
        ? [clock, clock]
        : [date, next].map((day) => serviceDayWallContext(clock, day).dayCutover);
    const clash = findEndOffsetClash(
      [effective(date), effective(next)],
      offsets,
      contexts[0]!,
      contexts,
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
