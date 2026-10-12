import { scheduleCutovers, serviceDayContext } from "./service-day-context.js";
import { assertBusinessDayScheduleWrite, sameScheduleRanges } from "./business-day-schedule.js";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { floorZones, type Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError, type BusinessDayClock } from "@waitron/shared";
import { resolveZoneContext, storedTime, wireTime, type VenueScope } from "./operations.js";
import {
  parseClosedRanges,
  type ClosedRange,
  rangeSpan,
  rangeSpanInDay,
  serviceMomentAt,
} from "./service-day.js";
import { resolveZoneClosedDays, type DayPlan } from "./day-resolver.js";
import {
  joinTouching,
  readZoneSeasonWeeks,
  seasonsHolding,
  targetSeasons,
  writeZoneSeasonWeeks,
} from "./season-weeks.js";
import { specialDates } from "./schema/hours.js";
import { zoneExtensions } from "./schema/zone-extensions.js";
import { zoneClosedTimes } from "./schema/zone-closed-times.js";
import { departments, zoneServicePolicies } from "./schema/service.js";
import "./errors.js";

export async function replaceZoneClosedWeek(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  days: unknown,
  expectedClockRevision: number,
  at: Date = new Date(),
  options: { seasonId?: string } = {},
): Promise<void> {
  await resolveZoneContext(tx, cfg, zoneId);
  const clock = await readLocationClock(tx, cfg.locationId);
  if (!Array.isArray(days) || days.length !== 7)
    throw new AppError("zone_closed_time.invalid", { field: "days" });
  const week = new Map<number, ClosedRange[]>();
  for (const [index, entry] of days.entries()) {
    if (typeof entry !== "object" || entry === null)
      throw new AppError("zone_closed_time.invalid", { field: `days.${index}` });
    const { weekday, ranges } = entry as Record<string, unknown>;
    if (
      typeof weekday !== "number" ||
      !Number.isInteger(weekday) ||
      weekday < 0 ||
      weekday > 6 ||
      week.has(weekday)
    )
      throw new AppError("zone_closed_time.invalid", { field: `days.${index}.weekday` });
    const parsed = scheduleCutovers(clock).map((cutover) =>
      parseClosedRanges(ranges, `days.${index}.ranges`, cutover),
    );
    week.set(weekday, parsed[0]!);
  }
  const targets = await targetSeasons(tx, cfg, options.seasonId);
  const seasonWeek = [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
    joinTouching(week.get(weekday)!, () => true),
  );
  const seasonsNow = (await readZoneSeasonWeeks(tx, cfg, [zoneId], clock.dayCutover)).get(zoneId);
  let changed = targets.some((season) =>
    seasonWeek.some(
      (ranges, weekday) =>
        !sameScheduleRanges(
          joinTouching(seasonsNow?.get(season.id)?.[weekday] ?? [], () => true),
          ranges,
        ),
    ),
  );
  if (!changed && options.seasonId === undefined) {
    const current = await tx
      .select()
      .from(zoneClosedTimes)
      .where(and(eq(zoneClosedTimes.zoneId, zoneId), isNotNull(zoneClosedTimes.weekday)));
    changed = [...week].some(
      ([weekday, ranges]) =>
        !sameScheduleRanges(
          current.filter((row) => row.weekday === weekday),
          ranges,
        ),
    );
  }
  await assertBusinessDayScheduleWrite(
    tx,
    cfg,
    changed ? "time" : "metadata",
    at,
    expectedClockRevision,
    clock,
  );
  if (options.seasonId === undefined) {
    await tx
      .delete(zoneClosedTimes)
      .where(and(eq(zoneClosedTimes.zoneId, zoneId), isNotNull(zoneClosedTimes.weekday)));
    for (const [weekday, ranges] of week) {
      if (ranges.length > 0)
        await tx.insert(zoneClosedTimes).values(
          ranges.map((range) => ({
            zoneId,
            weekday,
            startsAt: storedTime(range.startsAt),
            endsAt: storedTime(range.endsAt),
          })),
        );
    }
  }
  const holding = seasonsHolding(
    seasonsNow,
    targets.map((season) => season.id),
    seasonWeek,
  );
  await writeZoneSeasonWeeks(
    tx,
    zoneId,
    targets.flatMap((season) => (holding.has(season.id) ? [] : [season.id])),
    seasonWeek,
  );
}

export async function saveZoneClosedDate(
  tx: Transaction,
  cfg: VenueScope,
  specialDateId: string,
  zoneId: string,
  ranges: unknown,
  expectedClockRevision: number,
  at: Date = new Date(),
): Promise<void> {
  await resolveZoneContext(tx, cfg, zoneId);
  const [day] = await tx
    .select({
      ownHours: specialDates.ownHours,
      date: specialDates.date,
      repeatOn: specialDates.repeatOn,
    })
    .from(specialDates)
    .where(and(eq(specialDates.id, specialDateId), eq(specialDates.locationId, cfg.locationId)));
  if (day === undefined) throw new AppError("special_date.not_found", { specialDateId });
  if (!day.ownHours) throw new AppError("special_date.keeps_week", { specialDateId });
  const clock = await readLocationClock(tx, cfg.locationId);
  const cutovers = scheduleCutovers(clock, day.repeatOn === null ? day.date : undefined);
  const parsed = cutovers.map((cutover) => parseClosedRanges(ranges, "ranges", cutover))[0]!;
  const current = await tx
    .select()
    .from(zoneClosedTimes)
    .where(
      and(eq(zoneClosedTimes.zoneId, zoneId), eq(zoneClosedTimes.specialDateId, specialDateId)),
    );
  await assertBusinessDayScheduleWrite(
    tx,
    cfg,
    sameScheduleRanges(current, parsed) ? "metadata" : "time",
    at,
    expectedClockRevision,
    clock,
  );
  await tx
    .delete(zoneClosedTimes)
    .where(
      and(eq(zoneClosedTimes.zoneId, zoneId), eq(zoneClosedTimes.specialDateId, specialDateId)),
    );
  if (parsed.length > 0)
    await tx.insert(zoneClosedTimes).values(
      parsed.map((range) => ({
        zoneId,
        specialDateId,
        startsAt: storedTime(range.startsAt),
        endsAt: storedTime(range.endsAt),
      })),
    );
}

export async function readZoneClosedTimes(tx: Transaction, cfg: VenueScope, cutover: string) {
  const zones = await tx
    .select({
      id: floorZones.id,
      name: floorZones.name,
      departmentId: zoneServicePolicies.departmentId,
    })
    .from(floorZones)
    .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, floorZones.id))
    .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .where(
      and(
        eq(floorZones.locationId, cfg.locationId),
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(floorZones.active, true),
        eq(departments.active, true),
      ),
    )
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.id));
  const rows = await tx
    .select({
      zoneId: zoneClosedTimes.zoneId,
      weekday: zoneClosedTimes.weekday,
      specialDateId: zoneClosedTimes.specialDateId,
      startsAt: zoneClosedTimes.startsAt,
      endsAt: zoneClosedTimes.endsAt,
    })
    .from(zoneClosedTimes)
    .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, zoneClosedTimes.zoneId))
    .where(eq(zoneServicePolicies.locationId, cfg.locationId));
  const ranges = (values: typeof rows): ClosedRange[] =>
    values
      .map((row) => ({ startsAt: row.startsAt.slice(0, 5), endsAt: row.endsAt.slice(0, 5) }))
      .sort((a, b) => rangeSpan(a, cutover).start - rangeSpan(b, cutover).start);
  return zones.map((zone) => {
    const own = rows.filter((row) => row.zoneId === zone.id);
    return {
      ...zone,
      week: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        ranges: ranges(own.filter((row) => row.weekday === weekday)),
      })),
      dates: [
        ...new Set(own.flatMap((row) => (row.specialDateId === null ? [] : [row.specialDateId]))),
      ]
        .sort()
        .map((specialDateId) => ({
          specialDateId,
          ranges: ranges(own.filter((row) => row.specialDateId === specialDateId)),
        })),
    };
  });
}

export function withoutZoneExtension(
  ranges: readonly ClosedRange[],
  extension: ClosedRange | null,
  cutover: string,
): ClosedRange[] {
  if (extension === null) return [...ranges];
  const extended = rangeSpan(extension, cutover);
  return ranges.flatMap((range) => {
    const span = rangeSpan(range, cutover);
    if (span.end <= extended.start || span.start >= extended.end) return [range];
    return [
      ...(span.start < extended.start
        ? [{ startsAt: range.startsAt, endsAt: extension.startsAt }]
        : []),
      ...(span.end > extended.end ? [{ startsAt: extension.endsAt, endsAt: range.endsAt }] : []),
    ];
  });
}

export function zoneExtensionForRange(
  extension: ClosedRange | null,
  closure: ClosedRange,
  cutover: string,
): ClosedRange | null {
  if (extension === null) return null;
  const span = rangeSpan(extension, cutover);
  const closed = rangeSpan(closure, cutover);
  return span.start < closed.end && span.end > closed.start ? extension : null;
}

export interface ZoneClosure {
  ranges: ClosedRange[];
  extension: ClosedRange | null;
}

/** Each zone's closures and saved extension on the business day `at` falls in, read once for
 *  every zone named, or every service zone when none are. */
export async function zoneClosureDays(
  tx: Transaction,
  cfg: VenueScope,
  zoneIds: readonly string[] | undefined,
  at: Date,
  prepared?: { clock: BusinessDayClock; plan?: DayPlan },
) {
  const clock = prepared?.clock ?? (await readLocationClock(tx, cfg.locationId));
  const moment = serviceMomentAt(at, clock);
  const zones = new Map<string, ZoneClosure>();
  if (moment === null) return { clock, moment, dayContext: null, cutover: clock.dayCutover, zones };
  const dayContext = serviceDayContext(clock, moment.businessDay);
  const closures = await resolveZoneClosedDays(
    tx,
    cfg,
    zoneIds,
    [moment.businessDay],
    clock,
    prepared?.plan,
  );
  const extensions =
    closures.size === 0
      ? []
      : await tx
          .select({
            zoneId: zoneExtensions.zoneId,
            startsAt: zoneExtensions.startsAt,
            endsAt: zoneExtensions.endsAt,
          })
          .from(zoneExtensions)
          .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, zoneExtensions.zoneId))
          .where(
            and(
              eq(zoneServicePolicies.locationId, cfg.locationId),
              eq(zoneExtensions.businessDay, moment.businessDay),
              zoneIds === undefined ? undefined : inArray(zoneExtensions.zoneId, [...zoneIds]),
            ),
          );
  for (const [zoneId, days] of closures) {
    const extension = extensions.find((entry) => entry.zoneId === zoneId);
    zones.set(zoneId, {
      ranges: days.get(moment.businessDay) ?? [],
      extension:
        extension === undefined
          ? null
          : { startsAt: wireTime(extension.startsAt), endsAt: wireTime(extension.endsAt) },
    });
  }
  return { clock, moment, dayContext, cutover: dayContext.dayCutover, zones };
}

export type ZoneClosureDays = Awaited<ReturnType<typeof zoneClosureDays>>;

export async function zoneClosureDay(tx: Transaction, cfg: VenueScope, zoneId: string, at: Date) {
  const { zones, ...day } = await zoneClosureDays(tx, cfg, [zoneId], at);
  return {
    ...day,
    ranges: zones.get(zoneId)?.ranges ?? [],
    extension: zones.get(zoneId)?.extension ?? null,
  };
}

export function closedZoneIdsIn(days: ZoneClosureDays): ReadonlySet<string> {
  const closed = new Set<string>();
  if (days.moment === null) return closed;
  for (const [zoneId, { ranges, extension }] of days.zones)
    for (const range of withoutZoneExtension(ranges, extension, days.cutover)) {
      const { start, end } = rangeSpanInDay(range, days.dayContext);
      if (start <= days.moment.minute && days.moment.minute < end) closed.add(zoneId);
    }
  return closed;
}

export async function closedZoneIdsAt(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
  zoneIds?: readonly string[],
): Promise<ReadonlySet<string>> {
  if (zoneIds?.length === 0) return new Set();
  return closedZoneIdsIn(await zoneClosureDays(tx, cfg, zoneIds, at));
}

export async function assertZoneTakesNewOrders(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  at: Date,
): Promise<void> {
  if ((await closedZoneIdsAt(tx, cfg, at, [zoneId])).has(zoneId))
    throw new AppError("service_zone.closed", { zoneId });
}
