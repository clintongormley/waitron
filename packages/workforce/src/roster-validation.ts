import type { WorkTimeRuleset } from "./ruleset.js";

/**
 * Every threshold comes from the caller's `WorkTimeRuleset`; none is hard-coded here.
 *
 * Owner decision, 2026-08-02: breaches are advisory. The engine never throws, `publishRoster`
 * publishes a breaching roster anyway, and so the breach kinds are not registered error codes.
 */

/** `startsAt`/`endsAt` are absolute instants; each offset shifts its instant to local wall time. */
export interface PlannedShift {
  shiftId: string;
  personId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
}

export type RosterBreachKind =
  | "rest_too_short"
  | "exceeds_daily_max"
  | "exceeds_weekly_max"
  | "overtime_cap_exceeded"
  | "weekly_rest_insufficient"
  | "break_owed"
  | "night_work";

/** Rest is measured between working days (art. 34.3), not between the same-day segments of a split
 * shift. `previousShiftId` ends the earlier working day; `shiftId` opens the next. */
export interface RestTooShortBreach {
  kind: "rest_too_short";
  personId: string;
  previousShiftId: string;
  shiftId: string;
  restMinutes: number;
  requiredMinutes: number;
}

export interface ExceedsDailyMaxBreach {
  kind: "exceeds_daily_max";
  personId: string;
  workDate: string;
  plannedMinutes: number;
  maxMinutes: number;
}

/** Art. 34.1's cap is an annual average; a per-calendar-week sum is the chosen guardrail reading.
 * `weekStart` is the local Monday's date. */
export interface ExceedsWeeklyMaxBreach {
  kind: "exceeds_weekly_max";
  personId: string;
  weekStart: string;
  plannedMinutes: number;
  maxMinutes: number;
}

/** Summed over every shift supplied, so the caller sets the horizon by choosing which shifts to pass
 * (a year's, to check the annual cap). */
export interface OvertimeCapExceededBreach {
  kind: "overtime_cap_exceeded";
  personId: string;
  overtimeMinutes: number;
  capMinutes: number;
}

/** Only a person's middle weeks are judged: the first and last are excused by the unbounded rest
 * outside the roster, so the check may under-report at the edges but never raises a false alarm there.
 * `longestRestMinutes` is the longest rest that overlaps the week. */
export interface WeeklyRestInsufficientBreach {
  kind: "weekly_rest_insufficient";
  personId: string;
  weekStart: string;
  longestRestMinutes: number;
  requiredMinutes: number;
}

/** A `shifts` row models no within-shift break, so this surfaces the obligation rather than detecting
 * a missing break. */
export interface BreakOwedBreach {
  kind: "break_owed";
  personId: string;
  shiftId: string;
  plannedMinutes: number;
  thresholdMinutes: number;
  minBreakMinutes: number;
}

export interface NightWorkBreach {
  kind: "night_work";
  personId: string;
  shiftId: string;
  nightMinutes: number;
}

export type RosterBreach =
  | RestTooShortBreach
  | ExceedsDailyMaxBreach
  | ExceedsWeeklyMaxBreach
  | OvertimeCapExceededBreach
  | WeeklyRestInsufficientBreach
  | BreakOwedBreach
  | NightWorkBreach;

export const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 1_440;
const MINUTES_PER_HOUR = 60;

export function minutesBetween(fromInstant: string, toInstant: string): number {
  return Math.round((Date.parse(toInstant) - Date.parse(fromInstant)) / MS_PER_MINUTE);
}

function shiftMinutes(s: PlannedShift): number {
  return minutesBetween(s.startsAt, s.endsAt);
}

export function localDate(instant: string, offsetMinutes: number): string {
  return new Date(Date.parse(instant) + offsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 10);
}

function wallMinutes(instant: string, offsetMinutes: number): number {
  return Math.round(Date.parse(instant) / MS_PER_MINUTE) + offsetMinutes;
}

/** The Monday of the week a `YYYY-MM-DD` date falls in; a Sunday belongs to the previous Monday. */
export function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const mondayIndex = (d.getUTCDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0, …
  return new Date(d.getTime() - mondayIndex * MINUTES_PER_DAY * MS_PER_MINUTE)
    .toISOString()
    .slice(0, 10);
}

/** A shift crossing local midnight counts wholly to the local day it starts. */
function plannedMinutesByPersonDay(
  byPerson: ReadonlyMap<string, PlannedShift[]>,
): Map<string, Map<string, number>> {
  const totals = new Map<string, Map<string, number>>();
  for (const [personId, shifts] of byPerson) {
    const perDay = new Map<string, number>();
    for (const s of shifts) {
      const day = localDate(s.startsAt, s.startsOffsetMinutes);
      perDay.set(day, (perDay.get(day) ?? 0) + shiftMinutes(s));
    }
    totals.set(personId, perDay);
  }
  return totals;
}

function byPersonSortedByStart(shifts: readonly PlannedShift[]): Map<string, PlannedShift[]> {
  const groups = new Map<string, PlannedShift[]>();
  for (const s of shifts) {
    const list = groups.get(s.personId) ?? [];
    list.push(s);
    groups.set(s.personId, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  }
  return groups;
}

interface Workday {
  firstStart: string;
  firstShiftId: string;
  lastEnd: string;
  lastShiftId: string;
}

/**
 * Rest runs from a working day's last end to the next working day's first start. A shift belongs to
 * the local day it starts, so a 22:00→02:00 shift's rest is measured from 02:00.
 */
function checkInterShiftRest(
  byPerson: ReadonlyMap<string, PlannedShift[]>,
  ruleset: WorkTimeRuleset,
): RestTooShortBreach[] {
  const breaches: RestTooShortBreach[] = [];
  for (const [personId, shifts] of byPerson) {
    const workdays = new Map<string, Workday>();
    for (const s of shifts) {
      const day = localDate(s.startsAt, s.startsOffsetMinutes);
      const workday = workdays.get(day);
      if (workday === undefined) {
        // Shifts arrive sorted by start, so the first seen is the day's earliest start. `lastEnd`
        // still needs the max below: an earlier-starting shift may end later.
        workdays.set(day, {
          firstStart: s.startsAt,
          firstShiftId: s.shiftId,
          lastEnd: s.endsAt,
          lastShiftId: s.shiftId,
        });
      } else if (Date.parse(s.endsAt) > Date.parse(workday.lastEnd)) {
        workday.lastEnd = s.endsAt;
        workday.lastShiftId = s.shiftId;
      }
    }
    const days = [...workdays.keys()].sort((a, b) => a.localeCompare(b));
    for (let i = 1; i < days.length; i += 1) {
      const previous = workdays.get(days[i - 1]!)!;
      const current = workdays.get(days[i]!)!;
      const restMinutes = minutesBetween(previous.lastEnd, current.firstStart);
      if (restMinutes < ruleset.minInterShiftRestMinutes) {
        breaches.push({
          kind: "rest_too_short",
          personId,
          previousShiftId: previous.lastShiftId,
          shiftId: current.firstShiftId,
          restMinutes,
          requiredMinutes: ruleset.minInterShiftRestMinutes,
        });
      }
    }
  }
  return breaches;
}

function checkDailyMax(
  dayTotals: ReadonlyMap<string, Map<string, number>>,
  ruleset: WorkTimeRuleset,
): ExceedsDailyMaxBreach[] {
  const breaches: ExceedsDailyMaxBreach[] = [];
  for (const [personId, perDay] of dayTotals) {
    for (const [workDate, plannedMinutes] of [...perDay].sort(([a], [b]) => a.localeCompare(b))) {
      if (plannedMinutes > ruleset.maxOrdinaryDailyMinutes) {
        breaches.push({
          kind: "exceeds_daily_max",
          personId,
          workDate,
          plannedMinutes,
          maxMinutes: ruleset.maxOrdinaryDailyMinutes,
        });
      }
    }
  }
  return breaches;
}

function checkWeeklyMax(
  dayTotals: ReadonlyMap<string, Map<string, number>>,
  ruleset: WorkTimeRuleset,
): ExceedsWeeklyMaxBreach[] {
  const breaches: ExceedsWeeklyMaxBreach[] = [];
  for (const [personId, perDay] of dayTotals) {
    const perWeek = new Map<string, number>();
    for (const [day, minutes] of perDay) {
      const week = weekStartOf(day);
      perWeek.set(week, (perWeek.get(week) ?? 0) + minutes);
    }
    for (const [weekStart, plannedMinutes] of [...perWeek].sort(([a], [b]) => a.localeCompare(b))) {
      if (plannedMinutes > ruleset.maxWeeklyMinutes) {
        breaches.push({
          kind: "exceeds_weekly_max",
          personId,
          weekStart,
          plannedMinutes,
          maxMinutes: ruleset.maxWeeklyMinutes,
        });
      }
    }
  }
  return breaches;
}

function checkOvertimeCap(
  dayTotals: ReadonlyMap<string, Map<string, number>>,
  ruleset: WorkTimeRuleset,
): OvertimeCapExceededBreach[] {
  const capMinutes = ruleset.annualOvertimeCapHours * MINUTES_PER_HOUR;
  const breaches: OvertimeCapExceededBreach[] = [];
  for (const [personId, perDay] of dayTotals) {
    let overtimeMinutes = 0;
    for (const minutes of perDay.values()) {
      overtimeMinutes += Math.max(0, minutes - ruleset.maxOrdinaryDailyMinutes);
    }
    if (overtimeMinutes > capMinutes) {
      breaches.push({ kind: "overtime_cap_exceeded", personId, overtimeMinutes, capMinutes });
    }
  }
  return breaches;
}

function weekStartWallMinutes(weekStart: string): number {
  return Math.round(Date.parse(`${weekStart}T00:00:00Z`) / MS_PER_MINUTE);
}

/** A week is satisfied when some gap between consecutive shifts, long enough, overlaps its span. */
function checkWeeklyRest(
  byPerson: ReadonlyMap<string, PlannedShift[]>,
  ruleset: WorkTimeRuleset,
): WeeklyRestInsufficientBreach[] {
  const breaches: WeeklyRestInsufficientBreach[] = [];
  for (const [personId, shifts] of byPerson) {
    const gaps = shifts.slice(1).map((current, i) => {
      const previous = shifts[i]!;
      const startWall = wallMinutes(previous.endsAt, previous.endsOffsetMinutes);
      const endWall = wallMinutes(current.startsAt, current.startsOffsetMinutes);
      return { startWall, endWall, lengthMinutes: endWall - startWall };
    });
    const weeks = [
      ...new Set(shifts.map((s) => weekStartOf(localDate(s.startsAt, s.startsOffsetMinutes)))),
    ].sort((a, b) => a.localeCompare(b));
    for (const weekStart of weeks.slice(1, -1)) {
      const spanStart = weekStartWallMinutes(weekStart);
      const spanEnd = spanStart + 7 * MINUTES_PER_DAY;
      let longestRestMinutes = 0;
      for (const gap of gaps) {
        if (gap.startWall < spanEnd && gap.endWall > spanStart) {
          longestRestMinutes = Math.max(longestRestMinutes, gap.lengthMinutes);
        }
      }
      if (longestRestMinutes < ruleset.weeklyRestMinutes) {
        breaches.push({
          kind: "weekly_rest_insufficient",
          personId,
          weekStart,
          longestRestMinutes,
          requiredMinutes: ruleset.weeklyRestMinutes,
        });
      }
    }
  }
  return breaches;
}

function checkBreakThreshold(
  shifts: readonly PlannedShift[],
  ruleset: WorkTimeRuleset,
): BreakOwedBreach[] {
  const breaches: BreakOwedBreach[] = [];
  for (const s of shifts) {
    const plannedMinutes = shiftMinutes(s);
    if (plannedMinutes > ruleset.breakThresholdMinutes) {
      breaches.push({
        kind: "break_owed",
        personId: s.personId,
        shiftId: s.shiftId,
        plannedMinutes,
        thresholdMinutes: ruleset.breakThresholdMinutes,
        minBreakMinutes: ruleset.minBreakMinutes,
      });
    }
  }
  return breaches;
}

/** Half-open, so a shift touching only a window boundary scores zero. The loop starts a day early to
 * catch a window spilling in from the previous day. */
function nightOverlapMinutes(startWall: number, endWall: number, ruleset: WorkTimeRuleset): number {
  const { nightWindowStartMinute: start, nightWindowEndMinute: end } = ruleset;
  const firstDay = Math.floor(startWall / MINUTES_PER_DAY) - 1;
  const lastDay = Math.floor(endWall / MINUTES_PER_DAY) + 1;
  let overlap = 0;
  for (let d = firstDay; d <= lastDay; d += 1) {
    const windowStart = d * MINUTES_PER_DAY + start;
    const windowEnd = d * MINUTES_PER_DAY + (start < end ? end : MINUTES_PER_DAY + end);
    overlap += Math.max(0, Math.min(endWall, windowEnd) - Math.max(startWall, windowStart));
  }
  return overlap;
}

function checkNightWindow(
  shifts: readonly PlannedShift[],
  ruleset: WorkTimeRuleset,
): NightWorkBreach[] {
  const breaches: NightWorkBreach[] = [];
  for (const s of shifts) {
    const nightMinutes = nightOverlapMinutes(
      wallMinutes(s.startsAt, s.startsOffsetMinutes),
      wallMinutes(s.endsAt, s.endsOffsetMinutes),
      ruleset,
    );
    if (nightMinutes > 0) {
      breaches.push({ kind: "night_work", personId: s.personId, shiftId: s.shiftId, nightMinutes });
    }
  }
  return breaches;
}

export function validateRoster(
  shifts: readonly PlannedShift[],
  ruleset: WorkTimeRuleset,
): RosterBreach[] {
  const byPerson = byPersonSortedByStart(shifts);
  const dayTotals = plannedMinutesByPersonDay(byPerson);
  return [
    ...checkInterShiftRest(byPerson, ruleset),
    ...checkDailyMax(dayTotals, ruleset),
    ...checkWeeklyMax(dayTotals, ruleset),
    ...checkOvertimeCap(dayTotals, ruleset),
    ...checkWeeklyRest(byPerson, ruleset),
    ...checkBreakThreshold(shifts, ruleset),
    ...checkNightWindow(shifts, ruleset),
  ];
}
