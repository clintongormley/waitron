import { layerPaint, type PaintRange } from "./day-paint.js";
import { addDays, weekdayOf } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";
import { seasonOnSorted } from "./season-rules.js";
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

export interface SeasonSchedule {
  seasonId: string;
  startsOn: string;
  /** Index = weekday. */
  week: readonly (readonly ServiceRange[])[];
}

/** A named day; `slots` null when it keeps its season's hours. A special-day date instead carries
 *  `paint`, laid over its season's day, and `closeWholeVenue` for its Closed-all-day tick. */
export interface DatedSchedule {
  date: LocalDate;
  closeWholeVenue: boolean;
  repeatOn?: string | null;
  ownHours?: boolean;
  slots: readonly ServiceRange[] | null;
  paint?: readonly PaintRange[];
  specialDayId?: string;
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
  specialDayId?: string;
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
  const seasonOf = (date: LocalDate) => seasonOnSorted(ordered, date);
  const seasonal = (date: LocalDate): readonly ServiceRange[] => {
    const season = seasonOf(date);
    return season === null ? [] : weekOf(season, weekdayOf(date));
  };
  // The first entry in `dated` that holds a date: on that date, or repeating from on or before it.
  const firstOnDate = new Map<LocalDate, number>();
  const repeatsOn = new Map<string, number[]>();
  dated.forEach((entry, index) => {
    if (!firstOnDate.has(entry.date)) firstOnDate.set(entry.date, index);
    if (entry.repeatOn != null)
      repeatsOn.set(entry.repeatOn, [...(repeatsOn.get(entry.repeatOn) ?? []), index]);
  });
  const storedIndex = (date: LocalDate): number => {
    const repeat = repeatsOn.get(date.slice(5))?.find((index) => dated[index]!.date <= date);
    return Math.min(firstOnDate.get(date) ?? Infinity, repeat ?? Infinity);
  };
  const storedOn = (date: LocalDate): DatedSchedule | undefined => dated[storedIndex(date)];
  // A repeating date falls on up to 400 years of dates but only (season, weekday) varies its day.
  const layered = new Map<string, readonly ServiceRange[]>();
  const effective = (date: LocalDate, cutover: string): readonly ServiceRange[] => {
    const index = storedIndex(date);
    const stored = dated[index];
    if (stored?.paint !== undefined) {
      if (stored.closeWholeVenue) return [];
      const key = `${index}|${seasonOf(date)?.seasonId}|${weekdayOf(date)}|${cutover}`;
      const day = layered.get(key) ?? layerPaint(seasonal(date), stored.paint, cutover);
      layered.set(key, day);
      return day;
    }
    if (special.get(date)?.closeWholeVenue === true) return [];
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
      [effective(date, contexts[0]!), effective(next, contexts[1]!)],
      offsets,
      contexts[0]!,
      contexts,
    );
    if (clash !== null) {
      const clashDate = addDays(date, clash.dayIndex);
      const specialDayId =
        storedOn(clashDate)?.specialDayId ??
        storedOn(clashDate === date ? next : date)?.specialDayId;
      return {
        periodId: clash.periodId,
        slotIndex: clash.slotIndex,
        date: clashDate,
        ...(specialDayId === undefined ? {} : { specialDayId }),
      };
    }
  }
  return null;
}
