import type { BusinessDayScheduleStatus } from "./service-day-context.js";
import { asc, eq } from "drizzle-orm";
import { locationBusinessDaySettings, type Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import {
  AppError,
  businessDayAt,
  businessDayBoundaryAt,
  cutoverForBusinessDay,
  type BusinessDayClock,
} from "@waitron/shared";
import type { BusinessDayClockConflict } from "@waitron/module";
import type { VenueScope } from "./operations.js";
import { menuDayTimetables, menuPeriods, menuSlots } from "./schema/menus.js";
import { departments, zoneServicePolicies } from "./schema/service.js";
import { specialDates } from "./schema/hours.js";
import { zoneClosedTimes } from "./schema/zone-closed-times.js";
import { addDays, weekdayOf } from "./hours-rules.js";
import { parseClosedRanges, rangeSpan } from "./service-day.js";
import "./errors.js";

export type { BusinessDayClockConflict } from "@waitron/module";
const minutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
interface Placement {
  departmentId: string;
  zoneId?: string;
  weekday: number | null;
  specialDateId: string | null;
  date: string | null;
  repeatOn: string | null;
  periodId?: string;
  startsAt: string;
  endsAt: string;
  offset: number;
}

export async function businessDayClockConflicts(
  tx: Transaction,
  cfg: VenueScope,
  before: BusinessDayClock,
  candidate: BusinessDayClock,
  effectiveBusinessDay: string,
): Promise<{ conflicts: BusinessDayClockConflict[]; conflictCount: number }> {
  const periods = await tx
    .select({
      departmentId: menuSlots.departmentId,
      weekday: menuDayTimetables.weekday,
      specialDateId: menuDayTimetables.specialDateId,
      date: specialDates.date,
      repeatOn: specialDates.repeatOn,
      periodId: menuSlots.periodId,
      startsAt: menuSlots.startsAt,
      endsAt: menuSlots.endsAt,
      offset: menuPeriods.endOffsetMinutes,
    })
    .from(menuSlots)
    .innerJoin(menuDayTimetables, eq(menuDayTimetables.id, menuSlots.timetableId))
    .innerJoin(menuPeriods, eq(menuPeriods.id, menuSlots.periodId))
    .innerJoin(departments, eq(departments.id, menuSlots.departmentId))
    .leftJoin(specialDates, eq(specialDates.id, menuDayTimetables.specialDateId))
    .where(eq(departments.locationId, cfg.locationId))
    .orderBy(asc(menuSlots.id));
  const closures = await tx
    .select({
      departmentId: zoneServicePolicies.departmentId,
      zoneId: zoneClosedTimes.zoneId,
      weekday: zoneClosedTimes.weekday,
      specialDateId: zoneClosedTimes.specialDateId,
      date: specialDates.date,
      repeatOn: specialDates.repeatOn,
      startsAt: zoneClosedTimes.startsAt,
      endsAt: zoneClosedTimes.endsAt,
    })
    .from(zoneClosedTimes)
    .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, zoneClosedTimes.zoneId))
    .leftJoin(specialDates, eq(specialDates.id, zoneClosedTimes.specialDateId))
    .where(eq(zoneServicePolicies.locationId, cfg.locationId))
    .orderBy(asc(zoneClosedTimes.id));
  const groups = new Map<string, Placement[]>();
  for (const placement of [...periods, ...closures.map((row) => ({ ...row, offset: 0 }))]) {
    if (
      placement.date !== null &&
      placement.repeatOn === null &&
      placement.date < addDays(effectiveBusinessDay, -1)
    )
      continue;
    const key = `${placement.departmentId}/${"zoneId" in placement ? placement.zoneId : ""}/${placement.specialDateId ?? placement.weekday}`;
    groups.set(key, [...(groups.get(key) ?? []), placement]);
  }
  const conflicts: BusinessDayClockConflict[] = [];
  const allPeriods = [...groups.values()].flat().filter((p) => p.periodId !== undefined);
  const nextPlacements = (p: Placement): Placement[] => {
    const own = allPeriods.filter((other) => other.departmentId === p.departmentId);
    if (p.date === null) return own.filter((other) => other.weekday === (p.weekday! + 1) % 7);
    const nextDate = addDays(p.date, 1);
    const dated = own.filter(
      (other) =>
        other.date === nextDate ||
        (other.repeatOn !== null && other.repeatOn === nextDate.slice(5)),
    );
    return dated.length > 0 ? dated : own.filter((other) => other.weekday === weekdayOf(nextDate));
  };
  for (const key of [...groups.keys()].sort()) {
    const placements = groups.get(key)!;
    const oldCutover = cutoverForBusinessDay(before, effectiveBusinessDay);
    const newCutover = cutoverForBusinessDay(candidate, effectiveBusinessDay);
    if (oldCutover === newCutover) continue;
    placements.sort(
      (a, b) =>
        rangeSpan(a, oldCutover).start - rangeSpan(b, oldCutover).start ||
        a.startsAt.localeCompare(b.startsAt) ||
        a.endsAt.localeCompare(b.endsAt),
    );
    let invalid = false;
    for (const cutover of [oldCutover, newCutover]) {
      try {
        parseClosedRanges(
          placements.map((p) => ({
            startsAt: p.startsAt.slice(0, 5),
            endsAt: p.endsAt.slice(0, 5),
          })),
          "ranges",
          cutover,
        );
      } catch {
        invalid = true;
      }
    }
    for (const [rangeIndex, p] of placements.entries()) {
      const startsAt = p.startsAt.slice(0, 5),
        endsAt = p.endsAt.slice(0, 5);
      const oldSpan = rangeSpan({ startsAt, endsAt }, oldCutover);
      const newSpan = rangeSpan({ startsAt, endsAt }, newCutover);
      const oldCutoff = minutes(oldCutover) + oldSpan.end + p.offset;
      const newCutoff = minutes(newCutover) + newSpan.end + p.offset;
      const low = Math.min(minutes(oldCutover), minutes(newCutover));
      const high = Math.max(minutes(oldCutover), minutes(newCutover));
      const inStrip = (minute: number) => low <= minute && minute < high;
      const ownership = (time: string, cutover: string, end: boolean) =>
        Number(time < cutover || (end && time === cutover));
      const cutoffClashes =
        p.periodId !== undefined &&
        p.offset > 0 &&
        [oldCutover, newCutover].some((cutover) => {
          const span = rangeSpan({ startsAt, endsAt }, cutover);
          const later = placements
            .slice(rangeIndex + 1)
            .map((next) => rangeSpan(next, cutover).start);
          const tomorrow = nextPlacements(p).map((next) => 1440 + rangeSpan(next, cutover).start);
          return [...later, ...tomorrow].some((next) => span.end + p.offset >= next);
        });
      let reason: BusinessDayClockConflict["reason"] | null = null;
      if (startsAt === endsAt) reason = "all_day";
      else if (invalid) reason = "range";
      else if (
        ownership(startsAt, oldCutover, false) !== ownership(startsAt, newCutover, false) ||
        ownership(endsAt, oldCutover, true) !== ownership(endsAt, newCutover, true)
      )
        reason = "endpoint_day";
      else if (
        cutoffClashes ||
        Math.floor(oldCutoff / 1440) !== Math.floor(newCutoff / 1440) ||
        oldSpan.end + p.offset <= oldSpan.start ||
        newSpan.end + p.offset <= newSpan.start
      )
        reason = "sending_cutoff";
      else if (
        inStrip(minutes(startsAt)) ||
        inStrip(minutes(endsAt)) ||
        inStrip(((oldCutoff % 1440) + 1440) % 1440) ||
        inStrip(((newCutoff % 1440) + 1440) % 1440)
      )
        reason = "transition_strip";
      if (reason !== null)
        conflicts.push({
          departmentId: p.departmentId,
          ...(p.zoneId === undefined ? {} : { zoneId: p.zoneId }),
          ...(p.weekday === null ? {} : { weekday: p.weekday }),
          ...(p.specialDateId === null ? {} : { specialDateId: p.specialDateId }),
          ...(p.date === null ? {} : { date: p.date }),
          ...(p.periodId === undefined ? {} : { periodId: p.periodId }),
          rangeIndex,
          reason,
        });
    }
  }
  return { conflicts: conflicts.slice(0, 20), conflictCount: conflicts.length };
}
export async function assertBusinessDayClockChange(
  tx: Transaction,
  cfg: VenueScope,
  before: BusinessDayClock,
  candidate: BusinessDayClock,
  effectiveBusinessDay: string,
): Promise<void> {
  const result = await businessDayClockConflicts(tx, cfg, before, candidate, effectiveBusinessDay);
  if (result.conflictCount > 0) throw new AppError("venue.business_day_hours_conflict", result);
}
export async function assertBusinessDayScheduleWrite(
  tx: Transaction,
  cfg: VenueScope,
  changeKind: "time" | "metadata",
  at: Date,
  expectedClockRevision: number,
  acquiredClock?: BusinessDayClock,
): Promise<void> {
  if (changeKind === "metadata") return;
  const revision = await readBusinessDayScheduleRevision(tx, cfg);
  if (
    !Number.isSafeInteger(expectedClockRevision) ||
    expectedClockRevision < 0 ||
    expectedClockRevision !== revision
  )
    throw new AppError("hours.clock_changed", {});
  const clock = acquiredClock ?? (await readLocationClock(tx, cfg.locationId));
  const pending = clock.cutoverChanges.find(
    (change) => businessDayBoundaryAt(clock, change.effectiveBusinessDay) > at.toISOString(),
  );
  if (pending !== undefined)
    throw new AppError("hours.clock_change_pending", {
      effectiveBusinessDay: pending.effectiveBusinessDay,
    });
}

export function sameScheduleRanges(
  before: readonly { startsAt: string; endsAt: string; periodId?: string }[],
  after: readonly { startsAt: string; endsAt: string; periodId?: string }[],
): boolean {
  const keys = (ranges: typeof before) =>
    ranges
      .map(
        (range) =>
          `${range.periodId ?? ""}/${range.startsAt.slice(0, 5)}/${range.endsAt.slice(0, 5)}`,
      )
      .sort();
  const oldKeys = keys(before),
    newKeys = keys(after);
  return oldKeys.length === newKeys.length && oldKeys.every((key, index) => key === newKeys[index]);
}

export async function readBusinessDayScheduleRevision(
  tx: Transaction,
  cfg: VenueScope,
): Promise<number> {
  const [settings] = await tx
    .select({ revision: locationBusinessDaySettings.revision })
    .from(locationBusinessDaySettings)
    .where(eq(locationBusinessDaySettings.locationId, cfg.locationId));
  return settings?.revision ?? 0;
}

export async function readBusinessDayScheduleStatus(
  tx: Transaction,
  cfg: VenueScope,
  clock: BusinessDayClock,
  at: Date,
): Promise<BusinessDayScheduleStatus> {
  const clockRevision = await readBusinessDayScheduleRevision(tx, cfg);
  let currentBusinessDay: string;
  try {
    currentBusinessDay = businessDayAt(clock, at);
  } catch {
    return { businessDayClock: clock, clockRevision, currentBusinessDay: null, pending: null };
  }
  const change = clock.cutoverChanges.find(
    (row) => businessDayBoundaryAt(clock, row.effectiveBusinessDay) > at.toISOString(),
  );
  let pending: BusinessDayScheduleStatus["pending"] = null;
  if (change !== undefined) {
    const locksAt = businessDayBoundaryAt(clock, addDays(change.effectiveBusinessDay, -1));
    pending = {
      ...change,
      startsAt: businessDayBoundaryAt(clock, change.effectiveBusinessDay),
      locksAt,
      editable: at.toISOString() < locksAt,
    };
  }
  return { businessDayClock: clock, clockRevision, currentBusinessDay, pending };
}
