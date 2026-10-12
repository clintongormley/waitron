import { and, eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { cutoverForBusinessDay, type BusinessDayClock } from "@waitron/shared";
import { weekdayOf } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";
import { namedDaysOn } from "./named-days.js";
import type { VenueScope } from "./operations.js";
import { menuDayTimetables, menuSlots } from "./schema/menus.js";
import { zoneServicePolicies } from "./schema/service.js";
import { zoneClosedTimes } from "./schema/zone-closed-times.js";
import { seasonOn } from "./season-rules.js";
import { readDepartmentSeasonWeeks, readZoneSeasonWeeks } from "./season-weeks.js";
import { readSeasons } from "./seasons.js";
import { rangeSpan, type ClosedRange, type ServiceRange } from "./service-day.js";

export interface ResolvedDepartmentDay {
  businessDay: LocalDate;
  seasonId: string | null;
  ranges: ServiceRange[];
}

const wire = (time: string) => time.slice(0, 5);

function fromChangeover<T extends { startsAt: string; endsAt: string }>(
  ranges: readonly T[],
  clock: BusinessDayClock,
  day: LocalDate,
): T[] {
  const cutover = cutoverForBusinessDay(clock, day);
  return [...ranges].sort((a, b) => rangeSpan(a, cutover).start - rangeSpan(b, cutover).start);
}

/** Each day's season, and the named day standing on it, read once for all the days. */
async function dayPlan(tx: Transaction, cfg: VenueScope, businessDays: readonly LocalDate[]) {
  const seasons = await readSeasons(tx, cfg);
  const named = await namedDaysOn(tx, cfg, businessDays);
  return {
    named,
    seasonIdOn: (day: LocalDate) => seasonOn(seasons, day)?.id ?? null,
    ownHoursIds: [...named.values()].flatMap((day) =>
      day.ownHours && !day.closeWholeVenue ? [day.id] : [],
    ),
  };
}

/** A named day closing the whole venue has no hours; one with its own hours keeps its own
 *  timetable, or the season's week when it saved none; any other day has its season's week. */
export async function resolveDepartmentDays(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  businessDays: readonly LocalDate[],
  clock: BusinessDayClock,
): Promise<Map<LocalDate, ResolvedDepartmentDay>> {
  const resolved = new Map<LocalDate, ResolvedDepartmentDay>();
  if (businessDays.length === 0) return resolved;
  const plan = await dayPlan(tx, cfg, businessDays);
  const weeks =
    (await readDepartmentSeasonWeeks(tx, cfg, [departmentId], clock.dayCutover)).get(
      departmentId,
    ) ?? new Map<string, ServiceRange[][]>();
  const own = new Map<string, ServiceRange[]>();
  if (plan.ownHoursIds.length > 0)
    for (const row of await tx
      .select({
        specialDateId: menuDayTimetables.specialDateId,
        periodId: menuSlots.periodId,
        startsAt: menuSlots.startsAt,
        endsAt: menuSlots.endsAt,
      })
      .from(menuSlots)
      .innerJoin(menuDayTimetables, eq(menuDayTimetables.id, menuSlots.timetableId))
      .where(
        and(
          eq(menuDayTimetables.departmentId, departmentId),
          inArray(menuDayTimetables.specialDateId, plan.ownHoursIds),
        ),
      )) {
      const ranges = own.get(row.specialDateId!) ?? [];
      own.set(row.specialDateId!, ranges);
      ranges.push({
        periodId: row.periodId,
        startsAt: wire(row.startsAt),
        endsAt: wire(row.endsAt),
      });
    }
  for (const day of businessDays) {
    const named = plan.named.get(day);
    const seasonId = plan.seasonIdOn(day);
    const ranges = named?.closeWholeVenue
      ? []
      : ((named?.ownHours ? own.get(named.id) : undefined) ??
        (seasonId === null ? undefined : weeks.get(seasonId)?.[weekdayOf(day)]) ??
        []);
    resolved.set(day, { businessDay: day, seasonId, ranges: fromChangeover(ranges, clock, day) });
  }
  return resolved;
}

/** A named day closing the whole venue closes no zone (the venue is shut); one with its own hours
 *  has only its own closures, none when it saved none; any other day has its season's week. */
export async function resolveZoneClosedDays(
  tx: Transaction,
  cfg: VenueScope,
  zoneIds: readonly string[] | undefined,
  businessDays: readonly LocalDate[],
  clock: BusinessDayClock,
): Promise<Map<string, Map<LocalDate, ClosedRange[]>>> {
  const resolved = new Map<string, Map<LocalDate, ClosedRange[]>>();
  if (zoneIds?.length === 0) return resolved;
  const zones =
    zoneIds ??
    (
      await tx
        .select({ zoneId: zoneServicePolicies.zoneId })
        .from(zoneServicePolicies)
        .where(eq(zoneServicePolicies.locationId, cfg.locationId))
    ).map((row) => row.zoneId);
  const plan = await dayPlan(tx, cfg, businessDays);
  const weeks = await readZoneSeasonWeeks(tx, cfg, zoneIds, clock.dayCutover);
  const own = new Map<string, ClosedRange[]>();
  if (plan.ownHoursIds.length > 0)
    for (const row of await tx
      .select({
        zoneId: zoneClosedTimes.zoneId,
        specialDateId: zoneClosedTimes.specialDateId,
        startsAt: zoneClosedTimes.startsAt,
        endsAt: zoneClosedTimes.endsAt,
      })
      .from(zoneClosedTimes)
      .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, zoneClosedTimes.zoneId))
      .where(
        and(
          eq(zoneServicePolicies.locationId, cfg.locationId),
          inArray(zoneClosedTimes.specialDateId, plan.ownHoursIds),
          zoneIds === undefined ? undefined : inArray(zoneClosedTimes.zoneId, [...zoneIds]),
        ),
      )) {
      const key = `${row.zoneId}/${row.specialDateId}`;
      const ranges = own.get(key) ?? [];
      own.set(key, ranges);
      ranges.push({ startsAt: wire(row.startsAt), endsAt: wire(row.endsAt) });
    }
  for (const zoneId of zones) {
    const days = new Map<LocalDate, ClosedRange[]>();
    for (const day of businessDays) {
      const named = plan.named.get(day);
      const seasonId = plan.seasonIdOn(day);
      const ranges = named?.closeWholeVenue
        ? []
        : named?.ownHours
          ? (own.get(`${zoneId}/${named.id}`) ?? [])
          : ((seasonId === null ? undefined : weeks.get(zoneId)?.get(seasonId)?.[weekdayOf(day)]) ??
            []);
      days.set(day, fromChangeover(ranges, clock, day));
    }
    resolved.set(zoneId, days);
  }
  return resolved;
}
