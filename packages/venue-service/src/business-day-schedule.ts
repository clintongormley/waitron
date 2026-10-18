import type { BusinessDayScheduleStatus } from "./service-day-context.js";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
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
import { menuPeriods } from "./schema/menus.js";
import { departments, zoneServicePolicies } from "./schema/service.js";
import {
  departmentDayRanges,
  departmentDays,
  seasons,
  specialDayDates,
  specialDays,
  zoneDayRanges,
  zoneDays,
} from "./schema/seasons.js";
import { seasonOnSorted } from "./season-rules.js";
import { addDays, weekdayOf } from "./hours-rules.js";
import { layerPaint, type PaintRange } from "./day-paint.js";
import {
  holidayDatesFor,
  holidayHorizon,
  specialDateIn,
  specialDatesStandingIn,
} from "./special-days.js";
import {
  minuteOfServiceDay,
  parseClosedRanges,
  rangeSpan,
  type ClosedRange,
} from "./service-day.js";
import { serviceDayWallContext, settledClock } from "./service-day-context.js";
import { periodExtensions } from "./schema/period-extensions.js";
import { zoneExtensions } from "./schema/zone-extensions.js";
import "./errors.js";

export type { BusinessDayClockConflict } from "@waitron/module";
const minutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
interface Placement {
  departmentId: string;
  departmentName: string;
  zoneName?: string;
  periodName?: string;
  zoneId?: string;
  weekday: number | null;
  seasonId: string | null;
  specialDayId: string | null;
  specialDayName: string | null;
  specialDayDateId: string | null;
  date: string | null;
  repeats: boolean;
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
  const specialDayList = await tx
    .select({
      dateId: specialDayDates.id,
      specialDayId: specialDays.id,
      name: specialDays.name,
      date: specialDayDates.date,
      repeats: specialDays.repeatsYearly,
      holidayName: specialDayDates.holidayName,
      closedAllDay: specialDayDates.closedAllDay,
    })
    .from(specialDayDates)
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))
    .where(eq(specialDayDates.locationId, cfg.locationId))
    .orderBy(asc(specialDayDates.date), asc(specialDayDates.id));
  // Closed paint (no period) and zone paint of either kind count as ranges with no grace.
  const specialPaint = await tx
    .select({
      dateId: departmentDays.specialDayDateId,
      departmentId: departmentDays.departmentId,
      departmentName: departments.name,
      zoneId: sql<string | null>`null`,
      zoneName: sql<string | null>`null`,
      periodId: departmentDayRanges.periodId,
      periodName: menuPeriods.name,
      offset: menuPeriods.endOffsetMinutes,
      startsAt: departmentDayRanges.startsAt,
      endsAt: departmentDayRanges.endsAt,
    })
    .from(departmentDayRanges)
    .innerJoin(departmentDays, eq(departmentDays.id, departmentDayRanges.dayId))
    .innerJoin(departments, eq(departments.id, departmentDays.departmentId))
    .leftJoin(menuPeriods, eq(menuPeriods.id, departmentDayRanges.periodId))
    .where(
      and(eq(departments.locationId, cfg.locationId), isNotNull(departmentDays.specialDayDateId)),
    )
    .unionAll(
      tx
        .select({
          dateId: zoneDays.specialDayDateId,
          departmentId: zoneServicePolicies.departmentId,
          departmentName: departments.name,
          zoneId: zoneDays.zoneId,
          zoneName: floorZones.name,
          periodId: sql<string | null>`null`,
          periodName: sql<string | null>`null`,
          offset: sql<number | null>`null`,
          startsAt: zoneDayRanges.startsAt,
          endsAt: zoneDayRanges.endsAt,
        })
        .from(zoneDayRanges)
        .innerJoin(zoneDays, eq(zoneDays.id, zoneDayRanges.dayId))
        .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, zoneDays.zoneId))
        .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
        .innerJoin(floorZones, eq(floorZones.id, zoneDays.zoneId))
        .where(
          and(
            eq(zoneServicePolicies.locationId, cfg.locationId),
            isNotNull(zoneDays.specialDayDateId),
          ),
        ),
    );
  const effectiveYear = Number(effectiveBusinessDay.slice(0, 4));
  const holidays = await holidayDatesFor(
    tx,
    cfg,
    specialDayList,
    holidayHorizon(specialDayList, effectiveYear),
  );
  const specialDayOf = new Map(specialDayList.map((day) => [day.dateId, day]));
  const specialPlacements: Placement[] = specialPaint.flatMap((row) => {
    const day = specialDayOf.get(row.dateId!);
    if (day === undefined) return [];
    return [
      {
        departmentId: row.departmentId,
        departmentName: row.departmentName,
        ...(row.zoneId === null ? {} : { zoneId: row.zoneId, zoneName: row.zoneName! }),
        ...(row.periodId === null ? {} : { periodId: row.periodId, periodName: row.periodName! }),
        specialDayId: day.specialDayId,
        specialDayName: day.name,
        specialDayDateId: day.dateId,
        weekday: null,
        seasonId: null,
        date: day.date,
        repeats: day.repeats,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        offset: row.offset ?? 0,
      },
    ];
  });
  const seasonList = await tx
    .select({ id: seasons.id, name: seasons.name, startsOn: seasons.startsOn })
    .from(seasons)
    .where(eq(seasons.locationId, cfg.locationId))
    .orderBy(asc(seasons.startsOn));
  const seasonById = new Map<string | null, { index: number; name: string }>(
    seasonList.map((season, index) => [season.id, { index, name: season.name }]),
  );
  const seasonOf = (date: string) => seasonOnSorted(seasonList, date)?.id ?? null;
  const nextSeason = (seasonId: string) =>
    seasonList[((seasonById.get(seasonId)?.index ?? -1) + 1) % seasonList.length]!.id;
  const noSpecialDay = { specialDayId: null, specialDayName: null, specialDayDateId: null };
  const undated = { date: null, repeats: false, ...noSpecialDay };
  const periods: Placement[] = seasonPeriods.map((row) => ({ ...row, ...undated }));
  const closures: Omit<Placement, "offset">[] = seasonClosures.map((row) => ({
    ...row,
    ...undated,
  }));
  const oneOffYears = new Set(
    specialDayList.flatMap((day) =>
      !day.repeats && day.date >= effectiveBusinessDay ? [Number(day.date.slice(0, 4))] : [],
    ),
  );
  const yearsFrom = new Map<number, number[]>();
  const walkedYears = (date: string): number[] => {
    const firstYear = Math.max(Number(date.slice(0, 4)), Number(effectiveBusinessDay.slice(0, 4)));
    let years = yearsFrom.get(firstYear);
    if (years === undefined) {
      const walked = new Set(
        Array.from({ length: Math.min(400, 10000 - firstYear) }, (_, i) => firstYear + i),
      );
      for (const year of oneOffYears) walked.add(year);
      years = [...walked];
      yearsFrom.set(firstYear, years);
    }
    return years;
  };
  const fromDay = addDays(effectiveBusinessDay, -1);
  const specialDatesOf = new Map(
    specialDayList.map((day) => [
      day.dateId,
      day.repeats
        ? walkedYears(day.date).flatMap((year) => {
            const date = specialDateIn(day, year, holidays);
            return date !== null && date >= fromDay ? [date] : [];
          })
        : [day.date],
    ]),
  );
  const specialOccurrences = [...specialDatesOf.values()].flat();
  const groups = new Map<string, Placement[]>();
  for (const placement of [
    ...periods,
    ...closures.map((row) => ({ ...row, offset: 0 })),
    ...specialPlacements,
  ]) {
    if (
      placement.date !== null &&
      !placement.repeats &&
      placement.date < addDays(effectiveBusinessDay, -1)
    )
      continue;
    // A season's position in the venue's order leads its key, so the sorted groups list seasons by `startsOn`.
    const season = `${String(seasonById.get(placement.seasonId)?.index ?? -1).padStart(4, "0")}:${placement.seasonId}`;
    const day =
      placement.specialDayDateId === null
        ? `${season}:${placement.weekday}`
        : `special:${placement.specialDayDateId}`;
    const key = `${placement.departmentId}/${placement.zoneId ?? ""}/${day}`;
    groups.set(key, [...(groups.get(key) ?? []), placement]);
  }
  const conflicts: BusinessDayClockConflict[] = [];
  const allPeriods = [...groups.values()].flat().filter((p) => p.periodId !== undefined);
  const periodsOn = new Map<string, Placement[]>();
  for (const row of allPeriods) {
    const key = `${row.departmentId}|season:${row.seasonId}|${row.weekday}`;
    periodsOn.set(key, [...(periodsOn.get(key) ?? []), row]);
  }
  const seasonPeriodsOn = (departmentId: string, seasonId: string | null, weekday: number) =>
    seasonId === null ? [] : (periodsOn.get(`${departmentId}|season:${seasonId}|${weekday}`) ?? []);
  const standingByYear = new Map<number, Map<string, (typeof specialDayList)[number]>>();
  const specialOn = (date: string) => {
    const year = Number(date.slice(0, 4));
    let standing = standingByYear.get(year);
    if (standing === undefined) {
      standing = specialDatesStandingIn(specialDayList, year, holidays);
      standingByYear.set(year, standing);
    }
    return standing.get(date);
  };
  // `cutoverForBusinessDay` validates the clock and the day on every call; here the clock is validated once.
  let validated = false;
  const oldCutoverOn = (date: string) => {
    if (!validated) cutoverForBusinessDay(before, date);
    validated = true;
    let cutover = before.dayCutover;
    for (const change of before.cutoverChanges) {
      if (change.effectiveBusinessDay > date) break;
      cutover = change.dayCutover;
    }
    return cutover;
  };
  const departmentPaintOn = new Map<string, PaintRange[]>();
  for (const row of specialPlacements) {
    if (row.zoneId !== undefined) continue;
    const key = `${row.departmentId}|${row.specialDayDateId}`;
    const paint = departmentPaintOn.get(key) ?? [];
    paint.push({ periodId: row.periodId ?? null, startsAt: row.startsAt, endsAt: row.endsAt });
    departmentPaintOn.set(key, paint);
  }
  const layered = new Map<string, ClosedRange[]>();
  const dayRanges = new Map<string, ClosedRange[]>();
  const onDate = (departmentId: string, date: string): ClosedRange[] => {
    const key = `${departmentId}|${date}`;
    const found = dayRanges.get(key) ?? rangesOn(departmentId, date);
    dayRanges.set(key, found);
    return found;
  };
  const rangesOn = (departmentId: string, date: string): ClosedRange[] => {
    const special = specialOn(date);
    if (special !== undefined) {
      if (special.closedAllDay) return [];
      const seasonId = seasonOf(date),
        weekday = weekdayOf(date);
      const cutover = oldCutoverOn(date);
      const key = `${departmentId}|${special.dateId}|${seasonId}|${weekday}|${cutover}`;
      const found = layered.get(key);
      if (found !== undefined) return found;
      const season = seasonPeriodsOn(departmentId, seasonId, weekday).map((row) => ({
        periodId: row.periodId!,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      }));
      const paint = departmentPaintOn.get(`${departmentId}|${special.dateId}`) ?? [];
      const day = layerPaint(season, paint, cutover);
      layered.set(key, day);
      return day;
    }
    return seasonPeriodsOn(departmentId, seasonOf(date), weekdayOf(date));
  };
  const overridesAfter = new Map<string, string[]>();
  for (const date of specialOccurrences) {
    const dayBefore = addDays(date, -1);
    const key = `${seasonOf(dayBefore)}|${weekdayOf(dayBefore)}`;
    const dates = overridesAfter.get(key) ?? [];
    dates.push(date);
    overridesAfter.set(key, dates);
  }
  const nextPlacements = (p: Placement): ClosedRange[] => {
    if (p.specialDayDateId !== null)
      return specialDatesOf
        .get(p.specialDayDateId)!
        .flatMap((date) => onDate(p.departmentId, addDays(date, 1)));
    // A season's last day is followed by the next season's first.
    const following = new Set([p.seasonId, nextSeason(p.seasonId!)]);
    const normal = [...following].flatMap((seasonId) =>
      seasonPeriodsOn(p.departmentId, seasonId, (p.weekday! + 1) % 7),
    );
    const overrides = (overridesAfter.get(`${p.seasonId}|${p.weekday}`) ?? []).flatMap((date) =>
      onDate(p.departmentId, date),
    );
    return [...normal, ...overrides];
  };
  // The earliest start among a placement's next days, per changeover; placements of one day share it.
  const earliest = new Map<string, number>();
  const earliestTomorrow = (p: Placement, cutover: string): number => {
    const key = `${p.departmentId}|${p.specialDayDateId ?? `${p.seasonId}:${p.weekday}`}|${p.date}|${cutover}`;
    const found =
      earliest.get(key) ??
      nextPlacements(p).reduce(
        (soonest, next) => Math.min(soonest, 1440 + rangeSpan(next, cutover).start),
        Infinity,
      );
    earliest.set(key, found);
    return found;
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
    const parses = (group: Placement[]) =>
      [oldCutover, newCutover].every((cutover) => {
        try {
          parseClosedRanges(
            group.map((p) => ({ startsAt: p.startsAt.slice(0, 5), endsAt: p.endsAt.slice(0, 5) })),
            "ranges",
            cutover,
          );
          return true;
        } catch {
          return false;
        }
      });
    const together = parses(placements);
    const crossing = together
      ? new Set<Placement>()
      : new Set(placements.filter((p) => !parses([p])));
    const overlapping = !together && crossing.size === 0;
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
            .filter((next) => !crossing.has(next))
            .map((next) => rangeSpan(next, cutover).start);
          return [...later, earliestTomorrow(p, cutover)].some(
            (next) => span.end + p.offset >= next,
          );
        });
      let reason: BusinessDayClockConflict["reason"] | null = null;
      if (startsAt === endsAt) reason = "all_day";
      else if (overlapping) reason = "overlap";
      else if (crossing.has(p)) reason = "range";
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
      const seasonName = seasonById.get(p.seasonId)?.name;
      if (reason !== null)
        conflicts.push({
          departmentId: p.departmentId,
          departmentName: p.departmentName,
          ...(p.zoneName === undefined ? {} : { zoneName: p.zoneName }),
          ...(p.periodName === undefined ? {} : { periodName: p.periodName }),
          startsAt,
          endsAt,
          ...(p.zoneId === undefined ? {} : { zoneId: p.zoneId }),
          ...(p.weekday === null ? {} : { weekday: p.weekday }),
          ...(p.seasonId === null ? {} : { seasonId: p.seasonId }),
          ...(seasonName === undefined ? {} : { seasonName }),
          ...(p.specialDayId === null
            ? {}
            : { specialDayId: p.specialDayId, specialDayName: p.specialDayName! }),
          ...(p.date === null ? {} : { date: p.date }),
          ...(p.periodId === undefined ? {} : { periodId: p.periodId }),
          rangeIndex,
          reason,
        });
    }
  }
  // The cap and the count are of distinct conflicts once the season is set aside; the same range at
  // another position in another season counts again.
  const rangeKey = (conflict: BusinessDayClockConflict) =>
    JSON.stringify({ ...conflict, seasonId: undefined, seasonName: undefined });
  const keys = conflicts.map(rangeKey);
  const ranges = [...new Set(keys)];
  const listed = new Set(ranges.slice(0, 20));
  return {
    conflicts: conflicts.filter((_, index) => listed.has(keys[index]!)),
    conflictCount: ranges.length,
  };
}
/** A keep-open saved for the night before the change runs under the old changeover. */
export async function keptOpenConflicts(
  tx: Transaction,
  cfg: VenueScope,
  before: BusinessDayClock,
  candidate: BusinessDayClock,
  effectiveBusinessDay: string,
): Promise<BusinessDayClockConflict[]> {
  const tonight = addDays(effectiveBusinessDay, -1);
  const periods = await tx
    .select({
      departmentId: periodExtensions.departmentId,
      departmentName: departments.name,
      periodId: periodExtensions.periodId,
      periodName: menuPeriods.name,
      endsAt: periodExtensions.endsAt,
    })
    .from(periodExtensions)
    .innerJoin(departments, eq(departments.id, periodExtensions.departmentId))
    .innerJoin(menuPeriods, eq(menuPeriods.id, periodExtensions.periodId))
    .where(
      and(eq(departments.locationId, cfg.locationId), eq(periodExtensions.businessDay, tonight)),
    )
    .orderBy(asc(periodExtensions.id));
  const zones = await tx
    .select({
      departmentId: zoneServicePolicies.departmentId,
      departmentName: departments.name,
      zoneId: zoneExtensions.zoneId,
      zoneName: floorZones.name,
      endsAt: zoneExtensions.endsAt,
    })
    .from(zoneExtensions)
    .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, zoneExtensions.zoneId))
    .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .innerJoin(floorZones, eq(floorZones.id, zoneExtensions.zoneId))
    .where(
      and(
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(zoneExtensions.businessDay, tonight),
      ),
    )
    .orderBy(asc(zoneExtensions.id));
  const oldCutover = cutoverForBusinessDay(before, tonight);
  const newEnd = serviceDayWallContext(candidate, tonight).endMinute;
  return [...periods, ...zones]
    .filter((row) => (minuteOfServiceDay(row.endsAt, oldCutover) || 1440) > newEnd)
    .map((row) => ({
      ...row,
      endsAt: row.endsAt.slice(0, 5),
      rangeIndex: 0,
      reason: "kept_open" as const,
    }));
}
export async function assertBusinessDayClockChange(
  tx: Transaction,
  cfg: VenueScope,
  before: BusinessDayClock,
  candidate: BusinessDayClock,
  effectiveBusinessDay: string,
): Promise<void> {
  const result = await businessDayClockConflicts(tx, cfg, before, candidate, effectiveBusinessDay);
  const keptOpen = await keptOpenConflicts(tx, cfg, before, candidate, effectiveBusinessDay);
  const conflictCount = result.conflictCount + keptOpen.length;
  if (conflictCount > 0)
    throw new AppError("venue.business_day_hours_conflict", {
      conflicts: [...result.conflicts, ...keptOpen],
      conflictCount,
    });
}
export async function assertBusinessDayScheduleWrite(
  tx: Transaction,
  cfg: VenueScope,
  changeKind: "time" | "metadata",
  _at: Date,
  expectedClockRevision: number,
): Promise<void> {
  if (changeKind === "metadata") return;
  const revision = await readBusinessDayScheduleRevision(tx, cfg);
  if (
    !Number.isSafeInteger(expectedClockRevision) ||
    expectedClockRevision < 0 ||
    expectedClockRevision !== revision
  )
    throw new AppError("hours.clock_changed", {});
}
/** Checks the venue's hours, as written, against each change still waiting at `at`, in date
 *  order, each under the starts before it. */
export async function assertWaitingChangeFits(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
  acquiredClock?: BusinessDayClock,
): Promise<void> {
  const clock = acquiredClock ?? (await readLocationClock(tx, cfg.locationId));
  let settled = settledClock(clock, at);
  const waiting = clock.cutoverChanges
    .filter((change) => !settled.cutoverChanges.includes(change))
    .sort((a, b) => a.effectiveBusinessDay.localeCompare(b.effectiveBusinessDay));
  for (const change of waiting) {
    const next = { ...settled, cutoverChanges: [...settled.cutoverChanges, change] };
    const result = await businessDayClockConflicts(
      tx,
      cfg,
      settled,
      next,
      change.effectiveBusinessDay,
    );
    if (result.conflictCount > 0)
      throw new AppError("hours.clock_change_conflict", {
        dayCutover: change.dayCutover,
        startsAt: businessDayBoundaryAt(clock, change.effectiveBusinessDay),
        ...result,
      });
    settled = next;
  }
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
  if (change !== undefined)
    pending = { ...change, startsAt: businessDayBoundaryAt(clock, change.effectiveBusinessDay) };
  return { businessDayClock: clock, clockRevision, currentBusinessDay, pending };
}
