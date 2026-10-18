import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { PreparedServiceDay } from "@waitron/module";
import { readLocationClock, type LocationPlace } from "@waitron/reporting";
import { cutoverForBusinessDay, type BusinessDayClock } from "@waitron/shared";
import { layerPaint, layerZonePaint } from "./day-paint.js";
import { cutToOwnDay } from "./calendar-cut.js";
import { addDays, weekdayOf } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";
import type { VenueScope } from "./operations.js";
import { zoneServicePolicies } from "./schema/service.js";
import { serviceDayWallContext } from "./service-day-context.js";
import { seasonOn, type Season } from "./season-rules.js";
import { readDepartmentSeasonWeeks, readZoneSeasonWeeks, type SeasonDays } from "./season-weeks.js";
import { readSeasons } from "./seasons.js";
import {
  rangeSpan,
  serviceMomentAt,
  type ClosedRange,
  type ServiceMoment,
  type ServiceRange,
} from "./service-day.js";
import { specialDayOccurrences, specialDaysOn, type SpecialDayOccurrence } from "./special-days.js";

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

/** Asked for by the calendar alone: each day's season ranges as {@link cutToOwnDay} draws them,
 *  `anchor` being the start in force when the calendar is read. */
export interface CalendarCut {
  anchor: string;
}

function cutSeason<T extends ClosedRange>(
  ranges: readonly T[],
  clock: BusinessDayClock,
  day: LocalDate,
  cut: CalendarCut | undefined,
): readonly T[] {
  if (cut === undefined) return ranges;
  const own = serviceDayWallContext(clock, day);
  return ranges.flatMap((range) => cutToOwnDay(range, own, cut.anchor) ?? []);
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

/** A special day's name, its dates, and the plan of its stored dates, each date standing for this
 *  special day alone, whatever another repeating one would put there; null when the location has
 *  no such special day. */
export async function readSpecialDayPlan(
  tx: Transaction,
  cfg: VenueScope,
  specialDayId: string,
): Promise<{ name: string; dates: SpecialDayOccurrence[]; plan: DayPlan } | null> {
  const found = await specialDayOccurrences(tx, cfg, specialDayId);
  if (found === null) return null;
  const seasons = await readSeasons(tx, cfg);
  const dates = found.occurrences;
  return {
    name: found.name,
    dates,
    plan: {
      seasonIdOn: new Map(
        dates.map((d) => [d.storedDate, seasonOn(seasons, d.storedDate)?.id ?? null]),
      ),
      special: new Map(dates.map((d) => [d.storedDate, d])),
    },
  };
}

/** A clock and day plan read once for several reads; `moment` is `at`'s place on the clock. */
export interface ServiceDay {
  clock: BusinessDayClock;
  at?: Date;
  moment?: ServiceMoment | null;
  plan?: DayPlan;
}

/** The clock, and the plan for the business day `at` falls in and the one before, read once for
 *  a department and its zones; no plan when the clock cannot place `at`. */
export async function readServiceDayPlan(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<ServiceDay> {
  return serviceDayAt(tx, cfg, at, -1);
}

/** The clock and the plan of the business day `at` falls in, for the reads that take it. */
export async function readServiceDay(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<PreparedServiceDay> {
  const day = await serviceDayAt(tx, cfg, at, 0);
  return { ...day, businessDay: day.moment?.businessDay ?? null } as ServiceDay &
    PreparedServiceDay;
}

export function serviceDayOf(prepared: PreparedServiceDay | undefined): ServiceDay | undefined {
  return prepared as (ServiceDay & PreparedServiceDay) | undefined;
}

/** `at`'s moment, reusing the one `prepared` worked out when it was read at the same instant. */
export function momentAt(
  at: Date,
  clock: BusinessDayClock,
  prepared: ServiceDay | undefined,
): ServiceMoment | null {
  return prepared?.moment !== undefined && prepared.at?.getTime() === at.getTime()
    ? prepared.moment
    : serviceMomentAt(at, clock);
}

async function serviceDayAt(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
  firstDay: 0 | -1,
): Promise<ServiceDay> {
  const clock = await readLocationClock(tx, cfg.locationId);
  const moment = serviceMomentAt(at, clock);
  if (moment === null) return { clock, at, moment };
  const days = firstDay === 0 ? [] : [addDays(moment.businessDay, firstDay)];
  return {
    clock,
    at,
    moment,
    plan: await readDayPlan(tx, cfg, [...days, moment.businessDay]),
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
  cut?: CalendarCut,
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
      const season = cutSeason(
        (seasonId === null ? undefined : weeks.get(seasonId)?.[weekdayOf(day)]) ?? [],
        clock,
        day,
        cut,
      );
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
  cut?: CalendarCut,
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
      const season = cutSeason(
        (seasonId === null ? undefined : weeks.get(zoneId)?.get(seasonId)?.[weekdayOf(day)]) ?? [],
        clock,
        day,
        cut,
      );
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
