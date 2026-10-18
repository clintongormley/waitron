import {
  businessDayAt,
  businessDayBoundaryAt,
  businessDayBounds,
  cutoverForBusinessDay,
  type BusinessDayClock,
  type CutoverChange,
} from "@waitron/shared";
import { localTimeOccurrences } from "@waitron/venue-service";

export type BusinessDayStartPlan = {
  today: string;
  effectiveBusinessDay: string;
  kept: CutoverChange[];
  removed: string[];
  before: BusinessDayClock;
  candidate: BusinessDayClock;
};

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

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

export function clockTransitionAt(
  clock: BusinessDayClock,
  dayCutover: string,
  at: Date,
): null | { clocksChangeOn: string; saveFrom: string | null } {
  const plan = planBusinessDayStart(clock, dayCutover, at);
  const clocksChangeOn = firstTransitionDay(plan, dayCutover);
  if (clocksChangeOn === null) return null;
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
