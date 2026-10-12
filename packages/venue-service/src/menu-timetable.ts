import {
  assertBusinessDayScheduleWrite,
  sameScheduleRanges,
  readBusinessDayScheduleRevision,
  readBusinessDayScheduleStatus,
} from "./business-day-schedule.js";
import { and, asc, desc, eq, gte, inArray, isNotNull, ne, or } from "drizzle-orm";
import { catalogues, categories, floorZones, newId, products, type Transaction } from "@waitron/db";
import { categoryDetails, directIncludedMenus, loadSectionGraph } from "@waitron/catalogue";
import { readLocationClock } from "@waitron/reporting";
import { AppError, createLabelComparator, type BusinessDayClock } from "@waitron/shared";

import { isReadableClock, venueLocalMoment } from "./hours-clock.js";
import { addDays } from "./hours-rules.js";
import {
  clockTimeSkippedInDay,
  parseServiceDay,
  parseClosedRanges,
  rangeInForce,
  rangeSpan,
  rangeSpanInDay,
  serviceMomentAt,
  withExtension,
  type ServiceMoment,
  type ServiceRange,
} from "./service-day.js";
import type { SpecialDateParticipant } from "./hours.js";
import { CALENDAR_COLOURS, type LocalDate } from "./hours-types.js";
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
import {
  assertDepartment,
  resolveZoneContext,
  storedTime,
  wireTime,
  type VenueScope,
} from "./operations.js";
import { specialDates } from "./schema/hours.js";
import { nextOccurrence } from "./named-day-rules.js";
import { menuDayTimetables, menuPeriods, menuPeriodStaffMenus, menuSlots } from "./schema/menus.js";
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
import { departmentDayRanges, departmentDays } from "./schema/seasons.js";
import { zoneClosedTimes } from "./schema/zone-closed-times.js";
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

async function requireSpecialDate(tx: Transaction, cfg: VenueScope, id: string) {
  const [row] = await tx
    .select({
      id: specialDates.id,
      date: specialDates.date,
      ownHours: specialDates.ownHours,
      repeatOn: specialDates.repeatOn,
    })
    .from(specialDates)
    .where(and(eq(specialDates.id, id), eq(specialDates.locationId, cfg.locationId)));
  if (row === undefined) throw new AppError("special_date.not_found", { specialDateId: id });
  return row;
}

async function requirePeriod(tx: Transaction, cfg: VenueScope, periodId: string) {
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

/** The venue's date at `at` and its time zone, each null when the clock cannot be read. */
interface VenueClock {
  clock: BusinessDayClock;
  today: LocalDate | null;
  zone: string | null;
}

async function readVenueClock(tx: Transaction, cfg: VenueScope, at: Date): Promise<VenueClock> {
  const clock = await readLocationClock(tx, cfg.locationId);
  return {
    clock,
    today: venueLocalMoment(at, clock)?.civilDate ?? null,
    zone: isReadableClock(clock) ? clock.timeZone : null,
  };
}

/** Each listed timetable's slots in start order, wire times. */
async function slotsByTimetable(
  tx: Transaction,
  timetableIds: readonly string[],
): Promise<Map<string, MenuSlot[]>> {
  const byTimetable = new Map<string, MenuSlot[]>(timetableIds.map((id) => [id, []]));
  if (timetableIds.length === 0) return byTimetable;
  for (const row of await tx
    .select()
    .from(menuSlots)
    .where(inArray(menuSlots.timetableId, [...timetableIds]))
    .orderBy(asc(menuSlots.startsAt), asc(menuSlots.id)))
    byTimetable.get(row.timetableId)!.push({
      periodId: row.periodId,
      startsAt: wireTime(row.startsAt),
      endsAt: wireTime(row.endsAt),
    });
  return byTimetable;
}

/** The first slot that opens or closes at a minute the clock skips on `date`, or null; null too when
 * the clock cannot be read. */
function skippedSlot(
  clock: VenueClock,
  date: LocalDate,
  slots: readonly MenuSlot[],
): { position: number; end: "startsAt" | "endsAt" } | null {
  if (clock.zone === null) return null;
  for (const [position, slot] of slots.entries())
    for (const end of ["startsAt", "endsAt"] as const)
      if (clockTimeSkippedInDay(clock.clock, date, slot[end], end === "endsAt"))
        return { position, end };
  return null;
}

/** Writes one day's row if it is new, and replaces its slots by deleting then inserting them. */
async function writeDay(
  tx: Transaction,
  existingId: string | undefined,
  values: { departmentId: string; weekday?: number; specialDateId?: string },
  slots: readonly MenuSlot[],
): Promise<void> {
  const id = existingId ?? newId();
  if (existingId === undefined) await tx.insert(menuDayTimetables).values({ id, ...values });
  else await tx.delete(menuSlots).where(eq(menuSlots.timetableId, id));
  if (slots.length > 0)
    await tx.insert(menuSlots).values(
      slots.map((slot) => ({
        timetableId: id,
        departmentId: values.departmentId,
        periodId: slot.periodId,
        startsAt: storedTime(slot.startsAt),
        endsAt: storedTime(slot.endsAt),
      })),
    );
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
  const timetables = await tx
    .select({
      id: menuDayTimetables.id,
      departmentId: menuDayTimetables.departmentId,
      specialDateId: menuDayTimetables.specialDateId,
    })
    .from(menuDayTimetables)
    .innerJoin(departments, eq(departments.id, menuDayTimetables.departmentId))
    .where(
      and(
        eq(departments.locationId, cfg.locationId),
        isNotNull(menuDayTimetables.specialDateId),
        departmentId === undefined ? undefined : eq(departments.id, departmentId),
      ),
    );
  const slots = await slotsByTimetable(
    tx,
    timetables.map((day) => day.id),
  );
  const dates = await tx
    .select({
      id: specialDates.id,
      date: specialDates.date,
      closeWholeVenue: specialDates.closeWholeVenue,
      repeatOn: specialDates.repeatOn,
      ownHours: specialDates.ownHours,
    })
    .from(specialDates)
    .where(eq(specialDates.locationId, cfg.locationId));
  const offsets = new Map(periods.map((period) => [period.id, period.offset]));
  const departmentIds = [...new Set(periods.map((period) => period.departmentId))];
  const allSeasons = await readSeasons(tx, cfg);
  const weeks = await readDepartmentSeasonWeeks(tx, cfg, departmentIds, clock.dayCutover);
  const ownDay = new Map(
    timetables.map((day) => [`${day.departmentId}|${day.specialDateId}`, slots.get(day.id)!]),
  );
  for (const id of departmentIds) {
    const clash = findSeasonEndOffsetClash(
      allSeasons.map((season) => ({
        seasonId: season.id,
        startsOn: season.startsOn,
        week: weeks.get(id)?.get(season.id) ?? [],
      })),
      dates.map((date) => ({ ...date, slots: ownDay.get(`${id}|${date.id}`) ?? null })),
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
      };
    }
  }
  return null;
}

export async function assertPeriodEndOffsets(tx: Transaction, cfg: VenueScope): Promise<void> {
  const clash = await endOffsetClash(tx, cfg, undefined, true);
  if (clash !== null) invalidTimetable("dayCutover", { reason: "end_offset", ...clash });
}

async function assertCalendarEndOffsets(
  tx: Transaction,
  cfg: VenueScope,
  field: string,
  clock?: BusinessDayClock,
): Promise<void> {
  const clash = await endOffsetClash(tx, cfg, undefined, false, clock);
  if (clash !== null) throw new AppError("hours.invalid", { field, date: clash.date });
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

/** Every day that places each listed period: weekdays in order, then special dates by date. */
async function periodUses(
  tx: Transaction,
  periodIds: readonly string[],
): Promise<Map<string, MenuPeriodUse[]>> {
  const uses = new Map<string, MenuPeriodUse[]>(periodIds.map((id) => [id, []]));
  if (periodIds.length === 0) return uses;
  const dated = await tx
    .selectDistinct({
      periodId: menuSlots.periodId,
      specialDateId: specialDates.id,
      date: specialDates.date,
    })
    .from(menuSlots)
    .innerJoin(menuDayTimetables, eq(menuDayTimetables.id, menuSlots.timetableId))
    .innerJoin(specialDates, eq(specialDates.id, menuDayTimetables.specialDateId))
    .where(inArray(menuSlots.periodId, [...periodIds]))
    .orderBy(asc(specialDates.date));
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
  const weekdays = new Map<string, Set<number>>(periodIds.map((id) => [id, new Set()]));
  for (const row of painted) weekdays.get(row.periodId!)!.add(row.weekday!);
  for (const [periodId, days] of weekdays)
    for (const weekday of [...days].sort((a, b) => a - b))
      uses.get(periodId)!.push({ kind: "week", weekday });
  for (const row of dated)
    uses.get(row.periodId)!.push({
      kind: "special_date",
      specialDateId: row.specialDateId,
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

export async function saveSpecialDateMenus(
  tx: Transaction,
  cfg: VenueScope,
  specialDateId: string,
  departmentId: string,
  slots: unknown,
  at: Date,
  expectedClockRevision: number,
): Promise<void> {
  const clock = await readVenueClock(tx, cfg, at);
  const special = await requireSpecialDate(tx, cfg, specialDateId);
  const cutovers = scheduleCutovers(
    clock.clock,
    special.repeatOn === null ? special.date : undefined,
  );
  const parsed = cutovers.map((cutover) => parseServiceDay(slots, "slots", cutover))[0]!;
  await assertDepartment(tx, cfg, departmentId);
  if (!special.ownHours) throw new AppError("special_date.keeps_week", { specialDateId });
  await assertOwnPeriods(tx, departmentId, [{ field: "slots", slots: parsed }]);
  const occurrence = nextOccurrence(
    { date: special.date, repeats: special.repeatOn !== null },
    clock.today ?? special.date,
  );
  const skipped = skippedSlot(clock, occurrence ?? special.date, parsed);
  if (skipped !== null)
    invalidTimetable(`slots.${skipped.position}.${skipped.end}`, { reason: "clock_skips" });
  const [existing] = await tx
    .select({ id: menuDayTimetables.id })
    .from(menuDayTimetables)
    .where(
      and(
        eq(menuDayTimetables.specialDateId, specialDateId),
        eq(menuDayTimetables.departmentId, departmentId),
      ),
    );
  const currentSlots =
    existing === undefined ? [] : (await slotsByTimetable(tx, [existing.id])).get(existing.id)!;
  await assertBusinessDayScheduleWrite(
    tx,
    cfg,
    sameScheduleRanges(currentSlots, parsed) ? "metadata" : "time",
    at,
    expectedClockRevision,
    clock.clock,
  );
  await writeDay(tx, existing?.id, { departmentId, specialDateId }, parsed);
  const clash = await endOffsetClash(tx, cfg, departmentId, false, clock.clock);
  if (clash !== null) invalidTimetable("slots", { reason: "end_offset", ...clash });
}

async function dateTimetables(tx: Transaction, specialDateId: string) {
  const rows = await tx
    .select({ id: menuDayTimetables.id, departmentId: menuDayTimetables.departmentId })
    .from(menuDayTimetables)
    .where(eq(menuDayTimetables.specialDateId, specialDateId))
    .orderBy(asc(menuDayTimetables.departmentId));
  const slots = await slotsByTimetable(
    tx,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({ departmentId: row.departmentId, slots: slots.get(row.id)! }));
}

async function assertPlaced(
  clock: VenueClock,
  timetables: readonly { departmentId: string; slots: MenuSlot[] }[],
  dates: readonly LocalDate[],
): Promise<void> {
  for (const { departmentId, slots } of timetables)
    for (const date of dates) {
      parseServiceDay(slots, "date", serviceDayContext(clock.clock, date).dayCutover);
      if (skippedSlot(clock, date, slots) !== null)
        invalidTimetable("date", { date, departmentId, reason: "clock_skips" });
    }
}

async function assertCalendarRanges(
  tx: Transaction,
  cfg: VenueScope,
  field: string,
  clock: BusinessDayClock,
): Promise<void> {
  const dates = await tx
    .select()
    .from(specialDates)
    .where(eq(specialDates.locationId, cfg.locationId));
  for (const date of dates) {
    const cutovers = scheduleCutovers(clock, date.repeatOn === null ? date.date : undefined);
    for (const day of await dateTimetables(tx, date.id))
      for (const cutover of cutovers) parseServiceDay(day.slots, field, cutover);
    const closures = await tx
      .select()
      .from(zoneClosedTimes)
      .where(eq(zoneClosedTimes.specialDateId, date.id));
    for (const zoneId of new Set(closures.map((row) => row.zoneId)))
      for (const cutover of cutovers)
        parseClosedRanges(
          closures
            .filter((row) => row.zoneId === zoneId)
            .map((row) => ({ startsAt: wireTime(row.startsAt), endsAt: wireTime(row.endsAt) })),
          field,
          cutover,
        );
  }
}

/**
 * Hours hands this every duplicate, move and delete of a special date, in its transaction. A
 * duplicate's copies are written target by target and checked together once all exist.
 */
export const MENU_TIMETABLE_CALENDAR_PARTICIPANT: SpecialDateParticipant = {
  async copy(tx, _cfg, sourceId, targetId) {
    const closures = await tx
      .select({
        zoneId: zoneClosedTimes.zoneId,
        startsAt: zoneClosedTimes.startsAt,
        endsAt: zoneClosedTimes.endsAt,
      })
      .from(zoneClosedTimes)
      .where(eq(zoneClosedTimes.specialDateId, sourceId));
    if (closures.length > 0)
      await tx
        .insert(zoneClosedTimes)
        .values(closures.map((row) => ({ ...row, specialDateId: targetId })));
    for (const { departmentId, slots } of await dateTimetables(tx, sourceId))
      await writeDay(tx, undefined, { departmentId, specialDateId: targetId }, slots);
  },
  async afterCopies(tx, cfg, sourceId, targets, at) {
    const clock = await readVenueClock(tx, cfg, at);
    await assertPlaced(
      clock,
      await dateTimetables(tx, sourceId),
      targets.map((target) => target.date),
    );
    await assertCalendarRanges(tx, cfg, "date", clock.clock);
    await assertCalendarEndOffsets(tx, cfg, "date", clock.clock);
  },
  async beforeMove(tx, cfg, id, toDate, at) {
    await assertPlaced(await readVenueClock(tx, cfg, at), await dateTimetables(tx, id), [toDate]);
  },
  async afterChange(tx, cfg, field) {
    const clock = await readLocationClock(tx, cfg.locationId);
    await assertCalendarRanges(tx, cfg, field, clock);
    await assertCalendarEndOffsets(tx, cfg, field, clock);
  },
  async beforeDelete() {},
};

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
async function readRoutingUses(
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
  const departmentRows = await tx
    .select({ id: departments.id, name: departments.name, active: departments.active })
    .from(departments)
    .where(and(eq(departments.locationId, cfg.locationId), eq(departments.active, true)))
    .orderBy(desc(departments.isDefault), asc(departments.name), asc(departments.id));
  const periods = await tx
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
  const staff = await tx
    .select({ periodId: menuPeriodStaffMenus.periodId, menuId: menuPeriodStaffMenus.menuId })
    .from(menuPeriodStaffMenus)
    .innerJoin(departments, eq(departments.id, menuPeriodStaffMenus.departmentId))
    .where(and(eq(departments.locationId, cfg.locationId), eq(departments.active, true)))
    .orderBy(asc(menuPeriodStaffMenus.displayOrder), asc(menuPeriodStaffMenus.menuId));
  const timetables = await tx
    .select({
      id: menuDayTimetables.id,
      departmentId: menuDayTimetables.departmentId,
      specialDateId: menuDayTimetables.specialDateId,
    })
    .from(menuDayTimetables)
    .innerJoin(departments, eq(departments.id, menuDayTimetables.departmentId))
    .where(
      and(
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
        isNotNull(menuDayTimetables.specialDateId),
      ),
    )
    .orderBy(asc(menuDayTimetables.specialDateId));
  const slots = await slotsByTimetable(
    tx,
    timetables.map((row) => row.id),
  );
  const ranges = (id: string): ServiceRange[] =>
    slots
      .get(id)!
      .slice()
      .sort((a, b) => rangeSpan(a, cutover).start - rangeSpan(b, cutover).start);
  const seasonList = await readSeasons(tx, cfg);
  const currentSeasonId =
    moment === null ? null : (seasonOn(seasonList, moment.businessDay)?.id ?? null);
  const seasonWeeks = await readDepartmentSeasonWeeks(
    tx,
    cfg,
    departmentRows.map((department) => department.id),
    cutover,
  );
  const zones = await readZoneClosedTimes(tx, cfg, cutover, currentSeasonId, seasonList);
  const dateRows = await tx
    .select({
      id: specialDates.id,
      date: specialDates.date,
      name: specialDates.name,
      kind: specialDates.kind,
      repeatOn: specialDates.repeatOn,
      ownHours: specialDates.ownHours,
      closeWholeVenue: specialDates.closeWholeVenue,
    })
    .from(specialDates)
    .where(
      and(
        eq(specialDates.locationId, cfg.locationId),
        moment === null
          ? undefined
          : or(
              gte(specialDates.date, addDays(moment.businessDay, -1)),
              isNotNull(specialDates.repeatOn),
              inArray(
                specialDates.id,
                timetables.flatMap((row) =>
                  row.specialDateId === null ? [] : [row.specialDateId],
                ),
              ),
            ),
      ),
    )
    .orderBy(asc(specialDates.date));
  const dates = dateRows.map(({ repeatOn, ...row }) => ({
    ...row,
    repeats: repeatOn !== null,
  }));
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
    namedDays: dates,
    seasons: seasonList,
    currentSeasonId,
    departments: departmentRows.map((department) => {
      const days = timetables.filter((row) => row.departmentId === department.id);
      const stored = seasonWeeks.get(department.id);
      const weeks = seasonWeekList(seasonList, stored, currentSeasonId);
      const shape = (week: ServiceRange[][]) => week.map((slots, weekday) => ({ weekday, slots }));
      return {
        ...department,
        zones: zones
          .filter((zone) => zone.departmentId === department.id)
          .map(({ id, name, seasonWeeks, week, dates }) => ({
            id,
            name,
            seasonWeeks,
            week,
            dates,
          })),
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
        seasonWeeks: weeks.seasonWeeks.map((entry) => ({
          seasonId: entry.seasonId,
          week: shape(entry.week),
        })),
        week: shape(weeks.week),
        dates: days
          .filter((row) => row.specialDateId !== null)
          .map((day) => ({ specialDateId: day.specialDateId!, slots: ranges(day.id) })),
      };
    }),
  };
}
