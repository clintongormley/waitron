import { and, asc, desc, eq, gte, inArray, isNotNull, ne, or, type SQL } from "drizzle-orm";
import { catalogues, floorZones, newId, type Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { assertDepartment, assertMember, listDepartmentMenus } from "./department-menus.js";
import { isReadableClock, skippedEndpoint, venueLocalMoment } from "./hours-clock.js";
import { addDays, weekdayOf, type Interval } from "./hours-rules.js";
import type { SpecialDateParticipant } from "./hours.js";
import type { LocalDate } from "./hours-types.js";
import {
  firstMenuClash,
  invalidTimetable,
  menuPeriodName,
  parseMenuWeek,
  parseSlots,
  slotCell,
  slotInForce,
  slotIntervals,
} from "./menu-timetable-rules.js";
import type {
  MenuPeriod,
  MenuPeriodUse,
  MenuSlot,
  MenuTimetableModel,
  MenuWeekDay,
  ZoneMenuChoice,
} from "./menu-timetable-types.js";
import { storedTime, type VenueScope } from "./operations.js";
import { specialDates } from "./schema/hours.js";
import {
  departmentAllDayMenus,
  departmentMenus,
  menuDayTimetables,
  menuPeriods,
  menuSlots,
  zoneAllDayMenus,
  zonePeriodMenus,
} from "./schema/menus.js";
import { departments, zoneServicePolicies } from "./schema/service.js";
import "./errors.js";

const wire = (time: string) => time.slice(0, 5);

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
}

async function readVenueClock(tx: Transaction, cfg: VenueScope, at: Date): Promise<VenueClock> {
  const clock = await readLocationClock(tx, cfg.locationId);
  return {
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
      startsAt: wire(row.startsAt),
      endsAt: wire(row.endsAt),
    });
  return byTimetable;
}

/**
 * One department's week by weekday, Sunday first, and its special-date timetables on the dates
 * `where` selects, leaving out `exceptDateId`'s.
 */
async function readDepartmentDays(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  where: SQL | undefined,
  exceptDateId: string | null,
): Promise<{ week: Interval[][]; dates: Map<LocalDate, Interval[]> }> {
  const rows = await tx
    .select({
      id: menuDayTimetables.id,
      weekday: menuDayTimetables.weekday,
      date: specialDates.date,
    })
    .from(menuDayTimetables)
    .leftJoin(specialDates, eq(specialDates.id, menuDayTimetables.specialDateId))
    .where(
      and(
        eq(menuDayTimetables.departmentId, departmentId),
        or(
          isNotNull(menuDayTimetables.weekday),
          and(
            eq(specialDates.locationId, cfg.locationId),
            where,
            exceptDateId === null ? undefined : ne(specialDates.id, exceptDateId),
          ),
        ),
      ),
    );
  const slots = await slotsByTimetable(
    tx,
    rows.map((row) => row.id),
  );
  const week: Interval[][] = [0, 1, 2, 3, 4, 5, 6].map(() => []);
  const dates = new Map<LocalDate, Interval[]>();
  for (const row of rows) {
    const intervals = slotIntervals(slots.get(row.id)!);
    if (row.weekday !== null) week[row.weekday] = intervals;
    else dates.set(row.date!, intervals);
  }
  return { week, dates };
}

/**
 * Refuses one department's `proposed` special-date timetables when their slots overlap across a
 * midnight with the dates either side of each `touched` date. A touched date `proposed` leaves out
 * follows the week; `exceptDateId`'s stored timetable is not read. Pairs already past are left out.
 */
async function assertBesideNeighbours(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  today: LocalDate | null,
  proposed: ReadonlyMap<LocalDate, Interval[]>,
  touched: readonly LocalDate[],
  exceptDateId: string | null,
  clash: (date: LocalDate, other: LocalDate) => never,
): Promise<void> {
  const neighbours = touched.flatMap((date) => [addDays(date, -1), addDays(date, 1)]);
  const stored = await readDepartmentDays(
    tx,
    cfg,
    departmentId,
    inArray(specialDates.date, neighbours),
    exceptDateId,
  );
  for (const date of touched) stored.dates.delete(date);
  for (const [date, intervals] of proposed) stored.dates.set(date, intervals);
  const found = firstMenuClash(stored.dates, stored.week, touched, today);
  if (found !== null) clash(found.date, found.other);
}

/** The first slot that opens or closes at a minute the clock skips on `date`, or null; null too when
 * the clock cannot be read. */
function skippedSlot(
  zone: string | null,
  date: LocalDate,
  slots: readonly MenuSlot[],
): { position: number; end: "startsAt" | "endsAt" } | null {
  if (zone === null) return null;
  const skipped = skippedEndpoint(date, [{ cell: slotCell(slots) }], zone);
  if (skipped === null) return null;
  return { position: skipped.position, end: skipped.end === "opensAt" ? "startsAt" : "endsAt" };
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

/**
 * The menus zone `zoneId` offers at `at` and the one it starts on. Refused `service_zone.not_found`
 * for a zone that is not this venue's, or whose department is inactive. The statement-count case in
 * `menu-timetable.test.ts` measured the same number with one slot and one zone menu as with twenty
 * and five.
 */
export async function resolveZoneMenus(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  at: Date,
): Promise<ZoneMenuChoice> {
  const [zone] = await tx
    .select({
      departmentId: zoneServicePolicies.departmentId,
      zoneAllDay: zoneAllDayMenus.menuId,
      departmentAllDay: departmentAllDayMenus.menuId,
    })
    .from(zoneServicePolicies)
    .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .leftJoin(zoneAllDayMenus, eq(zoneAllDayMenus.zoneId, zoneServicePolicies.zoneId))
    .leftJoin(
      departmentAllDayMenus,
      eq(departmentAllDayMenus.departmentId, zoneServicePolicies.departmentId),
    )
    .where(
      and(
        eq(zoneServicePolicies.zoneId, zoneId),
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(departments.active, true),
      ),
    );
  if (zone === undefined) throw new AppError("service_zone.not_found", { zoneId });
  const { departmentId } = zone;
  const members = await tx
    .select({ menuId: departmentMenus.menuId })
    .from(departmentMenus)
    .innerJoin(catalogues, eq(catalogues.id, departmentMenus.menuId))
    .where(and(eq(departmentMenus.departmentId, departmentId), eq(catalogues.active, true)))
    .orderBy(asc(departmentMenus.displayOrder), asc(departmentMenus.menuId));
  const allDay = zone.zoneAllDay ?? zone.departmentAllDay;
  const choice = (defaultMenuId: string | null, periodId: string | null): ZoneMenuChoice => ({
    departmentId,
    availableMenuIds: members.map((row) => row.menuId),
    defaultMenuId,
    periodId,
  });
  const moment = venueLocalMoment(at, await readLocationClock(tx, cfg.locationId));
  if (moment === null) return choice(allDay, null);

  const today = moment.civilDate;
  const yesterday = addDays(today, -1);
  const days = await tx
    .select({
      id: menuDayTimetables.id,
      weekday: menuDayTimetables.weekday,
      date: specialDates.date,
    })
    .from(menuDayTimetables)
    .leftJoin(specialDates, eq(specialDates.id, menuDayTimetables.specialDateId))
    .where(
      and(
        eq(menuDayTimetables.departmentId, departmentId),
        or(
          inArray(menuDayTimetables.weekday, [weekdayOf(yesterday), weekdayOf(today)]),
          and(
            eq(specialDates.locationId, cfg.locationId),
            inArray(specialDates.date, [yesterday, today]),
          ),
        ),
      ),
    );
  const dayOf = (date: LocalDate) =>
    (days.find((day) => day.date === date) ?? days.find((day) => day.weekday === weekdayOf(date)))
      ?.id;
  const ids = [dayOf(yesterday), dayOf(today)].filter((id) => id !== undefined);
  const rows =
    ids.length === 0
      ? []
      : await tx
          .select({
            timetableId: menuSlots.timetableId,
            periodId: menuSlots.periodId,
            startsAt: menuSlots.startsAt,
            endsAt: menuSlots.endsAt,
            periodMenu: menuPeriods.menuId,
            zoneMenu: zonePeriodMenus.menuId,
          })
          .from(menuSlots)
          .innerJoin(menuPeriods, eq(menuPeriods.id, menuSlots.periodId))
          .leftJoin(
            zonePeriodMenus,
            and(
              eq(zonePeriodMenus.zoneId, zoneId),
              eq(zonePeriodMenus.periodId, menuSlots.periodId),
            ),
          )
          .where(inArray(menuSlots.timetableId, ids));
  const on = (id: string | undefined) =>
    rows
      .filter((row) => row.timetableId === id)
      .map((row) => ({ ...row, startsAt: wire(row.startsAt), endsAt: wire(row.endsAt) }));
  const slot = slotInForce(on(dayOf(today)), on(dayOf(yesterday)), moment.timeOfDay);
  if (slot === null) return choice(allDay, null);
  return choice(slot.zoneMenu ?? slot.periodMenu, slot.periodId);
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

/** The zone's default at `at` among the menus a caller found served, reading no publication. */
export async function resolveDefaultMenu(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  at: Date,
  servedMenuIds: readonly string[],
): Promise<string | null> {
  return servedDefault((await resolveZoneMenus(tx, cfg, zoneId, at)).defaultMenuId, servedMenuIds);
}

/** Creates (`id` null) or renames and re-points one of the department's named periods. */
export async function saveMenuPeriod(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  period: { id: string | null; name: string; menuId: string },
): Promise<MenuPeriod> {
  const name = menuPeriodName(period.name);
  await assertDepartment(tx, cfg, departmentId);
  await assertMember(tx, departmentId, period.menuId);
  if (period.id !== null) {
    const [own] = await tx
      .select({ id: menuPeriods.id })
      .from(menuPeriods)
      .where(and(eq(menuPeriods.id, period.id), eq(menuPeriods.departmentId, departmentId)));
    if (own === undefined) throw new AppError("menu_period.not_found", { periodId: period.id });
  }
  const [taken] = await tx
    .select({ id: menuPeriods.id })
    .from(menuPeriods)
    .where(
      and(
        eq(menuPeriods.departmentId, departmentId),
        eq(menuPeriods.name, name),
        period.id === null ? undefined : ne(menuPeriods.id, period.id),
      ),
    );
  if (taken !== undefined) throw new AppError("menu_period.name_taken", { departmentId, name });
  const values = { name, menuId: period.menuId };
  if (period.id === null) {
    const [row] = await tx
      .insert(menuPeriods)
      .values({ departmentId, ...values })
      .returning({ id: menuPeriods.id });
    return { id: row!.id, ...values };
  }
  await tx.update(menuPeriods).set(values).where(eq(menuPeriods.id, period.id));
  return { id: period.id, ...values };
}

/**
 * Renames or re-points a named period of this venue, in its own department; a field left out keeps
 * its stored value, so a menu choice cannot undo a rename saved since the caller last read.
 */
export async function updateMenuPeriod(
  tx: Transaction,
  cfg: VenueScope,
  periodId: string,
  period: { name?: string; menuId?: string },
): Promise<MenuPeriod> {
  const stored = await requirePeriod(tx, cfg, periodId);
  return saveMenuPeriod(tx, cfg, stored.departmentId, {
    id: periodId,
    name: period.name ?? stored.name,
    menuId: period.menuId ?? stored.menuId,
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

/**
 * Deletes a named period, and with it every zone's menu for it. Refused `menu_period.in_use`
 * while any day places it, past special dates included.
 */
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

/**
 * Replaces the department's whole week; a day with no slots offers the all-day default all day.
 * Refused when the week's slots overlap across a midnight with a special date's from the venue's
 * yesterday on (`field` `date`, naming that special date).
 */
export async function replaceMenuWeek(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  days: readonly MenuWeekDay[],
  at: Date,
): Promise<void> {
  const week = parseMenuWeek(days);
  await assertDepartment(tx, cfg, departmentId);
  await assertOwnPeriods(
    tx,
    departmentId,
    week.slots.map((slots, weekday) => ({ field: `days.${week.indexOf[weekday]}.slots`, slots })),
  );
  const { today } = await readVenueClock(tx, cfg, at);
  const stored = await readDepartmentDays(
    tx,
    cfg,
    departmentId,
    today === null ? undefined : gte(specialDates.date, addDays(today, -1)),
    null,
  );
  const intervals = week.slots.map((slots) => slotIntervals(slots));
  for (const date of [...stored.dates.keys()].sort())
    if (firstMenuClash(stored.dates, intervals, [date], today, true) !== null)
      invalidTimetable("date", { date, departmentId, reason: "overlap" });

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

/**
 * Gives the department a timetable of its own on a special date, replacing its week there; `slots`
 * may be empty, which offers the all-day default all day. Refused at `slots.N.startsAt` or
 * `slots.N.endsAt` for a time the clock skips that date, and at `slots`, naming the other date,
 * when its slots overlap across a midnight with a neighbour's.
 */
export async function saveSpecialDateMenus(
  tx: Transaction,
  cfg: VenueScope,
  specialDateId: string,
  departmentId: string,
  slots: readonly MenuSlot[],
  at: Date,
): Promise<void> {
  const parsed = parseSlots(slots, "slots");
  const special = await requireSpecialDate(tx, cfg, specialDateId);
  await assertDepartment(tx, cfg, departmentId);
  await assertOwnPeriods(tx, departmentId, [{ field: "slots", slots: parsed }]);
  const clock = await readVenueClock(tx, cfg, at);
  const skipped = skippedSlot(clock.zone, special.date, parsed);
  if (skipped !== null) invalidTimetable(`slots.${skipped.position}.${skipped.end}`);
  await assertBesideNeighbours(
    tx,
    cfg,
    departmentId,
    clock.today,
    new Map([[special.date, slotIntervals(parsed)]]),
    [special.date],
    specialDateId,
    (_, other) => invalidTimetable("slots", { date: other, departmentId, reason: "overlap" }),
  );
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

/**
 * Returns the department to its normal week on a special date, a past one included. Refused
 * (`field` `date`, naming the neighbour) when the week would overlap a neighbour's slots.
 */
export async function clearSpecialDateMenus(
  tx: Transaction,
  cfg: VenueScope,
  specialDateId: string,
  departmentId: string,
  at: Date,
): Promise<void> {
  const special = await requireSpecialDate(tx, cfg, specialDateId);
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
  await assertBesideNeighbours(
    tx,
    cfg,
    departmentId,
    (await readVenueClock(tx, cfg, at)).today,
    new Map(),
    [special.date],
    specialDateId,
    (_, other) => invalidTimetable("date", { date: other, departmentId, reason: "overlap" }),
  );
  await tx.delete(menuDayTimetables).where(eq(menuDayTimetables.id, existing.id));
}

/**
 * A zone's own menu for one of its department's named periods; `null` inherits the period's. An
 * inactive zone's may be set and cleared. A period of another department is refused at `periodId`.
 */
export async function setZonePeriodMenu(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  periodId: string,
  menuId: string | null,
): Promise<void> {
  const [policy] = await tx
    .select({ departmentId: zoneServicePolicies.departmentId })
    .from(zoneServicePolicies)
    .where(
      and(
        eq(zoneServicePolicies.zoneId, zoneId),
        eq(zoneServicePolicies.locationId, cfg.locationId),
      ),
    );
  if (policy === undefined) throw new AppError("service_zone.not_found", { zoneId });
  const period = await requirePeriod(tx, cfg, periodId);
  const { departmentId } = policy;
  if (period.departmentId !== departmentId) invalidTimetable("periodId");
  if (menuId === null) {
    await tx
      .delete(zonePeriodMenus)
      .where(and(eq(zonePeriodMenus.zoneId, zoneId), eq(zonePeriodMenus.periodId, periodId)));
    return;
  }
  await assertMember(tx, departmentId, menuId);
  await tx
    .insert(zonePeriodMenus)
    .values({ zoneId, periodId, departmentId, menuId })
    .onConflictDoUpdate({
      target: [zonePeriodMenus.zoneId, zonePeriodMenus.periodId],
      set: { menuId },
    });
}

/** Each department's timetables on one special date, with their slots. */
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

/**
 * Refuses placing `timetables` on each of `dates` (`field` `date`, naming that date, the department
 * and the `reason`) when a slot opens or closes at a minute the clock skips there, or overlaps a
 * neighbour's across a midnight, the other dates included. With `leaving`, that date's timetables go
 * back to the week too, and an overlap there names the neighbour.
 */
async function assertPlaced(
  tx: Transaction,
  cfg: VenueScope,
  clock: VenueClock,
  exceptDateId: string | null,
  timetables: readonly { departmentId: string; slots: MenuSlot[] }[],
  dates: readonly LocalDate[],
  leaving: LocalDate | null,
): Promise<void> {
  for (const { departmentId, slots } of timetables) {
    for (const date of dates)
      if (skippedSlot(clock.zone, date, slots) !== null)
        invalidTimetable("date", { date, departmentId, reason: "clock_skips" });
    await assertBesideNeighbours(
      tx,
      cfg,
      departmentId,
      clock.today,
      new Map(dates.map((date) => [date, slotIntervals(slots)])),
      leaving === null ? dates : [...dates, leaving],
      exceptDateId,
      (touched, other) =>
        invalidTimetable("date", {
          date: dates.includes(touched) ? touched : other,
          departmentId,
          reason: "overlap",
        }),
    );
  }
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
      tx,
      cfg,
      await readVenueClock(tx, cfg, at),
      null,
      await dateTimetables(tx, sourceId),
      targets.map((target) => target.date),
      null,
    );
  },
  async beforeMove(tx, cfg, id, toDate, at) {
    const from = await requireSpecialDate(tx, cfg, id);
    const clock = await readVenueClock(tx, cfg, at);
    await assertPlaced(tx, cfg, clock, id, await dateTimetables(tx, id), [toDate], from.date);
  },
  async beforeDelete(tx, cfg, id, at) {
    const special = await requireSpecialDate(tx, cfg, id);
    const { today } = await readVenueClock(tx, cfg, at);
    for (const { departmentId } of await dateTimetables(tx, id))
      await assertBesideNeighbours(
        tx,
        cfg,
        departmentId,
        today,
        new Map(),
        [special.date],
        id,
        (_, other) => invalidTimetable("date", { date: other, departmentId, reason: "overlap" }),
      );
  },
};

/** Everything the menu timetable editor shows. */
export async function readMenuTimetableModel(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<MenuTimetableModel> {
  const clock = await readLocationClock(tx, cfg.locationId);
  const civilDate = venueLocalMoment(at, clock)?.civilDate ?? null;
  const departmentRows = await tx
    .select({ id: departments.id, name: departments.name, active: departments.active })
    .from(departments)
    .where(eq(departments.locationId, cfg.locationId))
    .orderBy(desc(departments.isDefault), asc(departments.name), asc(departments.id));
  const lists = new Map(
    (await listDepartmentMenus(tx, cfg)).map((list) => [list.departmentId, list]),
  );
  const periods = await tx
    .select({
      id: menuPeriods.id,
      departmentId: menuPeriods.departmentId,
      name: menuPeriods.name,
      menuId: menuPeriods.menuId,
    })
    .from(menuPeriods)
    .innerJoin(departments, eq(departments.id, menuPeriods.departmentId))
    .where(eq(departments.locationId, cfg.locationId))
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
  const uses = await periodUses(
    tx,
    periods.map((period) => period.id),
  );
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
    .orderBy(asc(menuDayTimetables.departmentId));
  const slots = await slotsByTimetable(
    tx,
    timetables.map((row) => row.id),
  );
  const zones = await tx
    .select({
      id: floorZones.id,
      departmentId: zoneServicePolicies.departmentId,
      name: floorZones.name,
      active: floorZones.active,
      allDayMenuId: zoneAllDayMenus.menuId,
    })
    .from(zoneServicePolicies)
    .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
    .leftJoin(zoneAllDayMenus, eq(zoneAllDayMenus.zoneId, zoneServicePolicies.zoneId))
    .where(eq(zoneServicePolicies.locationId, cfg.locationId))
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id));
  const zoneMenus = await tx
    .select({
      zoneId: zonePeriodMenus.zoneId,
      periodId: zonePeriodMenus.periodId,
      menuId: zonePeriodMenus.menuId,
    })
    .from(zonePeriodMenus)
    .innerJoin(menuPeriods, eq(menuPeriods.id, zonePeriodMenus.periodId))
    .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, zonePeriodMenus.zoneId))
    .where(eq(zoneServicePolicies.locationId, cfg.locationId))
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
  const timetabled = [
    ...new Set(
      timetables.flatMap((row) => (row.specialDateId === null ? [] : [row.specialDateId])),
    ),
  ];
  const dates = await tx
    .select({ id: specialDates.id, date: specialDates.date, name: specialDates.name })
    .from(specialDates)
    .where(
      and(
        eq(specialDates.locationId, cfg.locationId),
        civilDate === null
          ? undefined
          : or(
              gte(specialDates.date, addDays(civilDate, -1)),
              inArray(specialDates.id, timetabled),
            ),
      ),
    )
    .orderBy(asc(specialDates.date));

  const menus = await tx
    .select({ id: catalogues.id, name: catalogues.name, active: catalogues.active })
    .from(catalogues)
    .orderBy(asc(catalogues.name), asc(catalogues.id));

  return {
    menus,
    timeZone: clock.timeZone,
    clockReadable: civilDate !== null,
    civilDate,
    departments: departmentRows.map((department) => ({
      ...department,
      menuIds: lists.get(department.id)!.menuIds,
      allDayMenuId: lists.get(department.id)!.allDayMenuId,
      periods: periods
        .filter((period) => period.departmentId === department.id)
        .map(({ id, name, menuId }) => ({ id, name, menuId, uses: uses.get(id)! })),
      week: [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
        const row = timetables.find(
          (entry) => entry.departmentId === department.id && entry.weekday === weekday,
        );
        return { weekday, slots: row === undefined ? [] : slots.get(row.id)! };
      }),
      zones: zones
        .filter((zone) => zone.departmentId === department.id)
        .map(({ id, name, active, allDayMenuId }) => ({
          id,
          name,
          active,
          allDayMenuId,
          periodMenus: zoneMenus
            .filter((entry) => entry.zoneId === id)
            .map(({ periodId, menuId }) => ({ periodId, menuId })),
        })),
    })),
    specialDates: dates.map((special) => ({
      ...special,
      timetables: timetables
        .filter((row) => row.specialDateId === special.id)
        .map((row) => ({ departmentId: row.departmentId, slots: slots.get(row.id)! })),
    })),
  };
}
