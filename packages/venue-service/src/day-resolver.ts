import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readLocationClock, type LocationPlace } from "@waitron/reporting";
import { cutoverForBusinessDay, type BusinessDayClock } from "@waitron/shared";
import { layerPaint, layerZonePaint } from "./day-paint.js";
import { addDays, weekdayOf } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";
import type { VenueScope } from "./operations.js";
import { zoneServicePolicies } from "./schema/service.js";
import { seasonOn, type Season } from "./season-rules.js";
import { readDepartmentSeasonWeeks, readZoneSeasonWeeks, type SeasonDays } from "./season-weeks.js";
import { readSeasons } from "./seasons.js";
import { rangeSpan, serviceMomentAt, type ClosedRange, type ServiceRange } from "./service-day.js";
import { specialDaysOn, type SpecialDayOccurrence } from "./special-days.js";

export interface ResolvedDepartmentDay {
  businessDay: LocalDate;
  seasonId: string | null;
  ranges: ServiceRange[];
}

function fromChangeover<T extends { startsAt: string; endsAt: string }>(
  ranges: readonly T[],
  cutover: string,
): T[] {
  return [...ranges].sort((a, b) => rangeSpan(a, cutover).start - rangeSpan(b, cutover).start);
}

/** Each day's season, and the special day standing on it, for the days it was read for. */
export interface DayPlan {
  seasonIdOn: ReadonlyMap<LocalDate, string | null>;
  special: ReadonlyMap<LocalDate, SpecialDayOccurrence | null>;
}

export async function readDayPlan(
  tx: Transaction,
  cfg: VenueScope,
  businessDays: readonly LocalDate[],
  venueSeasons?: readonly Season[],
  place?: LocationPlace,
): Promise<DayPlan> {
  const seasons = venueSeasons ?? (await readSeasons(tx, cfg));
  return {
    seasonIdOn: new Map(businessDays.map((day) => [day, seasonOn(seasons, day)?.id ?? null])),
    special: await specialDaysOn(tx, cfg, businessDays, place),
  };
}

/** The clock, and the plan for the business day `at` falls in and the one before, read once for
 *  a department and its zones; no plan when the clock cannot place `at`. */
export async function readServiceDayPlan(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<{ clock: BusinessDayClock; plan?: DayPlan }> {
  const clock = await readLocationClock(tx, cfg.locationId);
  const moment = serviceMomentAt(at, clock);
  if (moment === null) return { clock };
  return {
    clock,
    plan: await readDayPlan(tx, cfg, [addDays(moment.businessDay, -1), moment.businessDay]),
  };
}

async function planFor(
  tx: Transaction,
  cfg: VenueScope,
  businessDays: readonly LocalDate[],
  given: DayPlan | undefined,
): Promise<DayPlan> {
  if (given === undefined) return readDayPlan(tx, cfg, businessDays);
  for (const day of businessDays)
    if (!given.seasonIdOn.has(day) || !given.special.has(day))
      throw new Error(`the day plan does not cover ${day}`);
  return given;
}

/** The seasons and weekdays of the days that take their season's week. */
function seasonDays(plan: DayPlan, businessDays: readonly LocalDate[]): SeasonDays {
  const seasonIds = new Set<string>();
  const weekdays = new Set<number>();
  for (const day of businessDays) {
    const seasonId = plan.seasonIdOn.get(day);
    if (seasonId == null || plan.special.get(day)?.closedAllDay) continue;
    seasonIds.add(seasonId);
    weekdays.add(weekdayOf(day));
  }
  return { seasonIds: [...seasonIds], weekdays: [...weekdays] };
}

/** A special-day date closed all day has no hours, and otherwise has its paint laid over the
 *  season's day. Any other day has its season's week. */
export async function resolveDepartmentDays(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  businessDays: readonly LocalDate[],
  clock: BusinessDayClock,
  given?: DayPlan,
): Promise<Map<LocalDate, ResolvedDepartmentDay>> {
  return (
    (await resolveDepartmentsDays(tx, cfg, [departmentId], businessDays, clock, given)).get(
      departmentId,
    ) ?? new Map()
  );
}

/** {@link resolveDepartmentDays} for several departments, reading their season weeks in one
 *  statement; keyed by department id. */
export async function resolveDepartmentsDays(
  tx: Transaction,
  cfg: VenueScope,
  departmentIds: readonly string[],
  businessDays: readonly LocalDate[],
  clock: BusinessDayClock,
  given?: DayPlan,
): Promise<Map<string, Map<LocalDate, ResolvedDepartmentDay>>> {
  const resolved = new Map<string, Map<LocalDate, ResolvedDepartmentDay>>();
  if (businessDays.length === 0 || departmentIds.length === 0) return resolved;
  const plan = await planFor(tx, cfg, businessDays, given);
  const allWeeks = await readDepartmentSeasonWeeks(
    tx,
    cfg,
    departmentIds,
    clock.dayCutover,
    seasonDays(plan, businessDays),
  );
  const cutovers = new Map(businessDays.map((day) => [day, cutoverForBusinessDay(clock, day)]));
  for (const departmentId of departmentIds) {
    const weeks = allWeeks.get(departmentId) ?? new Map<string, ServiceRange[][]>();
    const days = new Map<LocalDate, ResolvedDepartmentDay>();
    for (const day of businessDays) {
      const special = plan.special.get(day);
      const seasonId = plan.seasonIdOn.get(day) ?? null;
      const cutover = cutovers.get(day)!;
      const season = (seasonId === null ? undefined : weeks.get(seasonId)?.[weekdayOf(day)]) ?? [];
      const ranges = special
        ? special.closedAllDay
          ? []
          : layerPaint(season, special.paint.get(departmentId) ?? [], cutover)
        : season;
      days.set(day, { businessDay: day, seasonId, ranges: fromChangeover(ranges, cutover) });
    }
    resolved.set(departmentId, days);
  }
  return resolved;
}

/** A special-day date closed all day closes no zone, and otherwise has its
 *  zone paint laid over the season's closures. Any other day has its season's week. */
export async function resolveZoneClosedDays(
  tx: Transaction,
  cfg: VenueScope,
  zoneIds: readonly string[] | undefined,
  businessDays: readonly LocalDate[],
  clock: BusinessDayClock,
  given?: DayPlan,
): Promise<Map<string, Map<LocalDate, ClosedRange[]>>> {
  const resolved = new Map<string, Map<LocalDate, ClosedRange[]>>();
  if (zoneIds?.length === 0 || businessDays.length === 0) return resolved;
  const zones =
    zoneIds ??
    (
      await tx
        .select({ zoneId: zoneServicePolicies.zoneId })
        .from(zoneServicePolicies)
        .where(eq(zoneServicePolicies.locationId, cfg.locationId))
    ).map((row) => row.zoneId);
  const plan = await planFor(tx, cfg, businessDays, given);
  const weeks = await readZoneSeasonWeeks(
    tx,
    cfg,
    zoneIds,
    clock.dayCutover,
    seasonDays(plan, businessDays),
  );
  const cutovers = new Map(businessDays.map((day) => [day, cutoverForBusinessDay(clock, day)]));
  for (const zoneId of zones) {
    const days = new Map<LocalDate, ClosedRange[]>();
    for (const day of businessDays) {
      const special = plan.special.get(day);
      const seasonId = plan.seasonIdOn.get(day) ?? null;
      const season =
        (seasonId === null ? undefined : weeks.get(zoneId)?.get(seasonId)?.[weekdayOf(day)]) ?? [];
      const ranges = special
        ? special.closedAllDay
          ? []
          : layerZonePaint(season, special.zonePaint.get(zoneId) ?? [], cutovers.get(day)!)
        : season;
      days.set(day, fromChangeover(ranges, cutovers.get(day)!));
    }
    resolved.set(zoneId, days);
  }
  return resolved;
}
