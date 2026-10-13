import {
  assertBusinessDayScheduleWrite,
  sameScheduleRanges,
  readBusinessDayScheduleRevision,
  readBusinessDayScheduleStatus,
} from "./business-day-schedule.js";
import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { catalogues, categories, floorZones, products, type Transaction } from "@waitron/db";
import { categoryDetails, directIncludedMenus, loadSectionGraph } from "@waitron/catalogue";
import { readLocationClock } from "@waitron/reporting";
import { AppError, createLabelComparator, type BusinessDayClock } from "@waitron/shared";

import { addDays } from "./hours-rules.js";
import {
  parseServiceDay,
  rangeInForce,
  rangeSpan,
  rangeSpanInDay,
  serviceMomentAt,
  withExtension,
  type ServiceMoment,
  type ServiceRange,
} from "./service-day.js";
import { CALENDAR_COLOURS } from "./hours-types.js";
import { invalidTimetable, menuPeriodName, parseMenuWeek } from "./menu-timetable-rules.js";
import { findSeasonEndOffsetClash, parseEndOffsetMinutes } from "./period-end-offset.js";
import type {
  DepartmentService,
  OpeningHoursModel,
  MenuPeriodInput,
  MenuPeriodUse,
  MenuSlot,
  PeriodRoutingUse,
} from "./menu-timetable-types.js";
import { assertDepartment, resolveZoneContext, wireTime, type VenueScope } from "./operations.js";
import { holidayDatesFor, readSpecialDaySchedules, specialDateIn } from "./special-days.js";
import { menuPeriods, menuPeriodStaffMenus } from "./schema/menus.js";
import { departments } from "./schema/service.js";
import { routingCellPeriods, routingCells } from "./schema/routing.js";
import { periodExtensions } from "./schema/period-extensions.js";
import { readZoneClosedTimes } from "./zone-closed-times.js";
import { resolveDepartmentDays, type DayPlan } from "./day-resolver.js";
import {
  joinTouching,
  readDepartmentSeasonWeeks,
  seasonWeekList,
  seasonsHolding,
  targetSeasons,
  writeDepartmentSeasonWeeks,
} from "./season-weeks.js";
import { seasonOn } from "./season-rules.js";
import { readSeasons } from "./seasons.js";
import {
  departmentDayRanges,
  departmentDays,
  specialDayDates,
  specialDays,
} from "./schema/seasons.js";
import {
  scheduleCutovers,
  serviceDayContext,
  type ServiceDayContext,
} from "./service-day-context.js";
import "./errors.js";

export async function placeOpenPeriod(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  menuId: string,
): Promise<void> {
  await assertDepartment(tx, cfg, departmentId);
  const [existing] = await tx
    .select({ id: menuPeriods.id })
    .from(menuPeriods)
    .where(eq(menuPeriods.departmentId, departmentId))
    .limit(1);
  if (existing !== undefined) return;
  const clockRevision = await readBusinessDayScheduleRevision(tx, cfg);
  const { id } = await saveMenuPeriod(
    tx,
    cfg,
    departmentId,
    {
      name: "Open",
      menuId,
      staffMenuIds: [],
    },
    clockRevision,
  );
  await replaceMenuWeek(
    tx,
    cfg,
    departmentId,
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      slots:
        weekday >= 1 && weekday <= 5 ? [{ periodId: id, startsAt: "09:00", endsAt: "17:00" }] : [],
    })),
    new Date(),
    clockRevision,
  );
}

export async function requirePeriod(tx: Transaction, cfg: VenueScope, periodId: string) {
  const [row] = await tx
    .select({
      id: menuPeriods.id,
      departmentId: menuPeriods.departmentId,
      name: menuPeriods.name,
      menuId: menuPeriods.menuId,
      endOffsetMinutes: menuPeriods.endOffsetMinutes,
    })
    .from(menuPeriods)
    .innerJoin(departments, eq(departments.id, menuPeriods.departmentId))
    .where(and(eq(menuPeriods.id, periodId), eq(departments.locationId, cfg.locationId)));
  if (row === undefined) throw new AppError("menu_period.not_found", { periodId });
  await assertDepartment(tx, cfg, row.departmentId);
  return row;
}

/** Refuses a slot naming a period that is not the department's own. */
async function assertOwnPeriods(
  tx: Transaction,
  departmentId: string,
  days: readonly { field: string; slots: readonly MenuSlot[] }[],
): Promise<void> {
  const ids = [...new Set(days.flatMap((day) => day.slots.map((slot) => slot.periodId)))];
  if (ids.length === 0) return;
  const own = new Set(
    (
      await tx
        .select({ id: menuPeriods.id })
        .from(menuPeriods)
        .where(and(eq(menuPeriods.departmentId, departmentId), inArray(menuPeriods.id, ids)))
    ).map((row) => row.id),
  );
  for (const { field, slots } of days)
    slots.forEach((slot, index) => {
      if (!own.has(slot.periodId)) invalidTimetable(`${field}.${index}.periodId`);
    });
}

async function endOffsetClash(
  tx: Transaction,
  cfg: VenueScope,
  departmentId?: string,
  validateZeroOffsets = false,
  acquiredClock?: BusinessDayClock,
) {
  const periods = await tx
    .select({
      id: menuPeriods.id,
      departmentId: menuPeriods.departmentId,
      offset: menuPeriods.endOffsetMinutes,
    })
    .from(menuPeriods)
    .innerJoin(departments, eq(departments.id, menuPeriods.departmentId))
    .where(
      and(
        eq(departments.locationId, cfg.locationId),
        departmentId === undefined ? undefined : eq(departments.id, departmentId),
      ),
    );
  if (!validateZeroOffsets && periods.every((period) => period.offset === 0)) return null;
  const clock = acquiredClock ?? (await readLocationClock(tx, cfg.locationId));
  const offsets = new Map(periods.map((period) => [period.id, period.offset]));
  const departmentIds = [...new Set(periods.map((period) => period.departmentId))];
  const specialDays = await readSpecialDaySchedules(tx, cfg, departmentIds);
  const holidays = await holidayDatesFor(tx, cfg, specialDays);
  const allSeasons = await readSeasons(tx, cfg);
  const weeks = await readDepartmentSeasonWeeks(tx, cfg, departmentIds, clock.dayCutover);
  for (const id of departmentIds) {
    const clash = findSeasonEndOffsetClash(
      allSeasons.map((season) => ({
        seasonId: season.id,
        startsOn: season.startsOn,
        week: weeks.get(id)?.get(season.id) ?? [],
      })),
      specialDays.map((day) => ({
        date: day.date,
        closeWholeVenue: day.closedAllDay,
        ...(day.repeats ? { occursIn: (year: number) => specialDateIn(day, year, holidays) } : {}),
        paint: day.paint.get(id) ?? [],
        specialDayId: day.specialDayId,
      })),
      offsets,
      clock,
    );
    if (clash !== null) {
      return {
        periodId: clash.periodId,
        seasonId: clash.seasonId,
        weekday: clash.weekday,
        date: clash.date,
        departmentId: id,
        ...(clash.specialDayId === undefined ? {} : { specialDayId: clash.specialDayId }),
      };
    }
  }
  return null;
}

/** The first sending cutoff that runs into what follows it, over every department. */
export function scheduleEndOffsetClash(tx: Transaction, cfg: VenueScope, clock?: BusinessDayClock) {
  return endOffsetClash(tx, cfg, undefined, false, clock);
}

export async function assertPeriodEndOffsets(tx: Transaction, cfg: VenueScope): Promise<void> {
  const clash = await endOffsetClash(tx, cfg, undefined, true);
  if (clash !== null) invalidTimetable("dayCutover", { reason: "end_offset", ...clash });
}

export async function departmentDay(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  moment: ServiceMoment | null,
  clock: BusinessDayClock,
  plan?: DayPlan,
) {
  const periods = await tx
    .select({
      id: menuPeriods.id,
      name: menuPeriods.name,
      menuId: menuPeriods.menuId,
      offset: menuPeriods.endOffsetMinutes,
    })
    .from(menuPeriods)
    .where(eq(menuPeriods.departmentId, departmentId))
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
  const staff = await tx
    .select({ periodId: menuPeriodStaffMenus.periodId, menuId: menuPeriodStaffMenus.menuId })
    .from(menuPeriodStaffMenus)
    .where(eq(menuPeriodStaffMenus.departmentId, departmentId))
    .orderBy(asc(menuPeriodStaffMenus.displayOrder), asc(menuPeriodStaffMenus.menuId));
  if (moment === null) return { periods, staff, ranges: [], previousRanges: [], extension: null };
  const yesterday = addDays(moment.businessDay, -1);
  const days = await resolveDepartmentDays(
    tx,
    cfg,
    departmentId,
    [yesterday, moment.businessDay],
    clock,
    plan,
  );
  const [row] = await tx
    .select({
      periodId: periodExtensions.periodId,
      startsAt: periodExtensions.startsAt,
      endsAt: periodExtensions.endsAt,
    })
    .from(periodExtensions)
    .where(
      and(
        eq(periodExtensions.departmentId, departmentId),
        eq(periodExtensions.businessDay, moment.businessDay),
      ),
    );
  const extension =
    row === undefined
      ? null
      : {
          periodId: row.periodId,
          startsAt: wireTime(row.startsAt),
          endsAt: wireTime(row.endsAt),
        };
  return {
    periods,
    staff,
    ranges: days.get(moment.businessDay)!.ranges,
    previousRanges: days.get(yesterday)!.ranges,
    extension,
  };
}

export function serviceRuns(ranges: readonly ServiceRange[]): ServiceRange[] {
  const runs: ServiceRange[] = [];
  for (const range of ranges) {
    const last = runs.at(-1);
    if (last?.periodId === range.periodId && last.endsAt === range.startsAt)
      last.endsAt = range.endsAt;
    else runs.push({ ...range });
  }
  return runs;
}

export function keepOpenSubject(
  ranges: readonly ServiceRange[],
  day: Awaited<ReturnType<typeof departmentDay>>,
  moment: ServiceMoment | null,
  cutover: string,
  context?: ServiceDayContext,
): DepartmentService["keepOpen"] {
  if (moment === null) return null;
  const runs = serviceRuns(ranges);
  const running = rangeInForce(runs, moment.minute, cutover, context);
  const run =
    running ??
    runs
      .slice()
      .reverse()
      .find(
        (range) =>
          (context === undefined ? rangeSpan(range, cutover) : rangeSpanInDay(range, context))
            .end <= moment.minute,
      );
  if (run === undefined) return null;
  const period = day.periods.find((entry) => entry.id === run.periodId)!;
  const extended = day.extension;
  return {
    periodId: period.id,
    periodName: period.name,
    endsAt: run.endsAt,
    running: running !== null,
    extendedUntil:
      extended !== null && extended.periodId === run.periodId && extended.endsAt === run.endsAt
        ? extended.endsAt
        : null,
  };
}

export async function resolveDepartmentService(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  at: Date,
  prepared?: { clock: BusinessDayClock; plan?: DayPlan },
): Promise<DepartmentService> {
  await assertDepartment(tx, cfg, departmentId);
  const clock = prepared?.clock ?? (await readLocationClock(tx, cfg.locationId));
  const moment = serviceMomentAt(at, clock);
  const day = await departmentDay(tx, cfg, departmentId, moment, clock, prepared?.plan);
  const { periods, staff } = day;
  const menusOf = (periodId: string): string[] => {
    const period = periods.find((entry) => entry.id === periodId)!;
    return [
      period.menuId,
      ...staff.filter((entry) => entry.periodId === periodId).map((entry) => entry.menuId),
    ];
  };
  const closed: DepartmentService = {
    departmentId,
    open: false,
    periodId: null,
    periodName: null,
    customerMenuId: null,
    orderableMenuIds: [],
    sendableMenuIds: [],
    endedMenuIds: [],
    keepOpen: null,
  };
  if (moment === null)
    return {
      ...closed,
      open: true,
      orderableMenuIds: [...new Set(periods.flatMap((period) => menusOf(period.id)))],
      sendableMenuIds: [...new Set(periods.flatMap((period) => menusOf(period.id)))],
    };

  const context = serviceDayContext(clock, moment.businessDay);
  const previousContext = serviceDayContext(clock, addDays(moment.businessDay, -1));
  const ranges = withExtension(day.ranges, day.extension, context.dayCutover);
  const running = rangeInForce(ranges, moment.minute, context.dayCutover, context);
  const period =
    running === null ? undefined : periods.find((entry) => entry.id === running.periodId);
  const occurrences = [
    ...day.previousRanges.map((range) => ({ range, previous: true })),
    ...serviceRuns(ranges).map((range) => ({ range, previous: false })),
  ];
  const eligibleMenus = (selection: boolean): string[] => [
    ...new Set(
      occurrences.flatMap(({ range, previous }) => {
        const cutover = previous ? previousContext.dayCutover : context.dayCutover;
        const span = rangeSpan(range, cutover);
        const relativeMinute = previous
          ? moment.minute +
            1440 +
            (Number(context.dayCutover.slice(0, 2)) - Number(cutover.slice(0, 2))) * 60 +
            Number(context.dayCutover.slice(3, 5)) -
            Number(cutover.slice(3, 5))
          : moment.minute;
        const offset = periods.find((entry) => entry.id === range.periodId)!.offset;
        const cutoff = span.end + (selection ? Math.min(offset, 0) : offset);
        const boundaryEnd =
          !previous &&
          range.endsAt === context.dayCutover &&
          context.endMinute === 1440 &&
          cutoff >= 1440;
        return relativeMinute >= span.start &&
          (boundaryEnd ||
            relativeMinute < Math.min(cutoff, previous ? Infinity : context.endMinute))
          ? menusOf(range.periodId)
          : [];
      }),
    ),
  ];
  const orderableMenuIds = eligibleMenus(true);
  const sendableMenuIds = eligibleMenus(false);
  const ended = [
    ...day.previousRanges,
    ...ranges.filter((range) => rangeSpanInDay(range, context).end <= moment.minute),
  ];
  return {
    departmentId,
    open: period !== undefined,
    periodId: period?.id ?? null,
    periodName: period?.name ?? null,
    customerMenuId: period?.menuId ?? null,
    orderableMenuIds,
    sendableMenuIds,
    keepOpen: keepOpenSubject(ranges, day, moment, context.dayCutover, context),
    endedMenuIds: [...new Set(ended.flatMap((range) => menusOf(range.periodId)))].filter(
      (id) => !orderableMenuIds.includes(id),
    ),
  };
}

/** `defaultMenuId` when it is served or null, else the first served menu. */
export function servedDefault(
  defaultMenuId: string | null,
  servedMenuIds: readonly string[],
): string | null {
  return defaultMenuId === null || servedMenuIds.includes(defaultMenuId)
    ? defaultMenuId
    : (servedMenuIds[0] ?? null);
}

export async function resolveDefaultMenu(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  at: Date,
  servedMenuIds: readonly string[],
): Promise<string | null> {
  const zone = await resolveZoneContext(tx, cfg, zoneId);
  const service = await resolveDepartmentService(tx, cfg, zone.departmentId, at);
  return servedDefault(
    service.customerMenuId,
    servedMenuIds.filter((id) => service.orderableMenuIds.includes(id)),
  );
}

export async function saveMenuPeriod(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  period: MenuPeriodInput,
  expectedClockRevision: number,
  at: Date = new Date(),
): Promise<{ id: string }> {
  return writeMenuPeriod(tx, cfg, departmentId, null, period, expectedClockRevision, at);
}

async function writeMenuPeriod(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  periodId: string | null,
  period: MenuPeriodInput,
  expectedClockRevision: number,
  at: Date,
): Promise<{ id: string }> {
  const name = menuPeriodName(period.name);
  const endOffsetMinutes = parseEndOffsetMinutes(
    period.endOffsetMinutes === undefined ? 0 : period.endOffsetMinutes,
  );
  await assertDepartment(tx, cfg, departmentId);
  const oldOffset =
    periodId === null ? 0 : (await requirePeriod(tx, cfg, periodId)).endOffsetMinutes;
  await assertBusinessDayScheduleWrite(
    tx,
    cfg,
    oldOffset === endOffsetMinutes ? "metadata" : "time",
    at,
    expectedClockRevision,
  );
  if (
    period.colour !== undefined &&
    (typeof period.colour !== "string" || !CALENDAR_COLOURS.includes(period.colour))
  )
    throw new AppError("menu_period.invalid", { field: "colour" });
  const staffMenuIds = period.staffMenuIds;
  if (!Array.isArray(staffMenuIds))
    throw new AppError("menu_period.invalid", { field: "staffMenuIds" });
  if (staffMenuIds.includes(period.menuId) || new Set(staffMenuIds).size !== staffMenuIds.length)
    throw new AppError("menu_period.invalid", { field: "staffMenuIds" });
  for (const menuId of [period.menuId, ...staffMenuIds]) {
    const [menu] = await tx
      .select({ id: catalogues.id })
      .from(catalogues)
      .where(and(eq(catalogues.id, menuId), eq(catalogues.active, true)));
    if (menu === undefined) throw new AppError("catalogue.not_found", { catalogueId: menuId });
  }
  if (periodId !== null) {
    const [own] = await tx
      .select({ id: menuPeriods.id })
      .from(menuPeriods)
      .where(and(eq(menuPeriods.id, periodId), eq(menuPeriods.departmentId, departmentId)));
    if (own === undefined) throw new AppError("menu_period.not_found", { periodId });
  }
  const [taken] = await tx
    .select({ id: menuPeriods.id })
    .from(menuPeriods)
    .where(
      and(
        eq(menuPeriods.departmentId, departmentId),
        eq(menuPeriods.name, name),
        periodId === null ? undefined : ne(menuPeriods.id, periodId),
      ),
    );
  if (taken !== undefined) throw new AppError("menu_period.name_taken", { departmentId, name });
  const used = await tx
    .select({ colour: menuPeriods.colour })
    .from(menuPeriods)
    .where(eq(menuPeriods.departmentId, departmentId));
  const colour =
    period.colour ??
    CALENDAR_COLOURS.find((value) => !used.some((row) => row.colour === value)) ??
    CALENDAR_COLOURS[0];
  const values = { name, menuId: period.menuId, colour, endOffsetMinutes };
  let id = periodId;
  if (periodId === null) {
    const [row] = await tx
      .insert(menuPeriods)
      .values({ departmentId, ...values })
      .returning({ id: menuPeriods.id });
    id = row!.id;
  } else {
    await tx.update(menuPeriods).set(values).where(eq(menuPeriods.id, periodId));
    await tx.delete(menuPeriodStaffMenus).where(eq(menuPeriodStaffMenus.periodId, periodId));
  }
  if (staffMenuIds.length > 0)
    await tx.insert(menuPeriodStaffMenus).values(
      staffMenuIds.map((menuId, displayOrder) => ({
        periodId: id!,
        departmentId,
        menuId,
        displayOrder,
      })),
    );
  const clash = await endOffsetClash(tx, cfg, departmentId);
  if (clash !== null)
    throw new AppError("menu_period.invalid", {
      field: "endOffsetMinutes",
      reason: "placement",
      periodId: clash.periodId,
      departmentId,
      seasonId: clash.seasonId,
      weekday: clash.weekday,
      date: clash.date,
      ...(clash.specialDayId === undefined ? {} : { specialDayId: clash.specialDayId }),
    });
  return { id: id! };
}

export async function updateMenuPeriod(
  tx: Transaction,
  cfg: VenueScope,
  periodId: string,
  period: Partial<MenuPeriodInput>,
  expectedClockRevision: number,
  at: Date = new Date(),
): Promise<void> {
  const stored = await requirePeriod(tx, cfg, periodId);
  const staff = await tx
    .select({ menuId: menuPeriodStaffMenus.menuId })
    .from(menuPeriodStaffMenus)
    .where(eq(menuPeriodStaffMenus.periodId, periodId))
    .orderBy(asc(menuPeriodStaffMenus.displayOrder));
  const [appearance] = await tx
    .select({ colour: menuPeriods.colour })
    .from(menuPeriods)
    .where(eq(menuPeriods.id, periodId));
  await writeMenuPeriod(
    tx,
    cfg,
    stored.departmentId,
    periodId,
    {
      name: period.name === undefined ? stored.name : period.name,
      menuId: period.menuId === undefined ? stored.menuId : period.menuId,
      colour: period.colour === undefined ? appearance!.colour : period.colour,
      staffMenuIds:
        period.staffMenuIds === undefined ? staff.map((row) => row.menuId) : period.staffMenuIds,
      endOffsetMinutes:
        period.endOffsetMinutes === undefined ? stored.endOffsetMinutes : period.endOffsetMinutes,
    },
    expectedClockRevision,
    at,
  );
}

/** Every day that places each listed period: weekdays in order, then special-day dates by date. */
async function periodUses(
  tx: Transaction,
  periodIds: readonly string[],
): Promise<Map<string, MenuPeriodUse[]>> {
  const uses = new Map<string, MenuPeriodUse[]>(periodIds.map((id) => [id, []]));
  if (periodIds.length === 0) return uses;
  const painted = await tx
    .selectDistinct({ periodId: departmentDayRanges.periodId, weekday: departmentDays.weekday })
    .from(departmentDayRanges)
    .innerJoin(departmentDays, eq(departmentDays.id, departmentDayRanges.dayId))
    .where(
      and(
        isNotNull(departmentDays.seasonId),
        inArray(departmentDayRanges.periodId, [...periodIds]),
      ),
    );
  const specialDayPaint = await tx
    .selectDistinct({
      periodId: departmentDayRanges.periodId,
      specialDayId: specialDays.id,
      name: specialDays.name,
      date: specialDayDates.date,
    })
    .from(departmentDayRanges)
    .innerJoin(departmentDays, eq(departmentDays.id, departmentDayRanges.dayId))
    .innerJoin(specialDayDates, eq(specialDayDates.id, departmentDays.specialDayDateId))
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))
    .where(inArray(departmentDayRanges.periodId, [...periodIds]))
    .orderBy(asc(specialDayDates.date), asc(specialDays.id));
  const weekdays = new Map<string, Set<number>>(periodIds.map((id) => [id, new Set()]));
  for (const row of painted) weekdays.get(row.periodId!)!.add(row.weekday!);
  for (const [periodId, days] of weekdays)
    for (const weekday of [...days].sort((a, b) => a - b))
      uses.get(periodId)!.push({ kind: "week", weekday });
  for (const row of specialDayPaint)
    uses.get(row.periodId!)!.push({
      kind: "special_day",
      specialDayId: row.specialDayId,
      name: row.name,
      date: row.date,
    });
  return uses;
}

export async function deleteMenuPeriod(
  tx: Transaction,
  cfg: VenueScope,
  periodId: string,
): Promise<void> {
  await requirePeriod(tx, cfg, periodId);
  const uses = (await periodUses(tx, [periodId])).get(periodId)!;
  if (uses.length > 0) throw new AppError("menu_period.in_use", { periodId, uses });
  await tx.delete(menuPeriods).where(eq(menuPeriods.id, periodId));
}

export async function replaceMenuWeek(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  days: unknown,
  at: Date,
  expectedClockRevision: number,
  options: { seasonId?: string } = {},
): Promise<void> {
  const clock = await readLocationClock(tx, cfg.locationId);
  const week = parseMenuWeek(days, (value, field) => {
    const parsed = scheduleCutovers(clock).map((cutover) => parseServiceDay(value, field, cutover));
    return parsed[0]!;
  });
  await assertDepartment(tx, cfg, departmentId);
  await assertOwnPeriods(
    tx,
    departmentId,
    week.slots.map((slots, weekday) => ({ field: `days.${week.indexOf[weekday]}.slots`, slots })),
  );
  const targets = await targetSeasons(tx, cfg, options.seasonId);
  const samePeriod = (a: ServiceRange, b: ServiceRange) => a.periodId === b.periodId;
  const seasonWeek = week.slots.map((slots) => joinTouching(slots, samePeriod));
  const seasonsNow = (
    await readDepartmentSeasonWeeks(tx, cfg, [departmentId], clock.dayCutover)
  ).get(departmentId);
  const changed = targets.some((season) =>
    seasonWeek.some(
      (ranges, weekday) =>
        !sameScheduleRanges(
          joinTouching(seasonsNow?.get(season.id)?.[weekday] ?? [], samePeriod),
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
  await writeDepartmentSeasonWeeks(
    tx,
    departmentId,
    targets.flatMap((season) => (holding.has(season.id) ? [] : [season.id])),
    seasonWeek,
  );
  const clash = await endOffsetClash(tx, cfg, departmentId, false, clock);
  if (clash !== null)
    invalidTimetable(
      // A boundary clash lies in another season's day, which this request does not hold.
      clash.weekday === undefined ||
        (options.seasonId !== undefined && clash.seasonId !== options.seasonId)
        ? "days"
        : `days.${week.indexOf[clash.weekday]}.slots`,
      { reason: "end_offset", ...clash },
    );
}

type Folder = { id: string; name: string; parentId: string | null };

/**
 * The Routing tab's row order and each category's path, as `visibleRoutingRows` lays the rows out:
 * a category, then its child categories, then its products; No category and its products last.
 * `productSlot` is where a category's products sit, `null` keyed for the uncategorised.
 */
function routingRowPlaces(folders: readonly Folder[]) {
  const known = new Map(folders.map((folder) => [folder.id, folder]));
  const compare = createLabelComparator();
  const children = new Map<string, Folder[]>();
  const roots: Folder[] = [];
  for (const folder of folders) {
    const parent = folder.parentId;
    if (parent === null || parent === folder.id || !known.has(parent)) roots.push(folder);
    else children.set(parent, [...(children.get(parent) ?? []), folder]);
  }
  const byName = (a: Folder, b: Folder) => compare(a.name, b.name);
  roots.sort(byName);
  for (const list of children.values()) list.sort(byName);
  const categorySlot = new Map<string, number>();
  const productSlot = new Map<string | null, number>();
  const path = new Map<string, string[]>();
  let next = 1;
  const place = (folder: Folder, above: string[]) => {
    const own = [...above, folder.name];
    categorySlot.set(folder.id, next++);
    path.set(folder.id, own);
    for (const child of children.get(folder.id) ?? [])
      if (!categorySlot.has(child.id)) place(child, own);
    productSlot.set(folder.id, next++);
  };
  for (const root of roots) place(root, []);
  // What is left sits on or below a parent cycle; a cycle member is placed as a root.
  for (const folder of folders) {
    if (categorySlot.has(folder.id)) continue;
    const seen = new Set<string>();
    let member = folder;
    while (!seen.has(member.id)) {
      seen.add(member.id);
      member = known.get(member.parentId!)!;
    }
    place(member, []);
  }
  const noCategorySlot = next++;
  productSlot.set(null, next);
  return { categorySlot, productSlot, noCategorySlot, path, compare };
}

/** Each period's routing cells that hold a line for it, in the Routing tab's row order, then by
 * zone (Every zone first). */
export async function readRoutingUses(
  tx: Transaction,
  cfg: VenueScope,
): Promise<Map<string, PeriodRoutingUse[]>> {
  const rows = await tx
    .select({
      periodId: routingCellPeriods.periodId,
      noCategory: routingCells.noCategory,
      categoryId: routingCells.categoryId,
      productId: routingCells.productId,
      productName: products.name,
      productCategoryId: products.categoryId,
      zoneName: floorZones.name,
      zoneOrder: floorZones.displayOrder,
    })
    .from(routingCellPeriods)
    .innerJoin(routingCells, eq(routingCells.id, routingCellPeriods.cellId))
    .leftJoin(products, eq(products.id, routingCells.productId))
    .leftJoin(floorZones, eq(floorZones.id, routingCells.zoneId))
    .where(eq(routingCells.locationId, cfg.locationId));
  if (rows.length === 0) return new Map();
  const folders = await tx
    .select({ id: categories.id, name: categories.name, parentId: categoryDetails.parentId })
    .from(categories)
    .leftJoin(categoryDetails, eq(categoryDetails.categoryId, categories.id))
    .orderBy(asc(categories.name), asc(categories.id));
  const { categorySlot, productSlot, noCategorySlot, path, compare } = routingRowPlaces(folders);
  const placed = rows.map((row) => {
    let use: PeriodRoutingUse;
    let slot: number;
    if (row.categoryId !== null) {
      use = {
        rowKind: "category",
        rowLabel: path.get(row.categoryId)!.join(" › "),
        zoneName: row.zoneName,
      };
      slot = categorySlot.get(row.categoryId)!;
    } else if (row.productId !== null) {
      const folder =
        row.productCategoryId !== null && path.has(row.productCategoryId)
          ? row.productCategoryId
          : null;
      use = {
        rowKind: "product",
        rowLabel: [...(folder === null ? [] : path.get(folder)!), row.productName!].join(" › "),
        zoneName: row.zoneName,
      };
      slot = productSlot.get(folder)!;
    } else {
      use = {
        rowKind: row.noCategory ? "no_category" : "all",
        rowLabel: null,
        zoneName: row.zoneName,
      };
      slot = row.noCategory ? noCategorySlot : 0;
    }
    return {
      periodId: row.periodId,
      use,
      slot,
      name: row.productName ?? "",
      zoneOrder: row.zoneOrder,
    };
  });
  placed.sort(
    (a, b) =>
      a.slot - b.slot ||
      compare(a.name, b.name) ||
      (a.zoneOrder ?? -1) - (b.zoneOrder ?? -1) ||
      (a.use.zoneName ?? "").localeCompare(b.use.zoneName ?? ""),
  );
  const uses = new Map<string, PeriodRoutingUse[]>();
  for (const { periodId, use } of placed) uses.set(periodId, [...(uses.get(periodId) ?? []), use]);
  return uses;
}

/** The venue's active departments, the default first. */
export async function readActiveDepartments(tx: Transaction, cfg: VenueScope) {
  return tx
    .select({ id: departments.id, name: departments.name, active: departments.active })
    .from(departments)
    .where(and(eq(departments.locationId, cfg.locationId), eq(departments.active, true)))
    .orderBy(desc(departments.isDefault), asc(departments.name), asc(departments.id));
}

/** The menu periods of the venue's active departments. */
export async function readActivePeriods(tx: Transaction, cfg: VenueScope) {
  return tx
    .select({
      id: menuPeriods.id,
      departmentId: menuPeriods.departmentId,
      name: menuPeriods.name,
      colour: menuPeriods.colour,
      menuId: menuPeriods.menuId,
      endOffsetMinutes: menuPeriods.endOffsetMinutes,
    })
    .from(menuPeriods)
    .innerJoin(departments, eq(departments.id, menuPeriods.departmentId))
    .where(and(eq(departments.locationId, cfg.locationId), eq(departments.active, true)))
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
}

export async function readOpeningHoursModel(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<OpeningHoursModel> {
  const clock = await readLocationClock(tx, cfg.locationId);
  const moment = serviceMomentAt(at, clock);
  const status = await readBusinessDayScheduleStatus(tx, cfg, clock, at);
  const cutover =
    moment === null ? clock.dayCutover : serviceDayContext(clock, moment.businessDay).dayCutover;
  const departmentRows = await readActiveDepartments(tx, cfg);
  const periods = await readActivePeriods(tx, cfg);
  const staff = await tx
    .select({ periodId: menuPeriodStaffMenus.periodId, menuId: menuPeriodStaffMenus.menuId })
    .from(menuPeriodStaffMenus)
    .innerJoin(departments, eq(departments.id, menuPeriodStaffMenus.departmentId))
    .where(and(eq(departments.locationId, cfg.locationId), eq(departments.active, true)))
    .orderBy(asc(menuPeriodStaffMenus.displayOrder), asc(menuPeriodStaffMenus.menuId));
  const seasonList = await readSeasons(tx, cfg);
  const currentSeasonId =
    moment === null ? null : (seasonOn(seasonList, moment.businessDay)?.id ?? null);
  const seasonWeeks = await readDepartmentSeasonWeeks(
    tx,
    cfg,
    departmentRows.map((department) => department.id),
    cutover,
  );
  const zones = await readZoneClosedTimes(tx, cfg, cutover, seasonList);
  const menus = await tx
    .select({ id: catalogues.id, name: catalogues.name, active: catalogues.active })
    .from(catalogues)
    .orderBy(asc(catalogues.name), asc(catalogues.id));
  const graph = await loadSectionGraph(tx);
  const routingUses = await readRoutingUses(tx, cfg);
  const menuNames = new Map(menus.map((menu) => [menu.id, menu.name]));
  return {
    ...status,
    timeZone: clock.timeZone,
    clockReadable: moment !== null,
    dayCutover: cutover,
    menus: menus.map((menu) => ({
      ...menu,
      includes: directIncludedMenus(graph, menu.id).map((id) => menuNames.get(id)!),
    })),
    seasons: seasonList,
    currentSeasonId,
    departments: departmentRows.map((department) => {
      const stored = seasonWeeks.get(department.id);
      const weeks = seasonWeekList(seasonList, stored);
      const shape = (week: ServiceRange[][]) => week.map((slots, weekday) => ({ weekday, slots }));
      return {
        ...department,
        zones: zones
          .filter((zone) => zone.departmentId === department.id)
          .map(({ id, name, seasonWeeks }) => ({ id, name, seasonWeeks })),
        periods: periods
          .filter((period) => period.departmentId === department.id)
          .map(({ id, name, colour, menuId, endOffsetMinutes }) => ({
            id,
            name,
            colour,
            menuId,
            endOffsetMinutes,
            staffMenuIds: staff
              .filter((entry) => entry.periodId === id)
              .map((entry) => entry.menuId),
            weekdays: [0, 1, 2, 3, 4, 5, 6].filter((weekday) =>
              [...(stored?.values() ?? [])].some((week) =>
                week[weekday]!.some((range) => range.periodId === id),
              ),
            ),
            routingUses: routingUses.get(id) ?? [],
          })),
        seasonWeeks: weeks.map((entry) => ({
          seasonId: entry.seasonId,
          week: shape(entry.week),
        })),
      };
    }),
  };
}
