import type { BusinessDayScheduleStatus } from "./service-day-context.js";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { floorZones, locationBusinessDaySettings, type Transaction } from "@waitron/db";
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
import {
  departmentDayRanges,
  departmentDays,
  seasons,
  zoneDayRanges,
  zoneDays,
} from "./schema/seasons.js";
import { seasonOnSorted } from "./season-rules.js";
import { addDays, weekdayOf } from "./hours-rules.js";
import { parseClosedRanges, rangeSpan } from "./service-day.js";
import "./errors.js";

export type { BusinessDayClockConflict } from "@waitron/module";
const minutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
interface Placement {
  departmentId: string;
  departmentName: string;
  zoneName?: string;
  periodName?: string;
  specialDateName: string | null;
  zoneId?: string;
  weekday: number | null;
  seasonId: string | null;
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
  const named = await tx
    .select({
      departmentId: menuSlots.departmentId,
      departmentName: departments.name,
      periodName: menuPeriods.name,
      specialDateName: specialDates.name,
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
    .where(
      and(eq(departments.locationId, cfg.locationId), isNotNull(menuDayTimetables.specialDateId)),
    )
    .orderBy(asc(menuSlots.id));
  const seasonPeriods = await tx
    .select({
      departmentId: departmentDays.departmentId,
      departmentName: departments.name,
      periodName: menuPeriods.name,
      weekday: departmentDays.weekday,
      seasonId: departmentDays.seasonId,
      periodId: menuPeriods.id,
      startsAt: departmentDayRanges.startsAt,
      endsAt: departmentDayRanges.endsAt,
      offset: menuPeriods.endOffsetMinutes,
    })
    .from(departmentDayRanges)
    .innerJoin(departmentDays, eq(departmentDays.id, departmentDayRanges.dayId))
    .innerJoin(menuPeriods, eq(menuPeriods.id, departmentDayRanges.periodId))
    .innerJoin(departments, eq(departments.id, departmentDays.departmentId))
    .where(and(eq(departments.locationId, cfg.locationId), isNotNull(departmentDays.seasonId)))
    .orderBy(asc(departmentDayRanges.id));
  const namedClosures = await tx
    .select({
      departmentId: zoneServicePolicies.departmentId,
      departmentName: departments.name,
      zoneName: floorZones.name,
      specialDateName: specialDates.name,
      zoneId: zoneClosedTimes.zoneId,
      specialDateId: zoneClosedTimes.specialDateId,
      date: specialDates.date,
      repeatOn: specialDates.repeatOn,
      startsAt: zoneClosedTimes.startsAt,
      endsAt: zoneClosedTimes.endsAt,
    })
    .from(zoneClosedTimes)
    .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, zoneClosedTimes.zoneId))
    .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .innerJoin(floorZones, eq(floorZones.id, zoneClosedTimes.zoneId))
    .leftJoin(specialDates, eq(specialDates.id, zoneClosedTimes.specialDateId))
    .where(
      and(
        eq(zoneServicePolicies.locationId, cfg.locationId),
        isNotNull(zoneClosedTimes.specialDateId),
      ),
    )
    .orderBy(asc(zoneClosedTimes.id));
  const seasonClosures = await tx
    .select({
      departmentId: zoneServicePolicies.departmentId,
      departmentName: departments.name,
      zoneName: floorZones.name,
      zoneId: zoneDays.zoneId,
      weekday: zoneDays.weekday,
      seasonId: zoneDays.seasonId,
      startsAt: zoneDayRanges.startsAt,
      endsAt: zoneDayRanges.endsAt,
    })
    .from(zoneDayRanges)
    .innerJoin(zoneDays, eq(zoneDays.id, zoneDayRanges.dayId))
    .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, zoneDays.zoneId))
    .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .innerJoin(floorZones, eq(floorZones.id, zoneDays.zoneId))
    .where(and(eq(zoneServicePolicies.locationId, cfg.locationId), isNotNull(zoneDays.seasonId)))
    .orderBy(asc(zoneDayRanges.id));
  const seasonList = await tx
    .select({ id: seasons.id, startsOn: seasons.startsOn })
    .from(seasons)
    .where(eq(seasons.locationId, cfg.locationId))
    .orderBy(asc(seasons.startsOn));
  const seasonOf = (date: string) => seasonOnSorted(seasonList, date)?.id ?? null;
  const nextSeason = (seasonId: string) =>
    seasonList[(seasonList.findIndex((season) => season.id === seasonId) + 1) % seasonList.length]!
      .id;
  const undated = { specialDateName: null, specialDateId: null, date: null, repeatOn: null };
  const periods: Placement[] = [
    ...named.map((row) => ({ ...row, weekday: null, seasonId: null })),
    ...seasonPeriods.map((row) => ({ ...row, ...undated })),
  ];
  const closures: Omit<Placement, "offset">[] = [
    ...namedClosures.map((row) => ({ ...row, weekday: null, seasonId: null })),
    ...seasonClosures.map((row) => ({ ...row, ...undated })),
  ];
  const calendar = await tx
    .select()
    .from(specialDates)
    .where(eq(specialDates.locationId, cfg.locationId))
    .orderBy(asc(specialDates.date), asc(specialDates.id));
  const timetables = await tx
    .select({
      departmentId: menuDayTimetables.departmentId,
      specialDateId: menuDayTimetables.specialDateId,
    })
    .from(menuDayTimetables)
    .innerJoin(departments, eq(departments.id, menuDayTimetables.departmentId))
    .where(eq(departments.locationId, cfg.locationId));
  const annualDates = (date: string, repeatOn: string): string[] => {
    const firstYear = Math.max(Number(date.slice(0, 4)), Number(effectiveBusinessDay.slice(0, 4)));
    const years = new Set(
      Array.from({ length: Math.min(400, 10000 - firstYear) }, (_, i) => firstYear + i),
    );
    for (const day of calendar)
      if (day.repeatOn === null && day.date >= effectiveBusinessDay)
        years.add(Number(day.date.slice(0, 4)));
    return [...years].flatMap((year) => {
      const occurrence = `${String(year).padStart(4, "0")}-${repeatOn}`;
      return occurrence >= date &&
        occurrence >= addDays(effectiveBusinessDay, -1) &&
        new Date(`${occurrence}T00:00:00Z`).toISOString().slice(0, 10) === occurrence
        ? [occurrence]
        : [];
    });
  };
  const namedOccurrences = calendar.flatMap((day) =>
    day.repeatOn === null ? [day.date] : annualDates(day.date, day.repeatOn),
  );
  const groups = new Map<string, Placement[]>();
  for (const placement of [...periods, ...closures.map((row) => ({ ...row, offset: 0 }))]) {
    if (
      placement.date !== null &&
      placement.repeatOn === null &&
      placement.date < addDays(effectiveBusinessDay, -1)
    )
      continue;
    const key = `${placement.departmentId}/${placement.zoneId ?? ""}/${placement.specialDateId ?? `${placement.seasonId}:${placement.weekday}`}`;
    groups.set(key, [...(groups.get(key) ?? []), placement]);
  }
  const conflicts: BusinessDayClockConflict[] = [];
  const allPeriods = [...groups.values()].flat().filter((p) => p.periodId !== undefined);
  const onDate = (departmentId: string, date: string): Placement[] => {
    const named = calendar.find(
      (day) =>
        day.date === date ||
        (day.repeatOn !== null && day.repeatOn === date.slice(5) && day.date <= date),
    );
    if (named?.closeWholeVenue) return [];
    if (
      named?.ownHours &&
      timetables.some((t) => t.departmentId === departmentId && t.specialDateId === named.id)
    )
      return allPeriods.filter(
        (row) => row.departmentId === departmentId && row.specialDateId === named.id,
      );
    const seasonId = seasonOf(date),
      weekday = weekdayOf(date);
    return allPeriods.filter(
      (row) =>
        row.departmentId === departmentId && row.seasonId === seasonId && row.weekday === weekday,
    );
  };
  const nextPlacements = (p: Placement): Placement[] => {
    if (p.date !== null) {
      const dates = p.repeatOn === null ? [p.date] : annualDates(p.date, p.repeatOn);
      return dates.flatMap((date) => onDate(p.departmentId, addDays(date, 1)));
    }
    // A season's last day is followed by the next season's first.
    const following = new Set([p.seasonId, nextSeason(p.seasonId!)]);
    const normal = allPeriods.filter(
      (other) =>
        other.departmentId === p.departmentId &&
        other.seasonId !== null &&
        following.has(other.seasonId) &&
        other.weekday === (p.weekday! + 1) % 7,
    );
    const overrides = namedOccurrences
      .filter(
        (date) =>
          weekdayOf(addDays(date, -1)) === p.weekday && seasonOf(addDays(date, -1)) === p.seasonId,
      )
      .flatMap((date) => onDate(p.departmentId, date));
    return [...normal, ...overrides];
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
          departmentName: p.departmentName,
          ...(p.zoneName === undefined ? {} : { zoneName: p.zoneName }),
          ...(p.periodName === undefined ? {} : { periodName: p.periodName }),
          ...(p.specialDateName === null ? {} : { specialDateName: p.specialDateName }),
          startsAt,
          endsAt,
          ...(p.zoneId === undefined ? {} : { zoneId: p.zoneId }),
          ...(p.weekday === null ? {} : { weekday: p.weekday }),
          ...(p.seasonId === null ? {} : { seasonId: p.seasonId }),
          ...(p.specialDateId === null ? {} : { specialDateId: p.specialDateId }),
          ...(p.date === null ? {} : { date: p.date }),
          ...(p.periodId === undefined ? {} : { periodId: p.periodId }),
          rangeIndex,
          reason,
        });
    }
  }
  // The cap and the count are of distinct conflicts once `seasonId` is set aside; the same range at
  // another position in another season counts again.
  const rangeKey = (conflict: BusinessDayClockConflict) =>
    JSON.stringify({ ...conflict, seasonId: undefined });
  const keys = conflicts.map(rangeKey);
  const ranges = [...new Set(keys)];
  const listed = new Set(ranges.slice(0, 20));
  return {
    conflicts: conflicts.filter((_, index) => listed.has(keys[index]!)),
    conflictCount: ranges.length,
  };
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
