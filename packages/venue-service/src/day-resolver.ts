import { and, asc, eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { cutoverForBusinessDay, type BusinessDayClock } from "@waitron/shared";
import { layerPaint, layerZonePaint } from "./day-paint.js";
import { addDays, weekdayOf } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";
import { namedDaysOn, type NamedDayOccurrence } from "./named-days.js";
import { wireTime, type VenueScope } from "./operations.js";
import { menuDayTimetables, menuSlots } from "./schema/menus.js";
import { zoneServicePolicies } from "./schema/service.js";
import { zoneClosedTimes } from "./schema/zone-closed-times.js";
import { seasonOn } from "./season-rules.js";
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

/** Each day's season, and the named day and special day standing on it, for the days it was read
 *  for. A special day wins over a named day on the same date. */
export interface DayPlan {
  named: ReadonlyMap<LocalDate, NamedDayOccurrence>;
  seasonIdOn: ReadonlyMap<LocalDate, string | null>;
  special: ReadonlyMap<LocalDate, SpecialDayOccurrence | null>;
}

export async function readDayPlan(
  tx: Transaction,
  cfg: VenueScope,
  businessDays: readonly LocalDate[],
): Promise<DayPlan> {
  const seasons = await readSeasons(tx, cfg);
  return {
    named: await namedDaysOn(tx, cfg, businessDays),
    seasonIdOn: new Map(businessDays.map((day) => [day, seasonOn(seasons, day)?.id ?? null])),
    special: await specialDaysOn(tx, cfg, businessDays),
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
function seasonDays(
  plan: DayPlan,
  businessDays: readonly LocalDate[],
  takesWeek: (named: NamedDayOccurrence | undefined) => boolean,
): SeasonDays {
  const seasonIds = new Set<string>();
  const weekdays = new Set<number>();
  for (const day of businessDays) {
    const seasonId = plan.seasonIdOn.get(day);
    const special = plan.special.get(day);
    if (seasonId == null) continue;
    if (special ? special.closedAllDay : !takesWeek(plan.named.get(day))) continue;
    seasonIds.add(seasonId);
    weekdays.add(weekdayOf(day));
  }
  return { seasonIds: [...seasonIds], weekdays: [...weekdays] };
}

function ownHoursOn(plan: DayPlan, businessDays: readonly LocalDate[]): string[] {
  return [
    ...new Set(
      businessDays.flatMap((day) => {
        const named = plan.named.get(day);
        return named?.ownHours && !named.closeWholeVenue ? [named.id] : [];
      }),
    ),
  ];
}

/** A named day closing the whole venue has no hours; one with its own hours keeps its own
 *  timetable, or the season's week when it saved none; any other day has its season's week. */
export async function resolveDepartmentDays(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  businessDays: readonly LocalDate[],
  clock: BusinessDayClock,
  given?: DayPlan,
): Promise<Map<LocalDate, ResolvedDepartmentDay>> {
  const resolved = new Map<LocalDate, ResolvedDepartmentDay>();
  if (businessDays.length === 0) return resolved;
  const plan = await planFor(tx, cfg, businessDays, given);
  const ownHoursIds = ownHoursOn(plan, businessDays);
  const own = new Map<string, ServiceRange[]>();
  if (ownHoursIds.length > 0)
    for (const row of await tx
      .select({
        specialDateId: menuDayTimetables.specialDateId,
        periodId: menuSlots.periodId,
        startsAt: menuSlots.startsAt,
        endsAt: menuSlots.endsAt,
      })
      .from(menuDayTimetables)
      .leftJoin(menuSlots, eq(menuSlots.timetableId, menuDayTimetables.id))
      .where(
        and(
          eq(menuDayTimetables.departmentId, departmentId),
          inArray(menuDayTimetables.specialDateId, ownHoursIds),
        ),
      )
      .orderBy(asc(menuSlots.startsAt), asc(menuSlots.id))) {
      // A timetable row with no slots is a closed day, not a missing timetable.
      const ranges = own.get(row.specialDateId!) ?? [];
      own.set(row.specialDateId!, ranges);
      if (row.startsAt !== null)
        ranges.push({
          periodId: row.periodId!,
          startsAt: wireTime(row.startsAt),
          endsAt: wireTime(row.endsAt!),
        });
    }
  const weeks =
    (
      await readDepartmentSeasonWeeks(
        tx,
        cfg,
        [departmentId],
        clock.dayCutover,
        seasonDays(
          plan,
          businessDays,
          (named) => !named?.closeWholeVenue && !(named?.ownHours && own.has(named.id)),
        ),
      )
    ).get(departmentId) ?? new Map<string, ServiceRange[][]>();
  for (const day of businessDays) {
    const named = plan.named.get(day);
    const special = plan.special.get(day);
    const seasonId = plan.seasonIdOn.get(day) ?? null;
    const cutover = cutoverForBusinessDay(clock, day);
    const season = (seasonId === null ? undefined : weeks.get(seasonId)?.[weekdayOf(day)]) ?? [];
    const ranges = special
      ? special.closedAllDay
        ? []
        : layerPaint(season, special.paint.get(departmentId) ?? [], cutover)
      : named?.closeWholeVenue
        ? []
        : ((named?.ownHours ? own.get(named.id) : undefined) ?? season);
    resolved.set(day, { businessDay: day, seasonId, ranges: fromChangeover(ranges, cutover) });
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
  const ownHoursIds = ownHoursOn(plan, businessDays);
  const weeks = await readZoneSeasonWeeks(
    tx,
    cfg,
    zoneIds,
    clock.dayCutover,
    seasonDays(plan, businessDays, (named) => !named?.closeWholeVenue && !named?.ownHours),
  );
  const own = new Map<string, ClosedRange[]>();
  if (ownHoursIds.length > 0)
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
          inArray(zoneClosedTimes.specialDateId, ownHoursIds),
          zoneIds === undefined ? undefined : inArray(zoneClosedTimes.zoneId, [...zoneIds]),
        ),
      )
      .orderBy(asc(zoneClosedTimes.startsAt), asc(zoneClosedTimes.id))) {
      const key = `${row.zoneId}/${row.specialDateId}`;
      const ranges = own.get(key) ?? [];
      own.set(key, ranges);
      ranges.push({ startsAt: wireTime(row.startsAt), endsAt: wireTime(row.endsAt) });
    }
  const cutovers = new Map(businessDays.map((day) => [day, cutoverForBusinessDay(clock, day)]));
  for (const zoneId of zones) {
    const days = new Map<LocalDate, ClosedRange[]>();
    for (const day of businessDays) {
      const named = plan.named.get(day);
      const special = plan.special.get(day);
      const seasonId = plan.seasonIdOn.get(day) ?? null;
      const season =
        (seasonId === null ? undefined : weeks.get(zoneId)?.get(seasonId)?.[weekdayOf(day)]) ?? [];
      const ranges = special
        ? special.closedAllDay
          ? []
          : layerZonePaint(season, special.zonePaint.get(zoneId) ?? [], cutovers.get(day)!)
        : named?.closeWholeVenue
          ? []
          : named?.ownHours
            ? (own.get(`${zoneId}/${named.id}`) ?? [])
            : season;
      days.set(day, fromChangeover(ranges, cutovers.get(day)!));
    }
    resolved.set(zoneId, days);
  }
  return resolved;
}
