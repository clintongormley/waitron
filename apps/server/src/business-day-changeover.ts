import {
  businessDayAt,
  businessDayBoundaryAt,
  businessDayBounds,
  cutoverForBusinessDay,
  type BusinessDayClock,
  type CutoverChange,
} from "@waitron/shared";
import { civilDateOf } from "@waitron/reporting";
import { addDays, clockChangesBetween, localTimeOccurrences } from "@waitron/venue-service";

export type BusinessDayStartPlan = {
  today: string;
  effectiveBusinessDay: string;
  kept: CutoverChange[];
  removed: string[];
  before: BusinessDayClock;
  candidate: BusinessDayClock;
};

function withStart(clock: BusinessDayClock, day: string, dayCutover: string): BusinessDayClock {
  if (cutoverForBusinessDay(clock, day) === dayCutover) return clock;
  return {
    ...clock,
    cutoverChanges: [...clock.cutoverChanges, { effectiveBusinessDay: day, dayCutover }],
  };
}

/** `clock` is the full clock, waiting changes included. */
export function planBusinessDayStart(
  clock: BusinessDayClock,
  dayCutover: string,
  at: Date,
): BusinessDayStartPlan {
  const today = businessDayAt(clock, at);
  const future = clock.cutoverChanges.filter((change) => change.effectiveBusinessDay > today);
  const base = {
    ...clock,
    cutoverChanges: clock.cutoverChanges.filter((change) => change.effectiveBusinessDay <= today),
  };
  const tomorrow = addDays(today, 1);
  const tonight = withStart(base, tomorrow, dayCutover);
  if (businessDayBoundaryAt(tonight, tomorrow) > at.toISOString())
    return {
      today,
      effectiveBusinessDay: tomorrow,
      kept: [],
      removed: future.map((change) => change.effectiveBusinessDay),
      before: base,
      candidate: tonight,
    };
  // Today's end is still ahead, so a row waiting for tomorrow already decides it and stays.
  const kept = future.filter((change) => change.effectiveBusinessDay === tomorrow);
  const before = { ...base, cutoverChanges: [...base.cutoverChanges, ...kept] };
  const effectiveBusinessDay = addDays(today, 2);
  return {
    today,
    effectiveBusinessDay,
    kept,
    removed: future
      .filter((change) => change.effectiveBusinessDay !== tomorrow)
      .map((change) => change.effectiveBusinessDay),
    before,
    candidate: withStart(before, effectiveBusinessDay, dayCutover),
  };
}

function firstTransitionDay(plan: BusinessDayStartPlan, dayCutover: string): string | null {
  const plain = { ...plan.before, dayCutover, cutoverChanges: [] };
  for (let delta = -1; delta <= 1; delta++) {
    const day = addDays(plan.effectiveBusinessDay, delta);
    for (const clock of [plan.before, plain])
      if (localTimeOccurrences(day, cutoverForBusinessDay(clock, day), clock.timeZone).length !== 1)
        return day;
    try {
      businessDayBounds(plan.candidate, day);
    } catch {
      return day;
    }
  }
  return null;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** The calendar date `timeZone`'s clocks show just after they change near business day `day`
 *  (Havana jumping to 01:00 on 14 March gives the 14th; Santiago falling back from 23:59 to
 *  23:00 on 3 April gives the 3rd); `day` itself when the clocks do not change near it. */
export function clocksChangeDate(day: string, timeZone: string): string {
  const from = Date.parse(`${addDays(day, -1)}T00:00:00.000Z`) - 14 * HOUR_MS;
  const to = Date.parse(`${addDays(day, 2)}T00:00:00.000Z`) + 14 * HOUR_MS;
  const [change] = clockChangesBetween(new Date(from), new Date(to), timeZone);
  return change === undefined ? day : civilDateOf(change, timeZone);
}

export function clockTransitionAt(
  clock: BusinessDayClock,
  dayCutover: string,
  at: Date,
): null | { clocksChangeOn: string; saveFrom: string | null } {
  const plan = planBusinessDayStart(clock, dayCutover, at);
  const failing = firstTransitionDay(plan, dayCutover);
  if (failing === null) return null;
  const clocksChangeOn = clocksChangeDate(failing, clock.timeZone);
  // The effective date only moves at one of these boundaries, so no other moment needs trying.
  const plain = { ...clock, dayCutover, cutoverChanges: [] };
  const moments = new Set<string>();
  for (let k = 0; k <= 9; k++) {
    const day = addDays(plan.today, k);
    moments.add(businessDayBoundaryAt(clock, day));
    moments.add(businessDayBoundaryAt(plain, day));
  }
  const saveFrom = [...moments]
    .filter((moment) => moment > at.toISOString())
    .sort()
    .find(
      (moment) =>
        firstTransitionDay(
          planBusinessDayStart(clock, dayCutover, new Date(moment)),
          dayCutover,
        ) === null,
    );
  return { clocksChangeOn, saveFrom: saveFrom ?? null };
}
