import { scheduleCutovers, serviceDayContext } from "./service-day-context.js";
import { assertBusinessDayScheduleWrite, sameScheduleRanges } from "./business-day-schedule.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { floorZones, type Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError, type BusinessDayClock } from "@waitron/shared";
import { resolveZoneContext, wireTime, type VenueScope } from "./operations.js";
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
  seasonWeekList,
  seasonsHolding,
  targetSeasons,
  writeZoneSeasonWeeks,
} from "./season-weeks.js";
import type { Season } from "./season-rules.js";
import { readSeasons } from "./seasons.js";
import { zoneExtensions } from "./schema/zone-extensions.js";
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
  const changed = targets.some((season) =>
    seasonWeek.some(
      (ranges, weekday) =>
        !sameScheduleRanges(
          joinTouching(seasonsNow?.get(season.id)?.[weekday] ?? [], () => true),
          ranges,
        ),
    ),
  );
  await assertBusinessDayScheduleWrite(
    tx,
    cfg,
    changed ? "time" : "metadata",
    at,
    expectedClockRevision,
    clock,
  );
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

export async function readZoneClosedTimes(
  tx: Transaction,
  cfg: VenueScope,
  cutover: string,
  venueSeasons?: readonly Season[],
) {
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
  const seasonList = venueSeasons ?? (await readSeasons(tx, cfg));
  const stored = await readZoneSeasonWeeks(
    tx,
    cfg,
    zones.map((zone) => zone.id),
    cutover,
  );
  const days = (week: ClosedRange[][]) => week.map((ranges, weekday) => ({ weekday, ranges }));
  return zones.map((zone) => {
    const seasonWeeks = seasonWeekList(seasonList, stored.get(zone.id));
    return {
      ...zone,
      seasonWeeks: seasonWeeks.map((entry) => ({
        seasonId: entry.seasonId,
        week: days(entry.week),
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

export async function zoneClosureDay(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  at: Date,
  prepared?: { clock: BusinessDayClock; plan?: DayPlan },
) {
  const { zones, ...day } = await zoneClosureDays(tx, cfg, [zoneId], at, prepared);
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
