import { and, asc, desc, eq, gte, inArray, isNotNull, ne, or } from "drizzle-orm";
import { catalogues, newId, type Transaction } from "@waitron/db";
import { directIncludedMenus, loadSectionGraph } from "@waitron/catalogue";
import { readLocationClock } from "@waitron/reporting";
import { AppError } from "@waitron/shared";

import { isReadableClock, venueLocalMoment } from "./hours-clock.js";
import { addDays, weekdayOf } from "./hours-rules.js";
import { localTimeOccurrences } from "./hours-occurrences.js";
import {
  calendarDateOfTime,
  parseServiceDay,
  rangeInForce,
  rangeSpan,
  serviceMomentAt,
  type ServiceRange,
} from "./service-day.js";
import type { SpecialDateParticipant } from "./hours.js";
import { CALENDAR_COLOURS, type LocalDate } from "./hours-types.js";
import { invalidTimetable, menuPeriodName, parseMenuWeek } from "./menu-timetable-rules.js";
import { parseEndOffsetMinutes } from "./period-end-offset.js";
import type {
  DepartmentService,
  OpeningHoursModel,
  MenuPeriodInput,
  MenuPeriodUse,
  MenuSlot,
} from "./menu-timetable-types.js";
import { assertDepartment, resolveZoneContext, storedTime, type VenueScope } from "./operations.js";
import { specialDates } from "./schema/hours.js";
import { menuDayTimetables, menuPeriods, menuPeriodStaffMenus, menuSlots } from "./schema/menus.js";
import { departments } from "./schema/service.js";
import "./errors.js";

const wire = (time: string) => time.slice(0, 5);

export async function placeOpenPeriod(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  menuId: string,
): Promise<void> {
  const [existing] = await tx
    .select({ id: menuPeriods.id })
    .from(menuPeriods)
    .where(eq(menuPeriods.departmentId, departmentId))
    .limit(1);
  if (existing !== undefined) return;
  const { id } = await saveMenuPeriod(tx, cfg, departmentId, {
    name: "Open",
    menuId,
    staffMenuIds: [],
  });
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
  );
}

async function requireSpecialDate(tx: Transaction, cfg: VenueScope, id: string) {
  const [row] = await tx
    .select({ id: specialDates.id, date: specialDates.date })
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
  today: LocalDate | null;
  zone: string | null;
  cutover: string;
}

async function readVenueClock(tx: Transaction, cfg: VenueScope, at: Date): Promise<VenueClock> {
  const clock = await readLocationClock(tx, cfg.locationId);
  return {
    today: venueLocalMoment(at, clock)?.civilDate ?? null,
    zone: isReadableClock(clock) ? clock.timeZone : null,
    cutover: clock.dayCutover,
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
      startsAt: wire(row.startsAt),
      endsAt: wire(row.endsAt),
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
      if (
        localTimeOccurrences(
          end === "endsAt" && slot[end] === clock.cutover
            ? addDays(date, 1)
            : calendarDateOfTime(date, slot[end], clock.cutover),
          slot[end],
          clock.zone,
        ).length === 0
      )
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

export async function resolveDepartmentService(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  at: Date,
): Promise<DepartmentService> {
  await assertDepartment(tx, cfg, departmentId);
  const clock = await readLocationClock(tx, cfg.locationId);
  const moment = serviceMomentAt(at, clock);
  const periods = await tx
    .select({ id: menuPeriods.id, name: menuPeriods.name, menuId: menuPeriods.menuId })
    .from(menuPeriods)
    .where(eq(menuPeriods.departmentId, departmentId))
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
  const staff = await tx
    .select({ periodId: menuPeriodStaffMenus.periodId, menuId: menuPeriodStaffMenus.menuId })
    .from(menuPeriodStaffMenus)
    .where(eq(menuPeriodStaffMenus.departmentId, departmentId))
    .orderBy(asc(menuPeriodStaffMenus.displayOrder), asc(menuPeriodStaffMenus.menuId));
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
    endedMenuIds: [],
  };
  if (moment === null)
    return {
      ...closed,
      open: true,
      orderableMenuIds: [...new Set(periods.flatMap((period) => menusOf(period.id)))],
    };

  const yesterday = addDays(moment.businessDay, -1);
  const dates = await tx
    .select({
      id: specialDates.id,
      date: specialDates.date,
      closeWholeVenue: specialDates.closeWholeVenue,
    })
    .from(specialDates)
    .where(
      and(
        eq(specialDates.locationId, cfg.locationId),
        inArray(specialDates.date, [yesterday, moment.businessDay]),
      ),
    );
  const timetables = await tx
    .select({
      id: menuDayTimetables.id,
      weekday: menuDayTimetables.weekday,
      specialDateId: menuDayTimetables.specialDateId,
    })
    .from(menuDayTimetables)
    .where(
      and(
        eq(menuDayTimetables.departmentId, departmentId),
        or(
          inArray(menuDayTimetables.weekday, [weekdayOf(yesterday), moment.weekday]),
          dates.length === 0
            ? undefined
            : inArray(
                menuDayTimetables.specialDateId,
                dates.map((date) => date.id),
              ),
        ),
      ),
    );
  const timetableOn = (date: string) => {
    const special = dates.find((entry) => entry.date === date);
    if (special?.closeWholeVenue) return undefined;
    return (
      (special === undefined
        ? undefined
        : timetables.find((entry) => entry.specialDateId === special.id)) ??
      timetables.find((entry) => entry.weekday === weekdayOf(date))
    );
  };
  const today = timetableOn(moment.businessDay);
  const previous = timetableOn(yesterday);
  const slots = await slotsByTimetable(
    tx,
    [today?.id, previous?.id].filter((id): id is string => id !== undefined),
  );
  const rangesOn = (id: string | undefined): ServiceRange[] =>
    id === undefined
      ? []
      : (slots.get(id) ?? [])
          .slice()
          .sort(
            (a, b) => rangeSpan(a, clock.dayCutover).start - rangeSpan(b, clock.dayCutover).start,
          );
  const ranges = rangesOn(today?.id);
  const running = rangeInForce(ranges, moment.minute, clock.dayCutover);
  const period =
    running === null ? undefined : periods.find((entry) => entry.id === running.periodId);
  const orderableMenuIds = period === undefined ? [] : menusOf(period.id);
  const ended = [
    ...rangesOn(previous?.id),
    ...ranges.filter((range) => rangeSpan(range, clock.dayCutover).end <= moment.minute),
  ];
  return {
    departmentId,
    open: period !== undefined,
    periodId: period?.id ?? null,
    periodName: period?.name ?? null,
    customerMenuId: period?.menuId ?? null,
    orderableMenuIds,
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
): Promise<{ id: string }> {
  return writeMenuPeriod(tx, cfg, departmentId, null, period);
}

async function writeMenuPeriod(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  periodId: string | null,
  period: MenuPeriodInput,
): Promise<{ id: string }> {
  const name = menuPeriodName(period.name);
  const endOffsetMinutes = parseEndOffsetMinutes(
    period.endOffsetMinutes === undefined ? 0 : period.endOffsetMinutes,
  );
  await assertDepartment(tx, cfg, departmentId);
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
  return { id: id! };
}

export async function updateMenuPeriod(
  tx: Transaction,
  cfg: VenueScope,
  periodId: string,
  period: Partial<MenuPeriodInput>,
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
  await writeMenuPeriod(tx, cfg, stored.departmentId, periodId, {
    name: period.name === undefined ? stored.name : period.name,
    menuId: period.menuId === undefined ? stored.menuId : period.menuId,
    colour: period.colour === undefined ? appearance!.colour : period.colour,
    staffMenuIds:
      period.staffMenuIds === undefined ? staff.map((row) => row.menuId) : period.staffMenuIds,
    endOffsetMinutes:
      period.endOffsetMinutes === undefined ? stored.endOffsetMinutes : period.endOffsetMinutes,
  });
}

/** Every day that places each listed period: weekdays in order, then special dates by date. */
async function periodUses(
  tx: Transaction,
  periodIds: readonly string[],
): Promise<Map<string, MenuPeriodUse[]>> {
  const uses = new Map<string, MenuPeriodUse[]>(periodIds.map((id) => [id, []]));
  if (periodIds.length === 0) return uses;
  const rows = await tx
    .selectDistinct({
      periodId: menuSlots.periodId,
      weekday: menuDayTimetables.weekday,
      specialDateId: specialDates.id,
      date: specialDates.date,
    })
    .from(menuSlots)
    .innerJoin(menuDayTimetables, eq(menuDayTimetables.id, menuSlots.timetableId))
    .leftJoin(specialDates, eq(specialDates.id, menuDayTimetables.specialDateId))
    .where(inArray(menuSlots.periodId, [...periodIds]))
    .orderBy(asc(menuDayTimetables.weekday), asc(specialDates.date));
  const week = rows.filter((row) => row.weekday !== null);
  const dated = rows.filter((row) => row.weekday === null);
  for (const row of week) uses.get(row.periodId)!.push({ kind: "week", weekday: row.weekday! });
  for (const row of dated)
    uses.get(row.periodId)!.push({
      kind: "special_date",
      specialDateId: row.specialDateId!,
      date: row.date!,
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
): Promise<void> {
  void at;
  const clock = await readLocationClock(tx, cfg.locationId);
  const week = parseMenuWeek(days, (value, field) =>
    parseServiceDay(value, field, clock.dayCutover),
  );
  await assertDepartment(tx, cfg, departmentId);
  await assertOwnPeriods(
    tx,
    departmentId,
    week.slots.map((slots, weekday) => ({ field: `days.${week.indexOf[weekday]}.slots`, slots })),
  );
  const existing = await tx
    .select({ id: menuDayTimetables.id, weekday: menuDayTimetables.weekday })
    .from(menuDayTimetables)
    .where(
      and(eq(menuDayTimetables.departmentId, departmentId), isNotNull(menuDayTimetables.weekday)),
    );
  const idOf = (weekday: number) => existing.find((row) => row.weekday === weekday)?.id;
  const emptied = [0, 1, 2, 3, 4, 5, 6]
    .filter((weekday) => week.slots[weekday]!.length === 0)
    .flatMap((weekday) => idOf(weekday) ?? []);
  if (emptied.length > 0)
    await tx.delete(menuDayTimetables).where(inArray(menuDayTimetables.id, emptied));
  for (const [weekday, slots] of week.slots.entries())
    if (slots.length > 0) await writeDay(tx, idOf(weekday), { departmentId, weekday }, slots);
}

export async function saveSpecialDateMenus(
  tx: Transaction,
  cfg: VenueScope,
  specialDateId: string,
  departmentId: string,
  slots: unknown,
  at: Date,
): Promise<void> {
  const clock = await readVenueClock(tx, cfg, at);
  const parsed = parseServiceDay(slots, "slots", clock.cutover);
  const special = await requireSpecialDate(tx, cfg, specialDateId);
  await assertDepartment(tx, cfg, departmentId);
  await assertOwnPeriods(tx, departmentId, [{ field: "slots", slots: parsed }]);
  const skipped = skippedSlot(clock, special.date, parsed);
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
  await writeDay(tx, existing?.id, { departmentId, specialDateId }, parsed);
}

export async function clearSpecialDateMenus(
  tx: Transaction,
  cfg: VenueScope,
  specialDateId: string,
  departmentId: string,
  at: Date,
): Promise<void> {
  void at;
  await requireSpecialDate(tx, cfg, specialDateId);
  await assertDepartment(tx, cfg, departmentId);
  const [existing] = await tx
    .select({ id: menuDayTimetables.id })
    .from(menuDayTimetables)
    .where(
      and(
        eq(menuDayTimetables.specialDateId, specialDateId),
        eq(menuDayTimetables.departmentId, departmentId),
      ),
    );
  if (existing === undefined) return;
  await tx.delete(menuDayTimetables).where(eq(menuDayTimetables.id, existing.id));
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
    for (const date of dates)
      if (skippedSlot(clock, date, slots) !== null)
        invalidTimetable("date", { date, departmentId, reason: "clock_skips" });
}

/**
 * Hours hands this every duplicate, move and delete of a special date, in its transaction. A
 * duplicate's copies are written target by target and checked together once all exist.
 */
export const MENU_TIMETABLE_CALENDAR_PARTICIPANT: SpecialDateParticipant = {
  async copy(tx, _cfg, sourceId, targetId) {
    for (const { departmentId, slots } of await dateTimetables(tx, sourceId))
      await writeDay(tx, undefined, { departmentId, specialDateId: targetId }, slots);
  },
  async afterCopies(tx, cfg, sourceId, targets, at) {
    await assertPlaced(
      await readVenueClock(tx, cfg, at),
      await dateTimetables(tx, sourceId),
      targets.map((target) => target.date),
    );
  },
  async beforeMove(tx, cfg, id, toDate, at) {
    await assertPlaced(await readVenueClock(tx, cfg, at), await dateTimetables(tx, id), [toDate]);
  },
  async beforeDelete() {},
};

export async function readOpeningHoursModel(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<OpeningHoursModel> {
  const clock = await readLocationClock(tx, cfg.locationId);
  const moment = serviceMomentAt(at, clock);
  const departmentRows = await tx
    .select({ id: departments.id, name: departments.name, active: departments.active })
    .from(departments)
    .where(eq(departments.locationId, cfg.locationId))
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
    .where(eq(departments.locationId, cfg.locationId))
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
  const staff = await tx
    .select({ periodId: menuPeriodStaffMenus.periodId, menuId: menuPeriodStaffMenus.menuId })
    .from(menuPeriodStaffMenus)
    .innerJoin(departments, eq(departments.id, menuPeriodStaffMenus.departmentId))
    .where(eq(departments.locationId, cfg.locationId))
    .orderBy(asc(menuPeriodStaffMenus.displayOrder), asc(menuPeriodStaffMenus.menuId));
  const timetables = await tx
    .select({
      id: menuDayTimetables.id,
      departmentId: menuDayTimetables.departmentId,
      weekday: menuDayTimetables.weekday,
      specialDateId: menuDayTimetables.specialDateId,
    })
    .from(menuDayTimetables)
    .innerJoin(departments, eq(departments.id, menuDayTimetables.departmentId))
    .where(eq(departments.locationId, cfg.locationId))
    .orderBy(asc(menuDayTimetables.weekday), asc(menuDayTimetables.specialDateId));
  const slots = await slotsByTimetable(
    tx,
    timetables.map((row) => row.id),
  );
  const ranges = (id: string): ServiceRange[] =>
    slots
      .get(id)!
      .slice()
      .sort((a, b) => rangeSpan(a, clock.dayCutover).start - rangeSpan(b, clock.dayCutover).start);
  const dates = await tx
    .select({
      id: specialDates.id,
      date: specialDates.date,
      name: specialDates.name,
      colour: specialDates.colour,
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
  const menus = await tx
    .select({ id: catalogues.id, name: catalogues.name, active: catalogues.active })
    .from(catalogues)
    .orderBy(asc(catalogues.name), asc(catalogues.id));
  const graph = await loadSectionGraph(tx);
  const menuNames = new Map(menus.map((menu) => [menu.id, menu.name]));
  return {
    timeZone: clock.timeZone,
    clockReadable: moment !== null,
    dayCutover: clock.dayCutover,
    menus: menus.map((menu) => ({
      ...menu,
      includes: directIncludedMenus(graph, menu.id).map((id) => menuNames.get(id)!),
    })),
    specialDates: dates,
    departments: departmentRows.map((department) => {
      const days = timetables.filter((row) => row.departmentId === department.id);
      return {
        ...department,
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
            weekdays: days
              .filter(
                (day) =>
                  day.weekday !== null && ranges(day.id).some((range) => range.periodId === id),
              )
              .map((day) => day.weekday!),
          })),
        week: [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
          const day = days.find((row) => row.weekday === weekday);
          return { weekday, slots: day === undefined ? [] : ranges(day.id) };
        }),
        dates: days
          .filter((row) => row.specialDateId !== null)
          .map((day) => ({ specialDateId: day.specialDateId!, slots: ranges(day.id) })),
      };
    }),
  };
}
