import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { floorZones, type Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { resolveZoneContext, storedTime, type VenueScope } from "./operations.js";
import { parseClosedRanges, type ClosedRange, rangeSpan, serviceMomentAt } from "./service-day.js";
import { namedDaysOn } from "./named-days.js";
import { specialDates } from "./schema/hours.js";
import { zoneExtensions } from "./schema/zone-extensions.js";
import { zoneClosedTimes } from "./schema/zone-closed-times.js";
import { zoneServicePolicies } from "./schema/service.js";
import "./errors.js";

export async function replaceZoneClosedWeek(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  days: unknown,
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
    week.set(weekday, parseClosedRanges(ranges, `days.${index}.ranges`, clock.dayCutover));
  }
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

export async function saveZoneClosedDate(
  tx: Transaction,
  cfg: VenueScope,
  specialDateId: string,
  zoneId: string,
  ranges: unknown,
): Promise<void> {
  await resolveZoneContext(tx, cfg, zoneId);
  const [day] = await tx
    .select({ ownHours: specialDates.ownHours })
    .from(specialDates)
    .where(and(eq(specialDates.id, specialDateId), eq(specialDates.locationId, cfg.locationId)));
  if (day === undefined) throw new AppError("special_date.not_found", { specialDateId });
  if (!day.ownHours) throw new AppError("special_date.keeps_week", { specialDateId });
  const clock = await readLocationClock(tx, cfg.locationId);
  const parsed = parseClosedRanges(ranges, "ranges", clock.dayCutover);
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
    .where(
      and(
        eq(floorZones.locationId, cfg.locationId),
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(floorZones.active, true),
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

export async function zoneClosureDay(tx: Transaction, cfg: VenueScope, zoneId: string, at: Date) {
  const clock = await readLocationClock(tx, cfg.locationId);
  const moment = serviceMomentAt(at, clock);
  if (moment === null) return { clock, moment, ranges: [], extension: null };
  const day = (await namedDaysOn(tx, cfg, [moment.businessDay])).get(moment.businessDay);
  const rows = day?.closeWholeVenue
    ? []
    : await tx
        .select({
          startsAt: zoneClosedTimes.startsAt,
          endsAt: zoneClosedTimes.endsAt,
        })
        .from(zoneClosedTimes)
        .where(
          and(
            eq(zoneClosedTimes.zoneId, zoneId),
            day?.ownHours
              ? eq(zoneClosedTimes.specialDateId, day.id)
              : eq(zoneClosedTimes.weekday, moment.weekday),
          ),
        );
  const [row] = await tx
    .select({ startsAt: zoneExtensions.startsAt, endsAt: zoneExtensions.endsAt })
    .from(zoneExtensions)
    .where(
      and(eq(zoneExtensions.zoneId, zoneId), eq(zoneExtensions.businessDay, moment.businessDay)),
    );
  const wire = (range: ClosedRange) => ({
    startsAt: range.startsAt.slice(0, 5),
    endsAt: range.endsAt.slice(0, 5),
  });
  return {
    clock,
    moment,
    ranges: rows
      .map(wire)
      .sort((a, b) => rangeSpan(a, clock.dayCutover).start - rangeSpan(b, clock.dayCutover).start),
    extension: row === undefined ? null : wire(row),
  };
}

export async function closedZoneIdsAt(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
  zoneIds?: readonly string[],
): Promise<ReadonlySet<string>> {
  const closed = new Set<string>();
  if (zoneIds?.length === 0) return closed;
  const clock = await readLocationClock(tx, cfg.locationId);
  const moment = serviceMomentAt(at, clock);
  if (moment === null) return closed;
  const day = (await namedDaysOn(tx, cfg, [moment.businessDay])).get(moment.businessDay);
  if (day?.closeWholeVenue) return closed;
  const rows = await tx
    .select({
      zoneId: zoneClosedTimes.zoneId,
      startsAt: zoneClosedTimes.startsAt,
      endsAt: zoneClosedTimes.endsAt,
    })
    .from(zoneClosedTimes)
    .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, zoneClosedTimes.zoneId))
    .where(
      and(
        eq(zoneServicePolicies.locationId, cfg.locationId),
        day?.ownHours
          ? eq(zoneClosedTimes.specialDateId, day.id)
          : eq(zoneClosedTimes.weekday, moment.weekday),
        zoneIds === undefined ? undefined : inArray(zoneClosedTimes.zoneId, [...zoneIds]),
      ),
    );
  const extensions = await tx
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
  for (const row of rows) {
    const extension = extensions.find((entry) => entry.zoneId === row.zoneId) ?? null;
    for (const range of withoutZoneExtension([row], extension, clock.dayCutover)) {
      const { start, end } = rangeSpan(range, clock.dayCutover);
      if (start <= moment.minute && moment.minute < end) closed.add(row.zoneId);
    }
  }
  return closed;
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
