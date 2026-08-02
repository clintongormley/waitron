import type { WorkTimeRuleset } from "./ruleset.js";

/**
 * The generic roster-guardrail validation engine (plan §6 Slice D2.3, design §3.2). Pure logic over
 * planned shifts, DB-free on purpose: there is no privilege set, no RLS and no concurrency here, so
 * CLAUDE.md §4's "pick the lighter target" makes this direct/PGlite-free unit-tested, never against a
 * real-role Postgres.
 *
 * Every threshold is READ FROM the caller-supplied `WorkTimeRuleset` — NO convenio number is
 * hard-coded (the `no-hardcoded-margin` discipline, proved by roster-validation.no-hardcoded-limits
 * .test.ts). The engine never imports `convenio_config` or names a convenio; `packages/workforce-es`
 * resolves a `convenio_config` row into a `WorkTimeRuleset` and passes it in (the Spain→generic
 * boundary, plan §3.3).
 *
 * OWNER DECISION (2026-08-02): guardrail breaches are ADVISORY. This engine SURFACES breaches as a
 * structured list; it NEVER throws, and publishing a breaching roster is allowed (`publishRoster`
 * returns the breaches and publishes anyway). Because a breach is a warning that is never thrown, the
 * breach KINDS below are a plain union and are deliberately NOT registered as thrown error codes in
 * `errors.ts` (that registry is for `throw new AppError(...)`; an advisory warning must not pollute
 * it). A future decision could promote a specific guardrail to a hard reject on publish — the seam is
 * clean (a caller can inspect the returned kinds and choose to refuse) but that policy is not built
 * here.
 */

/** One planned shift, in the neutral shape the engine measures — a subset of the `shifts` row.
 * `startsAt`/`endsAt` are the absolute instants; the `*OffsetMinutes` are the wall offsets that ride
 * alongside (the `time_entries.event_at`/`event_offset_minutes` pattern), so the LOCAL wall date and
 * minute-of-day are recovered by shifting the instant by its offset. */
export interface PlannedShift {
  shiftId: string;
  personId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
}

/** The discriminated union of guardrail breaches. Each member carries the offending detail plus the
 * ruleset limit it measured against, so a caller can render the warning without re-deriving it. */
export type RosterBreachKind =
  | "rest_too_short"
  | "exceeds_daily_max"
  | "exceeds_weekly_max"
  | "overtime_cap_exceeded"
  | "weekly_rest_insufficient"
  | "break_owed"
  | "night_work";

/** Two of a person's consecutive JORNADAS (working days) are closer together than
 * `minInterShiftRestMinutes` (art. 34.3, ≥12h between working days — NOT between same-day segments of
 * a turno partido). `previousShiftId` is the shift ending the earlier jornada, `shiftId` the shift
 * opening the next; `restMinutes` is the gap between them and `requiredMinutes` the floor. */
export interface RestTooShortBreach {
  kind: "rest_too_short";
  personId: string;
  previousShiftId: string;
  shiftId: string;
  restMinutes: number;
  requiredMinutes: number;
}

/** A person's planned minutes on one local day exceed `maxOrdinaryDailyMinutes` (art. 34.3, ≤9h).
 * A turno partido's several shifts on the same local day are summed before the comparison. */
export interface ExceedsDailyMaxBreach {
  kind: "exceeds_daily_max";
  personId: string;
  workDate: string;
  plannedMinutes: number;
  maxMinutes: number;
}

/** A person's planned minutes in one Monday-anchored week exceed `maxWeeklyMinutes` (art. 34.1, 40h
 * average). `weekStart` is the local Monday's date. NB art. 34.1 is a promedio en cómputo anual; a
 * per-calendar-week sum is the practical guardrail reading, documented here as the chosen bucket. */
export interface ExceedsWeeklyMaxBreach {
  kind: "exceeds_weekly_max";
  personId: string;
  weekStart: string;
  plannedMinutes: number;
  maxMinutes: number;
}

/** A person's total planned overtime across the roster exceeds `annualOvertimeCapHours` (art. 35.2,
 * 80h/year). Overtime accrues per day as the minutes beyond `maxOrdinaryDailyMinutes` (art. 35.1),
 * summed over every shift supplied — so the caller sets the horizon by choosing which shifts to pass
 * (a year's shifts to check the annual cap). `capMinutes` is the cap converted to minutes. */
export interface OvertimeCapExceededBreach {
  kind: "overtime_cap_exceeded";
  personId: string;
  overtimeMinutes: number;
  capMinutes: number;
}

/** A person's MIDDLE week (one flanked by shifts on both sides) carries no continuous rest gap of at
 * least `weeklyRestMinutes` (art. 37.1, 1.5 days). `longestRestMinutes` is the longest rest that
 * overlaps the week. A SAFE reading: only fully-surrounded weeks are judged — the first and last
 * week of a person's shifts are excused by the unbounded rest before/after the roster, so the check
 * never raises a false alarm at the edges (it may under-report there — documented on the check). */
export interface WeeklyRestInsufficientBreach {
  kind: "weekly_rest_insufficient";
  personId: string;
  weekStart: string;
  longestRestMinutes: number;
  requiredMinutes: number;
}

/** A planned shift longer than `breakThresholdMinutes` (art. 34.4, >6h) owes a rest break of at least
 * `minBreakMinutes`. Because a `shifts` row does not model a within-shift break, this
 * SURFACES the obligation for the scheduler rather than detecting a missing break — one per shift. */
export interface BreakOwedBreach {
  kind: "break_owed";
  personId: string;
  shiftId: string;
  plannedMinutes: number;
  thresholdMinutes: number;
  minBreakMinutes: number;
}

/** A planned shift whose LOCAL wall time overlaps the night window (art. 36, default 22:00–06:00) —
 * trabajo nocturno, which may owe a nocturnidad premium and carries its own limits. `nightMinutes`
 * is the overlap; the breach fires only when it is positive. */
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

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 1_440;
const MINUTES_PER_HOUR = 60;

function minutesBetween(fromInstant: string, toInstant: string): number {
  return Math.round((Date.parse(toInstant) - Date.parse(fromInstant)) / MS_PER_MINUTE);
}

/** A shift's planned duration in minutes — its end instant less its start instant. */
function shiftMinutes(s: PlannedShift): number {
  return minutesBetween(s.startsAt, s.endsAt);
}

/** The LOCAL wall calendar day for an instant + its wall offset — the instant shifted by the offset
 * and read back as a UTC date (the `time_entries`/projection `localDate` convention). */
function localDate(instant: string, offsetMinutes: number): string {
  return new Date(Date.parse(instant) + offsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 10);
}

/** An instant as minutes on the LOCAL wall-clock timeline (the instant shifted by its offset, in
 * minutes) — the axis the night-window and weekly-rest checks measure on, so a window expressed in
 * minutes-from-local-midnight lines up regardless of the underlying UTC instant. */
function wallMinutes(instant: string, offsetMinutes: number): number {
  return Math.round(Date.parse(instant) / MS_PER_MINUTE) + offsetMinutes;
}

/** The date (YYYY-MM-DD) of the Monday of the local week a date falls in — the weekly checks' bucket.
 * A Monday-anchored calendar week (Mon=0), so a Sunday buckets with the PREVIOUS Monday. */
function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const mondayIndex = (d.getUTCDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0, …
  return new Date(d.getTime() - mondayIndex * MINUTES_PER_DAY * MS_PER_MINUTE)
    .toISOString()
    .slice(0, 10);
}

/** Per person, the planned minutes on each LOCAL day, a shift attributed to the local day it STARTS
 * (so a shift crossing local midnight counts wholly to its start day). Shared by the daily-max and
 * weekly-max checks; deleting either check's use of it still fails that check's own tests. */
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

/** Groups shifts by person, each group sorted ascending by start instant. */
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

/** One jornada's boundary shifts: the earliest start and latest end among a person's shifts that
 * local day, with the shift ids that carry them. */
interface Workday {
  firstStart: string;
  firstShiftId: string;
  lastEnd: string;
  lastShiftId: string;
}

/**
 * art. 34.3: the minimum rest is between JORNADAS (working days), NOT between arbitrary consecutive
 * shifts — so a same-day turno partido (e.g. 12:00–16:00 then 20:00–24:00) is ONE jornada with an
 * intra-day break and must never raise `rest_too_short`. Each shift is assigned to a jornada by the
 * LOCAL date of its START (`localDate`); a shift crossing midnight therefore belongs to the day it
 * STARTS — the documented choice, so a 22:00→02:00 shift's rest is measured from 02:00 as that day's
 * last end. The rest measured is: end of a jornada's LAST shift → start of the next worked jornada's
 * FIRST shift (absolute instants; the intra-day gap between a jornada's own segments is ignored).
 * `< required` breaches; exactly the minimum is legal.
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
        // `byPerson` is pre-sorted ascending by start, so the FIRST shift seen for a day-key is that
        // jornada's earliest start — `firstStart`/`firstShiftId` are therefore set once and never
        // lowered. `lastEnd` still needs the max below: an earlier-starting shift may end later (a
        // long opening shift over a short evening one), so end order is not start order.
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

/** art. 34.3: a person's planned minutes on one local day must not exceed `maxOrdinaryDailyMinutes`.
 * `> max` breaches; exactly the maximum is legal. Days are ordered ascending for a stable result. */
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

/** art. 34.1: a person's planned minutes in one Monday-anchored week must not exceed
 * `maxWeeklyMinutes`. Days are rolled up into their local Monday's week; `> max` breaches, exactly
 * the maximum is legal. Weeks are ordered ascending for a stable result. */
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

/** art. 35.2: a person's total planned overtime must not exceed `annualOvertimeCapHours`. Each day
 * accrues `max(0, plannedMinutes − maxOrdinaryDailyMinutes)` (art. 35.1: hours over the maximum
 * ordinary jornada); the per-person sum is compared against the cap in minutes. `> cap` breaches. */
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

/** The date of a week's Monday as wall minutes (local midnight), the axis the weekly-rest overlap
 * uses — the same wall-minute space as `wallMinutes`, so a gap and a week span compare directly. */
function weekStartWallMinutes(weekStart: string): number {
  return Math.round(Date.parse(`${weekStart}T00:00:00Z`) / MS_PER_MINUTE);
}

/** art. 37.1: every judged week must hold a continuous rest of >= `weeklyRestMinutes`. Per person,
 * gaps between consecutive shifts are measured on the local wall timeline; a week is satisfied when
 * some gap of at least the required length overlaps its 7-day span. Only MIDDLE weeks are judged —
 * the first and last week of the person's shifts are excused by the unbounded rest before/after the
 * roster (the safe, no-false-alarm reading; see the breach type). */
function checkWeeklyRest(
  byPerson: ReadonlyMap<string, PlannedShift[]>,
  ruleset: WorkTimeRuleset,
): WeeklyRestInsufficientBreach[] {
  const breaches: WeeklyRestInsufficientBreach[] = [];
  for (const [personId, shifts] of byPerson) {
    // Gaps between consecutive shifts, on the wall timeline: [end of one, start of the next).
    const gaps = shifts.slice(1).map((current, i) => {
      const previous = shifts[i]!;
      const startWall = wallMinutes(previous.endsAt, previous.endsOffsetMinutes);
      const endWall = wallMinutes(current.startsAt, current.startsOffsetMinutes);
      return { startWall, endWall, lengthMinutes: endWall - startWall };
    });
    // The person's weeks-with-shifts, ascending; only the interior (neither first nor last) is judged.
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

/** art. 34.4: a shift longer than `breakThresholdMinutes` owes a ≥ `minBreakMinutes` break. Surfaces
 * one breach per over-threshold shift (planned shifts carry no break to inspect — see the type doc).
 * `> threshold` fires; a shift exactly at the threshold does not. */
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

/** The minutes of a shift's local wall span that fall inside the recurring nightly window. The window
 * WRAPS midnight when `nightWindowStartMinute >= nightWindowEndMinute` (the 22:00–06:00 default), so
 * each day d contributes `[d·1440+start, d·1440+end)` when non-wrapping, else `[d·1440+start,
 * d·1440+1440+end)`; summing over every day the shift touches (± a day for a window spilling in from
 * the previous day) gives the overlap. Half-open, so a shift touching only a boundary scores zero. */
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

/** art. 36: flags each shift whose local wall span overlaps the night window, with the overlap. */
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

/**
 * Validates a set of planned shifts against a work-time ruleset, returning every guardrail breach it
 * finds (an empty array when the roster is clean). Advisory — the caller decides what to do with the
 * list; the engine neither throws nor mutates.
 */
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
