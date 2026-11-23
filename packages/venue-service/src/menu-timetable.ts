import {
  writeHours,
  sameScheduleRanges,
  readBusinessDayScheduleRevision,
  readBusinessDayScheduleStatus,
} from "./business-day-schedule.js";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import {
  menus,
  categories,
  floorPlanSets,
  departments,
  floorZones,
  menuPeriods,
  products,
  readVenueClock,
  routingCellPeriods,
  routingCells,
  type Transaction,
} from "@waitron/db";
import { directIncludedMenus, loadSectionGraph, refuseSetMenu } from "@waitron/menu";
import { AppError, createLabelComparator, type BusinessDayClock } from "@waitron/shared";
import { starterName, type StarterStaffLanguage } from "@waitron/country-packs";

import { rowKey, visibleRoutingRows } from "./routing.js";
import { occurrenceKey } from "./floor-layout-due.js";
import {
  parseServiceDayWithPositions,
  rangeInForce,
  rangeSpan,
  rangeSpanInDay,
  serviceMomentAt,
  type AtPosition,
  type ServiceMoment,
  type ServiceRange,
} from "./service-day.js";
import { CALENDAR_COLOURS } from "./hours-types.js";
import { invalidTimetable, menuPeriodName, parseMenuWeek } from "./menu-timetable-rules.js";
import type {
  DepartmentService,
  OpeningHoursModel,
  MenuPeriodInput,
  PeriodRoutingUse,
} from "./menu-timetable-types.js";
import { assertDepartment, resolveZoneContext } from "./operations.js";
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
import { seasonOn, type Season } from "./season-rules.js";
import { readSeasons } from "./seasons.js";
import {
  scheduleCutovers,
  serviceDayContext,
  inForceClock,
  type ServiceDayContext,
} from "./service-day-context.js";
import { STARTER_PERIOD_NAMES } from "./starter-content.js";
import { readStarterStaffLanguage } from "./starter-language.js";
import "./errors.js";

export const OPEN_PERIOD_NAME = "Open";

/** No column marks the starter period, so a lookup matches its name in every staff language. */
export const STARTER_OPEN_PERIOD_NAMES: readonly string[] = [
  OPEN_PERIOD_NAME,
  ...Object.values(STARTER_PERIOD_NAMES[OPEN_PERIOD_NAME]),
];

export async function placeOpenPeriod(
  tx: Transaction,
  departmentId: string,
  menuId: string,
  staffLanguage?: StarterStaffLanguage,
): Promise<void> {
  await assertDepartment(tx, departmentId);
  const [existing] = await tx
    .select({ id: menuPeriods.id })
    .from(menuPeriods)
    .where(eq(menuPeriods.departmentId, departmentId))
    .limit(1);
  if (existing !== undefined) return;
  const language = staffLanguage ?? (await readStarterStaffLanguage(tx));
  const clockRevision = await readBusinessDayScheduleRevision(tx);
  const { id } = await saveMenuPeriod(tx, departmentId, {
    name: starterName(STARTER_PERIOD_NAMES, OPEN_PERIOD_NAME, language),
    menuId,
    staffMenuIds: [],
  });
  await replaceMenuWeek(
    tx,
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

export async function requirePeriod(tx: Transaction, periodId: string) {
  const [row] = await tx
    .select({
      id: menuPeriods.id,
      departmentId: menuPeriods.departmentId,
      name: menuPeriods.name,
      menuId: menuPeriods.menuId,
      floorPlanSetId: menuPeriods.floorPlanSetId,
    })
    .from(menuPeriods)
    .innerJoin(departments, eq(departments.id, menuPeriods.departmentId))
    .where(eq(menuPeriods.id, periodId));
  if (row === undefined) throw new AppError("menu_period.not_found", { periodId });
  await assertDepartment(tx, row.departmentId);
  return row;
}

/** Refuses a slot naming a period that is not the department's own. */
function assertOwnPeriods(
  own: ReadonlySet<string>,
  days: readonly { field: string; slots: readonly AtPosition<ServiceRange>[] }[],
): void {
  for (const { field, slots } of days)
    for (const slot of slots)
      if (!own.has(slot.periodId)) invalidTimetable(`${field}.${slot.position}.periodId`);
}

/** What staging a department week reads, for every listed department at once. */
export type DepartmentWeekReads = {
  active: ReadonlySet<string>;
  periods: ReadonlyMap<string, ReadonlySet<string>>;
  seasonWeeks: Awaited<ReturnType<typeof readDepartmentSeasonWeeks>>;
};

export async function readDepartmentWeekReads(
  tx: Transaction,
  departmentIds: readonly string[],
  clock: BusinessDayClock,
): Promise<DepartmentWeekReads> {
  const ids = [...new Set(departmentIds)];
  if (ids.length === 0) return { active: new Set(), periods: new Map(), seasonWeeks: new Map() };
  const activeRows = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(inArray(departments.id, ids), eq(departments.active, true)));
  const periodRows = await tx
    .select({ id: menuPeriods.id, departmentId: menuPeriods.departmentId })
    .from(menuPeriods)
    .where(inArray(menuPeriods.departmentId, ids));
  const periods = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const row of periodRows) periods.get(row.departmentId)!.add(row.id);
  return {
    active: new Set(activeRows.map((row) => row.id)),
    periods,
    seasonWeeks: await readDepartmentSeasonWeeks(tx, ids, clock.dayCutover),
  };
}

export async function departmentDay(
  tx: Transaction,
  departmentId: string,
  moment: ServiceMoment | null,
  clock: BusinessDayClock,
  plan?: DayPlan,
) {
  const rows = await tx
    .select({
      id: menuPeriods.id,
      name: menuPeriods.name,
      menuId: menuPeriods.menuId,
      staffMenuIds: menuPeriods.staffMenuIds,
    })
    .from(menuPeriods)
    .where(eq(menuPeriods.departmentId, departmentId))
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
  const periods = rows.map(({ id, name, menuId }) => ({ id, name, menuId }));
  const staff = rows
    .flatMap((row) =>
      row.staffMenuIds.map((menuId, position) => ({
        periodId: row.id,
        menuId,
        position,
      })),
    )
    .sort((a, b) => a.position - b.position || a.menuId.localeCompare(b.menuId))
    .map(({ periodId, menuId }) => ({ periodId, menuId }));
  if (moment === null) return { periods, staff, ranges: [] };
  const days = await resolveDepartmentDays(tx, departmentId, [moment.businessDay], clock, plan);
  return { periods, staff, ranges: days.get(moment.businessDay)!.ranges };
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

function keepOpenSubject(
  ranges: readonly ServiceRange[],
  day: Awaited<ReturnType<typeof departmentDay>>,
  moment: ServiceMoment,
  cutover: string,
  context: ServiceDayContext,
): DepartmentService["keepOpen"] {
  const runs = serviceRuns(ranges);
  const running = rangeInForce(runs, moment.minute, cutover, context);
  const run =
    running ??
    runs
      .slice()
      .reverse()
      .find((range) => rangeSpanInDay(range, context).end <= moment.minute);
  if (run === undefined) return null;
  const period = day.periods.find((entry) => entry.id === run.periodId)!;
  return {
    periodId: period.id,
    periodName: period.name,
    endsAt: run.endsAt,
    running: running !== null,
  };
}

export async function resolveDepartmentService(
  tx: Transaction,
  departmentId: string,
  at: Date,
  prepared?: { clock: BusinessDayClock; plan?: DayPlan },
): Promise<DepartmentService> {
  await assertDepartment(tx, departmentId);
  const clock = prepared?.clock ?? (await readVenueClock(tx));
  const moment = serviceMomentAt(at, clock);
  const day = await departmentDay(tx, departmentId, moment, clock, prepared?.plan);
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
    periodOccurrenceKey: null,
    periodName: null,
    customerMenuId: null,
    orderableMenuIds: [],
    endedMenus: [],
    keepOpen: null,
  };
  if (moment === null)
    return {
      ...closed,
      open: true,
      orderableMenuIds: [...new Set(periods.flatMap((period) => menusOf(period.id)))],
    };

  const context = serviceDayContext(clock, moment.businessDay);
  const ranges = day.ranges;
  const runs = serviceRuns(ranges);
  const running = rangeInForce(runs, moment.minute, context.dayCutover, context);
  const period =
    running === null ? undefined : periods.find((entry) => entry.id === running.periodId);
  const orderableMenuIds = [
    ...new Set(
      runs.flatMap((range) => {
        const span = rangeSpan(range, context.dayCutover);
        const boundaryEnd = range.endsAt === context.dayCutover && context.endMinute === 1440;
        return moment.minute >= span.start &&
          (boundaryEnd || moment.minute < Math.min(span.end, context.endMinute))
          ? menusOf(range.periodId)
          : [];
      }),
    ),
  ];
  const endedPeriod = new Map<string, { periodId: string; periodName: string }>();
  for (const range of runs.filter((run) => rangeSpanInDay(run, context).end <= moment.minute)) {
    const periodName = periods.find((entry) => entry.id === range.periodId)!.name;
    for (const menuId of menusOf(range.periodId))
      endedPeriod.set(menuId, { periodId: range.periodId, periodName });
  }
  return {
    departmentId,
    open: period !== undefined,
    periodId: period?.id ?? null,
    periodOccurrenceKey:
      period === undefined || running === null
        ? null
        : occurrenceKey(departmentId, moment.businessDay, running),
    periodName: period?.name ?? null,
    customerMenuId: period?.menuId ?? null,
    orderableMenuIds,
    keepOpen: keepOpenSubject(ranges, day, moment, context.dayCutover, context),
    endedMenus: [...endedPeriod]
      .filter(([menuId]) => !orderableMenuIds.includes(menuId))
      .map(([menuId, ended]) => ({ menuId, ...ended })),
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
  zoneId: string,
  at: Date,
  servedMenuIds: readonly string[],
): Promise<string | null> {
  const zone = await resolveZoneContext(tx, zoneId);
  const service = await resolveDepartmentService(tx, zone.departmentId, at);
  return servedDefault(
    service.customerMenuId,
    servedMenuIds.filter((id) => service.orderableMenuIds.includes(id)),
  );
}

export async function saveMenuPeriod(
  tx: Transaction,
  departmentId: string,
  period: MenuPeriodInput,
): Promise<{ id: string }> {
  return writeMenuPeriod(tx, departmentId, null, period);
}

async function writeMenuPeriod(
  tx: Transaction,
  departmentId: string,
  periodId: string | null,
  period: MenuPeriodInput,
): Promise<{ id: string }> {
  const name = menuPeriodName(period.name);
  await assertDepartment(tx, departmentId);
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
      .select({ id: menus.id })
      .from(menus)
      .where(and(eq(menus.id, menuId), eq(menus.active, true)));
    if (menu === undefined) throw new AppError("menu.not_found", { menuId });
    await refuseSetMenu(tx, menuId);
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
  const floorPlanSetId = period.floorPlanSetId ?? null;
  if (floorPlanSetId !== null) {
    const [own] = await tx
      .select({ setId: floorPlanSets.id })
      .from(floorPlanSets)
      .where(
        and(eq(floorPlanSets.id, floorPlanSetId), eq(floorPlanSets.departmentId, departmentId)),
      );
    if (own === undefined) throw new AppError("menu_period.invalid", { field: "floorPlanSetId" });
  }
  const values = { name, menuId: period.menuId, staffMenuIds, colour, floorPlanSetId };
  let id = periodId;
  if (periodId === null) {
    const [row] = await tx
      .insert(menuPeriods)
      .values({ departmentId, ...values })
      .returning({ id: menuPeriods.id });
    id = row!.id;
  } else {
    await tx.update(menuPeriods).set(values).where(eq(menuPeriods.id, periodId));
  }
  return { id: id! };
}

export async function updateMenuPeriod(
  tx: Transaction,
  periodId: string,
  period: Partial<MenuPeriodInput>,
): Promise<void> {
  const stored = await requirePeriod(tx, periodId);
  const [appearance] = await tx
    .select({ colour: menuPeriods.colour, staffMenuIds: menuPeriods.staffMenuIds })
    .from(menuPeriods)
    .where(eq(menuPeriods.id, periodId));
  await writeMenuPeriod(tx, stored.departmentId, periodId, {
    name: period.name === undefined ? stored.name : period.name,
    menuId: period.menuId === undefined ? stored.menuId : period.menuId,
    colour: period.colour === undefined ? appearance!.colour : period.colour,
    staffMenuIds:
      period.staffMenuIds === undefined ? appearance!.staffMenuIds : period.staffMenuIds,
    floorPlanSetId:
      period.floorPlanSetId === undefined ? stored.floorPlanSetId : period.floorPlanSetId,
  });
}

export async function replaceMenuWeek(
  tx: Transaction,
  departmentId: string,
  days: unknown,
  at: Date,
  expectedClockRevision: number,
  // Named-season writes let fixtures exercise live readers against different seasons.
  options: { seasonId?: string } = {},
): Promise<void> {
  const clock = await readVenueClock(tx);
  const inForce = inForceClock(clock, at);
  const staged = await stageMenuWeek(tx, departmentId, days, inForce, options.seasonId);
  await writeHours(
    tx,
    { at, clock, changeKind: staged.changed ? "time" : "metadata", expectedClockRevision },
    staged.write,
  );
}

/** A department week checked and compared with what its seasons hold, written by `write`. */
export async function stageMenuWeek(
  tx: Transaction,
  departmentId: string,
  days: unknown,
  clock: BusinessDayClock,
  season: string | Season | undefined,
  reads?: DepartmentWeekReads,
): Promise<{ changed: boolean; write: () => Promise<void> }> {
  const week = parseMenuWeek(days, (value, field) => {
    const parsed = scheduleCutovers(clock).map((cutover) =>
      parseServiceDayWithPositions(value, field, cutover),
    );
    return parsed[0]!;
  });
  const known = reads ?? (await readDepartmentWeekReads(tx, [departmentId], clock));
  if (!known.active.has(departmentId)) throw new AppError("department.not_found", { departmentId });
  assertOwnPeriods(
    known.periods.get(departmentId)!,
    week.slots.map((slots, weekday) => ({ field: `days.${week.indexOf[weekday]}.slots`, slots })),
  );
  const targets = typeof season === "object" ? [season] : await targetSeasons(tx, season);
  const samePeriod = (a: ServiceRange, b: ServiceRange) => a.periodId === b.periodId;
  const seasonWeek = week.slots.map((slots) => joinTouching(slots, samePeriod));
  const seasonsNow = known.seasonWeeks.get(departmentId);
  const changed = targets.some((season) =>
    seasonWeek.some(
      (ranges, weekday) =>
        !sameScheduleRanges(
          joinTouching(seasonsNow?.get(season.id)?.[weekday] ?? [], samePeriod),
          ranges,
        ),
    ),
  );
  const holding = seasonsHolding(
    seasonsNow,
    targets.map((season) => season.id),
    seasonWeek,
  );
  return {
    changed,
    write: () =>
      writeDepartmentSeasonWeeks(
        tx,
        departmentId,
        targets.flatMap((season) => (holding.has(season.id) ? [] : [season.id])),
        seasonWeek,
      ),
  };
}

/** Each period's routing cells that hold a line for it, in the Routing tab's row order, then by
 * zone (Every zone first); `periodId`'s alone when given. */
export async function readRoutingUses(
  tx: Transaction,
  periodId?: string,
  language?: string,
): Promise<Map<string, PeriodRoutingUse[]>> {
  const rows = await tx
    .select({
      periodId: routingCellPeriods.periodId,
      noCategory: routingCells.noCategory,
      categoryId: routingCells.categoryId,
      productId: routingCells.productId,
      zoneName: floorZones.name,
      zoneOrder: floorZones.displayOrder,
    })
    .from(routingCellPeriods)
    .innerJoin(routingCells, eq(routingCells.id, routingCellPeriods.cellId))
    .leftJoin(floorZones, eq(floorZones.id, routingCells.zoneId))
    .where(periodId === undefined ? undefined : eq(routingCellPeriods.periodId, periodId));
  if (rows.length === 0) return new Map();
  const folders = await tx
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
    .from(categories)

    .orderBy(asc(categories.name), asc(categories.id));
  const productRows = await tx
    .select({ id: products.id, name: products.name, categoryId: products.categoryId })
    .from(products)
    .where(
      inArray(
        products.id,
        rows.flatMap((row) => (row.productId === null ? [] : [row.productId])),
      ),
    )
    .orderBy(asc(products.name), asc(products.id));
  const traversal = visibleRoutingRows(
    {
      categories: folders,
      products: productRows,
      cells: rows.map((row) => ({
        row:
          row.categoryId !== null
            ? { kind: "category" as const, categoryId: row.categoryId }
            : row.productId !== null
              ? { kind: "product" as const, productId: row.productId }
              : { kind: row.noCategory ? ("no_category" as const) : ("all" as const) },
        zoneId: null,
        target: { kind: "no_preparation" as const },
      })),
    },
    new Set(folders.map(({ id }) => id)),
    createLabelComparator(language),
  );
  const places = new Map(traversal.map((entry, index) => [rowKey(entry.row), { entry, index }]));
  const placed = rows.map((row) => {
    const rowAddress =
      row.categoryId !== null
        ? { kind: "category" as const, categoryId: row.categoryId }
        : row.productId !== null
          ? { kind: "product" as const, productId: row.productId }
          : { kind: row.noCategory ? ("no_category" as const) : ("all" as const) };
    const { entry, index: slot } = places.get(rowKey(rowAddress))!;
    const use: PeriodRoutingUse = {
      ...(rowAddress.kind === "category" || rowAddress.kind === "product"
        ? { rowKind: rowAddress.kind, rowLabel: [...entry.path, entry.name].join(" › ") }
        : { rowKind: rowAddress.kind, rowLabel: null }),
      zoneName: row.zoneName,
    };
    return {
      periodId: row.periodId,
      use,
      slot,
      zoneOrder: row.zoneOrder,
    };
  });
  placed.sort(
    (a, b) =>
      a.slot - b.slot ||
      (a.zoneOrder ?? -1) - (b.zoneOrder ?? -1) ||
      (a.use.zoneName ?? "").localeCompare(b.use.zoneName ?? ""),
  );
  const uses = new Map<string, PeriodRoutingUse[]>();
  for (const { periodId, use } of placed) uses.set(periodId, [...(uses.get(periodId) ?? []), use]);
  return uses;
}

/** The venue's active departments, the default first. */
export async function readActiveDepartments(tx: Transaction) {
  return tx
    .select({ id: departments.id, name: departments.name, active: departments.active })
    .from(departments)
    .where(eq(departments.active, true))
    .orderBy(desc(departments.isDefault), asc(departments.name), asc(departments.id));
}

/** The menu periods of the venue's active departments. */
export async function readActivePeriods(tx: Transaction) {
  return tx
    .select({
      id: menuPeriods.id,
      departmentId: menuPeriods.departmentId,
      name: menuPeriods.name,
      colour: menuPeriods.colour,
      menuId: menuPeriods.menuId,
      floorPlanSetId: menuPeriods.floorPlanSetId,
      staffMenuIds: menuPeriods.staffMenuIds,
    })
    .from(menuPeriods)
    .innerJoin(departments, eq(departments.id, menuPeriods.departmentId))
    .where(eq(departments.active, true))
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
}

export async function readOpeningHoursModel(tx: Transaction, at: Date): Promise<OpeningHoursModel> {
  const clock = await readVenueClock(tx);
  const moment = serviceMomentAt(at, clock);
  const status = await readBusinessDayScheduleStatus(tx, clock, at);
  const cutover =
    moment === null ? clock.dayCutover : serviceDayContext(clock, moment.businessDay).dayCutover;
  const departmentRows = await readActiveDepartments(tx);
  const periods = await readActivePeriods(tx);
  const seasonList = await readSeasons(tx);
  const currentSeasonId =
    moment === null ? null : (seasonOn(seasonList, moment.businessDay)?.id ?? null);
  const seasonWeeks = await readDepartmentSeasonWeeks(
    tx,
    departmentRows.map((department) => department.id),
    cutover,
  );
  const zones = await readZoneClosedTimes(tx, cutover, seasonList);
  const menuRows = await tx
    .select({ id: menus.id, name: menus.name, active: menus.active })
    .from(menus)
    .where(eq(menus.kind, "menu"))
    .orderBy(asc(menus.name), asc(menus.id));
  const graph = await loadSectionGraph(tx);
  const menuNames = new Map(menuRows.map((menu) => [menu.id, menu.name]));
  return {
    ...status,
    timeZone: clock.timeZone,
    clockReadable: moment !== null,
    dayCutover: cutover,
    menus: menuRows.map((menu) => ({
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
          .map(({ id, name, colour, menuId, floorPlanSetId, staffMenuIds }) => ({
            id,
            name,
            colour,
            menuId,
            floorPlanSetId,
            staffMenuIds,
          })),
        seasonWeeks: weeks.map((entry) => ({
          seasonId: entry.seasonId,
          week: shape(entry.week),
        })),
      };
    }),
  };
}
