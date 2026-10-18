import {
  businessDayAt,
  businessDayBounds,
  businessDayBoundaryAt,
  cutoverForBusinessDay,
  type BusinessDayClock,
} from "@waitron/shared";
export interface ServiceDayContext {
  dayCutover: string;
  startAt: string;
  endAt: string;
  endMinute: number;
}
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export function serviceDayWallContext(
  clock: BusinessDayClock,
  day: string,
): Pick<ServiceDayContext, "dayCutover" | "endMinute"> {
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const dayCutover = cutoverForBusinessDay(clock, day);
  // Dated rules admit four-digit years, so none can follow the last calendar date.
  const nextCutover =
    next.getUTCFullYear() > 9999
      ? dayCutover
      : cutoverForBusinessDay(clock, next.toISOString().slice(0, 10));
  return { dayCutover, endMinute: 1440 + minutes(nextCutover) - minutes(dayCutover) };
}
export function serviceDayContext(clock: BusinessDayClock, day: string): ServiceDayContext {
  return { ...serviceDayWallContext(clock, day), ...businessDayBounds(clock, day) };
}

export interface BusinessDayScheduleStatus {
  businessDayClock: BusinessDayClock;
  clockRevision: number;
  currentBusinessDay: string | null;
  pending: null | {
    effectiveBusinessDay: string;
    dayCutover: string;
    startsAt: string;
  };
}

export function scheduleCutovers(clock: BusinessDayClock, day?: string): string[] {
  return day === undefined
    ? [...new Set([clock.dayCutover, ...clock.cutoverChanges.map((change) => change.dayCutover)])]
    : [cutoverForBusinessDay({ ...clock, timeZone: "UTC" }, day)];
}

/** The clock without the changes still waiting at `at`. */
export function settledClock(clock: BusinessDayClock, at: Date): BusinessDayClock {
  const now = at.toISOString();
  return {
    ...clock,
    cutoverChanges: clock.cutoverChanges.filter(
      (change) => businessDayBoundaryAt(clock, change.effectiveBusinessDay) <= now,
    ),
  };
}

/** What a last-orders check after an hours save at `at` reads: a one-off date under its own start
 *  on `clock`, everything undated under `weekly`, the start in force. */
export interface LastOrdersClock {
  clock: BusinessDayClock;
  weekly: string;
}
export function lastOrdersClock(clock: BusinessDayClock, at: Date): LastOrdersClock {
  return { clock: settledClock(clock, at), weekly: inForceClock(clock, at).dayCutover };
}

/** The start in force at `at` as the clock's only start: what an undated weekly check fits. */
export function inForceClock(clock: BusinessDayClock, at: Date): BusinessDayClock {
  // Without changes the first start is in force at every moment, and the time zone, which a
  // writer may hold unreadable, is not consulted.
  if (clock.cutoverChanges.length === 0) return clock;
  return {
    ...clock,
    dayCutover: cutoverForBusinessDay(clock, businessDayAt(clock, at)),
    cutoverChanges: [],
  };
}
