import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { createHolidayCalendar, type CountryPack } from "@waitron/country";
import {
  CORE_MIGRATIONS,
  catalogues,
  floorZones,
  kitchenStations,
  locations,
  tenants,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import {
  assertDemotedStationHours,
  cellIntervals,
  deleteSpecialDate,
  duplicateSpecialDate,
  readCalendarDays,
  readHoursModel,
  readSpecialDate,
  readStationSchedules,
  stationsRestrictedFrom,
  readWeekHours,
  renameSpecialDate,
  replaceWeekHours,
  saveSpecialDate,
  type HolidayReader,
  type SpecialDateParticipant,
} from "./hours.js";
import {
  createHolidayStore,
  duplicateHolidayNamedSpecialDates as installedDuplicateHolidayNamedSpecialDates,
  readHolidayFacts as installedReadHolidayFacts,
} from "./holidays.js";
import { stationStates } from "./routing-store.js";
import * as packageIndex from "./index.js";
import { readCalendarDays as packageReadCalendarDays } from "./index.js";
import {
  WEEK_DISPLAY_ORDER,
  type CalendarDay,
  type DateHoursCell,
  type HolidayFact,
  type HourPeriod,
  type HoursSubject,
  type LocalDate,
  type SpecialDateInput,
  type WeekCell,
  type WeekDay,
} from "./hours-types.js";
import { VENUE_SERVICE_CALENDAR_PARTICIPANTS } from "./calendar-participants.js";
import { MENU_TIMETABLE_CALENDAR_PARTICIPANT } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import type { VenueScope } from "./operations.js";
import {
  hoursWeekCells,
  hoursWeekPeriods,
  specialDateHours,
  specialDateHoursPeriods,
  specialDates,
} from "./schema/hours.js";
import { departments, zoneServicePolicies } from "./schema/service.js";
import { menuDayTimetables, menuSlots } from "./schema/menus.js";
import { zoneClosedTimes } from "./schema/zone-closed-times.js";
import { replaceMenuWeek, saveMenuPeriod, saveSpecialDateMenus } from "./menu-timetable.js";
import { clockChangeAfter, minutesAfter } from "./testing/clock-change.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

/** Tuesday 6 October 2026, 12:00 in Madrid. */
const AT = new Date("2026-10-06T10:00:00Z");

interface Fixture {
  cfg: VenueScope;
  restaurant: HoursSubject;
  deli: HoursSubject;
  bar: HoursSubject;
  kitchen: HoursSubject;
  otherDepartment: HoursSubject;
  departmentIds: { restaurant: string; deli: string };
  otherStation: HoursSubject;
}

async function fixture(): Promise<Fixture> {
  return withTransaction(db, async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({
        name: `Venue ${randomUUID()}`,
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
        timeZone: "Europe/Madrid",
        dayCutover: "06:00:00",
      })
      .returning();
    const [other] = await tx
      .insert(locations)
      .values({
        name: `Other ${randomUUID()}`,
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
      })
      .returning();
    const cfg = { locationId: locationId(location!.id) };
    const department = (location: string, name: string, isDefault = false) => ({
      locationId: location,
      name,
      tradingName: name,
      isDefault,
    });
    const [restaurant, deli] = await tx
      .insert(departments)
      .values([
        department(location!.id, "Restaurant", true),
        department(location!.id, "Deli"),
        department(other!.id, "Other restaurant", true),
      ])
      .returning();
    const [bar, kitchen, otherStation] = await tx
      .insert(kitchenStations)
      .values([
        { locationId: location!.id, name: "Bar" },
        { locationId: location!.id, name: "Kitchen", isDefault: true },
        { locationId: other!.id, name: "Other bar" },
      ])
      .returning();
    const [restaurantStation, deliStation, foreignStation] = await tx
      .insert(kitchenStations)
      .values([
        { locationId: location!.id, name: "Pass" },
        { locationId: location!.id, name: "Grill" },
        { locationId: other!.id, name: "Other pass" },
      ])
      .returning();
    const [calendarMenu] = await tx
      .insert(catalogues)
      .values({ name: `Calendar ${randomUUID()}` })
      .returning();
    const calendarPeriod = await saveMenuPeriod(tx, cfg, restaurant!.id, {
      name: "Open",
      menuId: calendarMenu!.id,
      staffMenuIds: [],
    });
    await replaceMenuWeek(
      tx,
      cfg,
      restaurant!.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: calendarPeriod.id, startsAt: "06:00", endsAt: "06:00" }],
      })),
      new Date(),
    );
    return {
      cfg,
      departmentIds: { restaurant: restaurant!.id, deli: deli!.id },
      restaurant: { kind: "station", id: restaurantStation!.id },
      deli: { kind: "station", id: deliStation!.id },
      bar: { kind: "station", id: bar!.id },
      kitchen: { kind: "station", id: kitchen!.id },
      otherDepartment: { kind: "station", id: foreignStation!.id },
      otherStation: { kind: "station", id: otherStation!.id },
    };
  });
}

const period = (opensAt: string, closesAt: string, id: string = randomUUID()): HourPeriod => ({
  id,
  opensAt,
  closesAt,
});
const closed: WeekCell = { mode: "closed", periods: [] };
const allDay: WeekCell = { mode: "all_day", periods: [] };
const periods = (...list: HourPeriod[]): WeekCell => ({ mode: "periods", periods: list });

/** A week in Monday-first display order, every day Closed unless `cells` names it by weekday. */
function week(cells: Partial<Record<number, WeekCell>> = {}): WeekDay[] {
  return WEEK_DISPLAY_ORDER.map((weekday) => ({ weekday, cell: cells[weekday] ?? closed }));
}

const save = (f: Fixture, subject: HoursSubject, days: unknown) =>
  withTransaction(db, (tx) => replaceWeekHours(tx, f.cfg, subject, days as WeekDay[], AT));

const read = (f: Fixture, subject: HoursSubject) =>
  withTransaction(db, (tx) => readWeekHours(tx, f.cfg, subject));

/** Every stored row behind one subject's week, so a refusal can be shown to have written nothing. */
async function storedWeek(subject: HoursSubject) {
  return withTransaction(db, async (tx: Transaction) => {
    const owner = eq(hoursWeekCells.stationId, subject.id);
    const cells = await tx
      .select()
      .from(hoursWeekCells)
      .where(owner)
      .orderBy(asc(hoursWeekCells.weekday));
    const stored = [];
    for (const cell of cells)
      stored.push({
        ...cell,
        periods: await tx
          .select()
          .from(hoursWeekPeriods)
          .where(eq(hoursWeekPeriods.cellId, cell.id))
          .orderBy(asc(hoursWeekPeriods.position)),
      });
    return stored;
  });
}

const specialInput = (overrides: Partial<SpecialDateInput> = {}): SpecialDateInput => ({
  date: "2026-10-09",
  name: "Harvest festival",

  closeWholeVenue: false,
  cells: [],
  ...overrides,
});

const saveDate = (f: Fixture, id: string | null, input: unknown) =>
  withTransaction(db, (tx) => saveSpecialDate(tx, f.cfg, id, input as SpecialDateInput, AT));

describe("the standard week", () => {
  it("reads seven unset days for every subject that has no hours stored", async () => {
    const f = await fixture();
    for (const subject of [f.restaurant, f.deli, f.bar, f.kitchen])
      expect(await read(f, subject)).toEqual(
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          cell: { mode: "not_set", periods: [] },
        })),
      );
  });

  it("stores Sunday as weekday 0 and Monday as 1, whatever order the week arrives in", async () => {
    const f = await fixture();
    expect(WEEK_DISPLAY_ORDER).toEqual([1, 2, 3, 4, 5, 6, 0]);
    await save(f, f.restaurant, week({ 1: periods(period("09:00", "17:00")), 0: allDay }));

    const stored = await storedWeek(f.restaurant);
    expect(stored.map((cell) => [cell.weekday, cell.mode])).toEqual([
      [0, "all_day"],
      [1, "periods"],
      [2, "closed"],
      [3, "closed"],
      [4, "closed"],
      [5, "closed"],
      [6, "closed"],
    ]);
    const days = await read(f, f.restaurant);
    expect(days[0]).toEqual({ weekday: 0, cell: { mode: "all_day", periods: [] } });
    expect(days[1]!.cell.mode).toBe("periods");
  });

  it("keeps an all-Closed week as seven explicit Closed days, never as unset", async () => {
    const f = await fixture();
    await save(f, f.bar, week());

    const days = await read(f, f.bar);
    expect(days.map((day) => day.cell)).toEqual(Array(7).fill({ mode: "closed", periods: [] }));
    expect(cellIntervals(days[3]!.cell)).toEqual([]);
    expect(cellIntervals({ mode: "not_set", periods: [] })).toBeNull();
  });

  it("opens all day from 00:00 through 23:59, ends at the next midnight and stores no periods", async () => {
    const f = await fixture();
    await save(f, f.deli, week({ 1: allDay }));

    const monday = (await read(f, f.deli))[1]!;
    expect(monday).toEqual({ weekday: 1, cell: { mode: "all_day", periods: [] } });
    const [interval] = cellIntervals(monday.cell)!;
    expect(interval).toEqual({ start: 0, end: 24 * 60 });
    for (const minute of [0, 23 * 60 + 59])
      expect(minute >= interval!.start && minute < interval!.end).toBe(true);
    const stored = await storedWeek(f.deli);
    expect(stored.find((cell) => cell.weekday === 1)!.periods).toEqual([]);
  });

  it("keeps two periods' ids and order, and stores their times canonically", async () => {
    const f = await fixture();
    const evening = period("18:00", "23:30");
    const lunch = period("12:00", "15:00");
    await save(f, f.restaurant, week({ 5: periods(evening, lunch) }));

    expect((await read(f, f.restaurant))[5]!.cell).toEqual({
      mode: "periods",
      periods: [evening, lunch],
    });
    const friday = (await storedWeek(f.restaurant)).find((cell) => cell.weekday === 5)!;
    expect(friday.periods.map((row) => [row.id, row.position, row.opensAt, row.closesAt])).toEqual([
      [evening.id, 0, "18:00:00", "23:30:00"],
      [lunch.id, 1, "12:00:00", "15:00:00"],
    ]);

    const later = { ...evening, closesAt: "23:45" };
    await save(f, f.restaurant, week({ 5: periods(later, lunch) }));
    expect((await read(f, f.restaurant))[5]!.cell).toEqual({
      mode: "periods",
      periods: [later, lunch],
    });
    expect((await storedWeek(f.restaurant)).find((cell) => cell.weekday === 5)!.id).toBe(friday.id);
  });

  it("saves periods that touch, within a day and across midnight", async () => {
    const f = await fixture();
    const days = week({
      1: periods(period("12:00", "14:00"), period("14:00", "17:00"), period("22:00", "02:00")),
      2: periods(period("02:00", "04:00")),
    });
    await save(f, f.bar, days);
    expect((await read(f, f.bar))[1]!.cell.periods).toHaveLength(3);
  });

  it("clears a configured week back to seven unset days by storing nothing", async () => {
    const f = await fixture();
    await save(f, f.bar, week({ 3: allDay }));
    await save(
      f,
      f.bar,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        cell: { mode: "not_set", periods: [] },
      })),
    );
    expect(await storedWeek(f.bar)).toEqual([]);
    expect((await read(f, f.bar)).every((day) => day.cell.mode === "not_set")).toBe(true);
  });

  it("refuses to write any hours for the default station, which is always open", async () => {
    const f = await fixture();
    await expect(save(f, f.kitchen, week())).rejects.toMatchObject({
      code: "station.always_open",
      params: { stationId: f.kitchen.id },
    });
    expect(await storedWeek(f.kitchen)).toEqual([]);
  });

  const refusals: [string, (f: Fixture) => { subject?: HoursSubject; days: unknown }, string][] = [
    ["another venue's station", (f) => ({ subject: f.otherDepartment, days: week() }), "subject"],
    ["another venue's station", (f) => ({ subject: f.otherStation, days: week() }), "subject"],
    [
      "a subject of an unknown kind",
      (f) => ({ subject: { kind: "zone", id: f.restaurant.id } as never, days: week() }),
      "subject.kind",
    ],
    ["a week that is not a list", () => ({ days: null }), "days"],
    ["a missing day", () => ({ days: week().slice(0, 6) }), "days"],
    [
      "a subject that is not an object",
      () => ({ subject: null as never, days: week() }),
      "subject",
    ],
    [
      "a subject id that is not text",
      () => ({ subject: { kind: "station", id: 7 } as never, days: week() }),
      "subject",
    ],
    [
      "a day that is not an object",
      () => ({ days: week().map((day, i) => (i === 0 ? null : day)) }),
      "days.0",
    ],
    [
      "a cell that is not an object",
      () => ({ days: week().map((day, i) => (i === 0 ? { ...day, cell: "closed" } : day)) }),
      "days.0.cell",
    ],
    [
      "a period that is not an object",
      () => ({ days: week({ 3: { mode: "periods", periods: ["09:00-10:00"] } as never }) }),
      "days.2.cell.periods.0",
    ],
    [
      "a weekday given twice",
      () => ({ days: week().map((day, index) => (index === 6 ? { ...day, weekday: 1 } : day)) }),
      "days.6.weekday",
    ],
    [
      "a weekday outside 0 to 6",
      () => ({ days: week().map((day, index) => (index === 6 ? { ...day, weekday: 7 } : day)) }),
      "days.6.weekday",
    ],
    [
      "unset days mixed with configured ones",
      () => ({
        days: week().map((day, index) =>
          index >= 4 ? { ...day, cell: { mode: "not_set", periods: [] } } : day,
        ),
      }),
      "days.4.cell.mode",
    ],
    [
      "a null mode",
      () => ({
        days: week().map((day, i) =>
          i === 2 ? { ...day, cell: { mode: null, periods: [] } } : day,
        ),
      }),
      "days.2.cell.mode",
    ],
    [
      "a mode coerced into a list",
      () => ({
        days: week().map((day, i) =>
          i === 2 ? { ...day, cell: { mode: ["closed"], periods: [] } } : day,
        ),
      }),
      "days.2.cell.mode",
    ],
    [
      "an unknown mode",
      () => ({
        days: week().map((day, i) =>
          i === 2 ? { ...day, cell: { mode: "open", periods: [] } } : day,
        ),
      }),
      "days.2.cell.mode",
    ],
    [
      "periods mode with no periods",
      () => ({ days: week({ 3: { mode: "periods", periods: [] } }) }),
      "days.2.cell.periods",
    ],
    [
      "a Closed day carrying a period",
      () => ({
        days: week({ 3: { mode: "closed", periods: [period("09:00", "10:00")] } as never }),
      }),
      "days.2.cell.periods",
    ],
    [
      "periods that are not a list",
      () => ({ days: week({ 3: { mode: "periods", periods: null } as never }) }),
      "days.2.cell.periods",
    ],
    [
      "a period whose ends are equal",
      () => ({ days: week({ 3: periods(period("09:00", "09:00")) }) }),
      "days.2.cell.periods.0.closesAt",
    ],
    [
      "an hour that does not exist",
      () => ({ days: week({ 3: periods(period("25:00", "09:00")) }) }),
      "days.2.cell.periods.0.opensAt",
    ],
    [
      "a time without its leading zero",
      () => ({ days: week({ 3: periods(period("09:00", "9:30")) }) }),
      "days.2.cell.periods.0.closesAt",
    ],
    [
      "a period id that is not a UUID",
      () => ({ days: week({ 3: periods(period("09:00", "10:00", "lunch")) }) }),
      "days.2.cell.periods.0.id",
    ],
    [
      "one period id used twice",
      () => {
        const id = randomUUID();
        return {
          days: week({
            3: periods(period("09:00", "10:00", id)),
            4: periods(period("09:00", "10:00", id)),
          }),
        };
      },
      "days.3.cell.periods.0.id",
    ],
    [
      "overlapping periods in one day",
      () => ({ days: week({ 3: periods(period("12:00", "15:00"), period("14:00", "16:00")) }) }),
      "days.2.cell.periods.1",
    ],
    [
      "a tail past midnight overlapping the next day's opening",
      () => ({
        days: week({ 1: periods(period("22:00", "02:00")), 2: periods(period("01:00", "05:00")) }),
      }),
      "days.1.cell",
    ],
    [
      "a tail past midnight under the next day's all-day opening",
      () => ({ days: week({ 1: periods(period("22:00", "00:30")), 2: allDay }) }),
      "days.1.cell",
    ],
    [
      "Sunday's tail overlapping Monday",
      () => ({
        days: week({ 0: periods(period("23:00", "03:00")), 1: periods(period("02:00", "06:00")) }),
      }),
      "days.0.cell",
    ],
    [
      "Saturday's tail overlapping Sunday",
      () => ({
        days: week({ 6: periods(period("22:00", "03:00")), 0: periods(period("01:00", "05:00")) }),
      }),
      "days.6.cell",
    ],
  ];

  it.each(refusals)(
    "refuses %s, naming the field and leaving the saved week alone",
    async (_, make, field) => {
      const f = await fixture();
      const prior = week({ 1: periods(period("09:00", "17:00")), 0: allDay });
      await save(f, f.restaurant, prior);
      const before = await storedWeek(f.restaurant);

      const request = make(f);
      const subject = "subject" in request ? (request.subject as HoursSubject) : f.restaurant;
      await expect(save(f, subject, request.days)).rejects.toMatchObject({
        code: "hours.invalid",
        params: { field },
      });
      expect(await storedWeek(f.restaurant)).toEqual(before);
    },
  );

  it("refuses a period id another cell owns rather than moving it", async () => {
    const f = await fixture();
    const monday = period("09:00", "17:00");
    await save(f, f.restaurant, week({ 1: periods(monday) }));

    await expect(save(f, f.restaurant, week({ 2: periods(monday) }))).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "days.1.cell.periods.0.id" },
    });
    await expect(save(f, f.deli, week({ 1: periods(monday) }))).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "days.0.cell.periods.0.id" },
    });
    expect((await read(f, f.restaurant))[1]!.cell.periods).toEqual([monday]);
    expect(await storedWeek(f.deli)).toEqual([]);
  });
});

describe("special dates", () => {
  it("saves a date with its cells and reads them back, storing nothing for an inherited cell", async () => {
    const f = await fixture();
    const evening = period("19:00", "01:00");
    const saved = await saveDate(
      f,
      null,
      specialInput({
        cells: [
          { subject: f.restaurant, cell: { mode: "periods", periods: [evening] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
          { subject: f.bar, cell: { mode: "all_day", periods: [] } },
          { subject: f.kitchen, cell: { mode: "inherit", periods: [] } },
        ],
      }),
    );
    expect(saved).toEqual({
      kind: "working_day",
      repeats: false,
      ownHours: false,
      id: expect.any(String),
      date: "2026-10-09",
      name: "Harvest festival",

      closeWholeVenue: false,
    });

    const read = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, saved.id));
    expect(read).toEqual({
      ...saved,
      cells: [
        { subject: f.restaurant, cell: { mode: "periods", periods: [evening] } },
        { subject: f.deli, cell: { mode: "closed", periods: [] } },
        { subject: f.bar, cell: { mode: "all_day", periods: [] } },
      ].sort((a, b) => (a.subject.id < b.subject.id ? -1 : 1)),
    });
    const rows = await withTransaction(db, (tx) =>
      tx.select().from(specialDateHours).where(eq(specialDateHours.specialDateId, saved.id)),
    );
    expect(rows).toHaveLength(3);
    const stored = await withTransaction(db, (tx) => tx.select().from(specialDateHoursPeriods));
    expect(stored.find((row) => row.id === evening.id)).toMatchObject({
      opensAt: "19:00:00",
      closesAt: "01:00:00",
      position: 0,
    });
  });

  it("edits a date in place, keeping its id, and drops a cell that goes back to inheriting", async () => {
    const f = await fixture();
    const first = await saveDate(
      f,
      null,
      specialInput({ cells: [{ subject: f.deli, cell: { mode: "closed", periods: [] } }] }),
    );
    const edited = await saveDate(
      f,
      first.id,
      specialInput({
        date: "2026-10-12",
        name: "Founders' day",

        closeWholeVenue: true,
        cells: [{ subject: f.deli, cell: { mode: "inherit", periods: [] } }],
      }),
    );
    expect(edited).toEqual({
      kind: "working_day",
      repeats: false,
      ownHours: false,
      id: first.id,
      date: "2026-10-12",
      name: "Founders' day",

      closeWholeVenue: true,
    });
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, first.id))).toEqual({
      ...edited,
      cells: [],
    });
  });

  it("edits a kept cell in place, replacing its periods and keeping the ids it is sent", async () => {
    const f = await fixture();
    const lunch = period("12:00", "15:00");
    const first = await saveDate(
      f,
      null,
      specialInput({ cells: [{ subject: f.bar, cell: { mode: "periods", periods: [lunch] } }] }),
    );
    const [cellBefore] = await withTransaction(db, (tx) =>
      tx.select().from(specialDateHours).where(eq(specialDateHours.specialDateId, first.id)),
    );
    const longer = { ...lunch, closesAt: "16:00" };
    const evening = period("19:00", "23:00");
    await saveDate(
      f,
      first.id,
      specialInput({
        cells: [{ subject: f.bar, cell: { mode: "periods", periods: [evening, longer] } }],
      }),
    );
    const [cellAfter] = await withTransaction(db, (tx) =>
      tx.select().from(specialDateHours).where(eq(specialDateHours.specialDateId, first.id)),
    );
    expect(cellAfter!.id).toBe(cellBefore!.id);
    expect((await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, first.id))).cells).toEqual(
      [{ subject: f.bar, cell: { mode: "periods", periods: [evening, longer] } }],
    );
  });

  it("refuses a date another special date already holds, and an id it does not know", async () => {
    const f = await fixture();
    await saveDate(f, null, specialInput());
    const second = await saveDate(f, null, specialInput({ date: "2026-10-10" }));

    await expect(saveDate(f, null, specialInput())).rejects.toMatchObject({
      code: "special_date.date_taken",
      params: { date: "2026-10-09" },
    });
    await expect(saveDate(f, second.id, specialInput())).rejects.toMatchObject({
      code: "special_date.date_taken",
      params: { date: "2026-10-09" },
    });
    const unknown = randomUUID();
    await expect(saveDate(f, unknown, specialInput({ date: "2026-11-01" }))).rejects.toMatchObject({
      code: "special_date.not_found",
      params: { specialDateId: unknown },
    });

    const other = await fixture();
    await expect(saveDate(other, second.id, specialInput())).rejects.toMatchObject({
      code: "special_date.not_found",
    });
    await expect(
      withTransaction(db, (tx) => readSpecialDate(tx, other.cfg, second.id)),
    ).rejects.toMatchObject({ code: "special_date.not_found" });
    expect((await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, second.id))).date).toBe(
      "2026-10-10",
    );
  });

  const refusals: [string, (f: Fixture) => unknown, string][] = [
    ["a request that is not an object", () => null, "input"],
    [
      "a cell entry that is not an object",
      () => specialInput({ cells: [null as never] }),
      "cells.0",
    ],
    ["an impossible date", () => specialInput({ date: "2026-02-30" }), "date"],
    ["a date in another shape", () => specialInput({ date: "2026-2-3" }), "date"],
    ["a blank name", () => specialInput({ name: "  " }), "name"],
    [
      "a kind outside the named-day kinds",
      () => ({ ...specialInput(), kind: "other" as never }),
      "kind",
    ],
    [
      "a closure flag that is not true or false",
      () => specialInput({ closeWholeVenue: "yes" as never }),
      "closeWholeVenue",
    ],
    ["cells that are not a list", () => specialInput({ cells: null as never }), "cells"],
    [
      "one subject given twice",
      (f) =>
        specialInput({
          cells: [
            { subject: f.deli, cell: { mode: "closed", periods: [] } },
            { subject: f.deli, cell: { mode: "all_day", periods: [] } },
          ],
        }),
      "cells.1.subject",
    ],
    [
      "another venue's subject",
      (f) =>
        specialInput({
          cells: [{ subject: f.otherStation, cell: { mode: "closed", periods: [] } }],
        }),
      "cells.0.subject",
    ],
    [
      "a weekly-only mode",
      (f) =>
        specialInput({
          cells: [{ subject: f.deli, cell: { mode: "not_set", periods: [] } as never }],
        }),
      "cells.0.cell.mode",
    ],
    [
      "overlapping periods",
      (f) =>
        specialInput({
          cells: [
            {
              subject: f.deli,
              cell: {
                mode: "periods",
                periods: [period("10:00", "13:00"), period("12:30", "14:00")],
              },
            },
          ],
        }),
      "cells.0.cell.periods.1",
    ],
  ];

  it.each(refusals)("refuses %s, naming the field and writing nothing", async (_, make, field) => {
    const f = await fixture();
    await expect(saveDate(f, null, make(f))).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field },
    });
    expect(
      await withTransaction(db, (tx) =>
        tx.select().from(specialDates).where(eq(specialDates.locationId, f.cfg.locationId)),
      ),
    ).toEqual([]);
  });

  it("refuses hours for the default station on a special date", async () => {
    const f = await fixture();
    await expect(
      saveDate(
        f,
        null,
        specialInput({ cells: [{ subject: f.kitchen, cell: { mode: "closed", periods: [] } }] }),
      ),
    ).rejects.toMatchObject({ code: "station.always_open", params: { stationId: f.kitchen.id } });
  });

  it("keeps the cell of a station that has since become the default when an edit leaves it out, and still refuses one that names it", async () => {
    const f = await fixture();
    const evening = period("18:00", "22:00");
    const date = await saveDate(
      f,
      null,
      specialInput({
        cells: [
          { subject: f.bar, cell: { mode: "periods", periods: [evening] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
        ],
      }),
    );
    await makeDefault(f, f.bar);
    const barRows = async () => {
      const rows = await dateRows(date.id);
      return {
        cell: rows.cells.find((cell) => cell.stationId === f.bar.id),
        periods: rows.periods,
      };
    };
    const before = await barRows();
    expect(before.cell).toMatchObject({ stationId: f.bar.id, mode: "periods" });
    expect(before.periods.map((row) => row.id)).toEqual([evening.id]);

    await saveDate(
      f,
      date.id,
      specialInput({
        name: "Renamed",
        cells: [{ subject: f.deli, cell: { mode: "closed", periods: [] } }],
      }),
    );
    expect(await barRows()).toEqual(before);
    expect((await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, date.id))).name).toBe(
      "Renamed",
    );

    await expect(
      saveDate(
        f,
        date.id,
        specialInput({ cells: [{ subject: f.bar, cell: { mode: "closed", periods: [] } }] }),
      ),
    ).rejects.toMatchObject({ code: "station.always_open", params: { stationId: f.bar.id } });
    expect(await barRows()).toEqual(before);
    expect(await dateSnapshot(f, f.bar, "2026-10-09")).toMatchObject({
      subject: f.bar,
      openingDate: "2026-10-09",
      specialDateId: date.id,
      state: { open: true, isDefault: true },
    });

    await withTransaction(db, (tx) =>
      tx.update(kitchenStations).set({ isDefault: false }).where(eq(kitchenStations.id, f.bar.id)),
    );
    expect(await dateSnapshot(f, f.bar, "2026-10-09")).toMatchObject({
      closeWholeVenue: false,
      specialCell: { mode: "periods", periods: [evening] },
      state: { open: false, isDefault: false },
    });
  });
});

describe("hours either side of a special date", () => {
  // Friday 9 October is a special date; Saturday 10 October is an ordinary Saturday (weekday 6,
  // index 5 of a Monday-first week).
  const lateFriday = (f: Fixture) =>
    specialInput({
      cells: [
        { subject: f.restaurant, cell: { mode: "periods", periods: [period("22:00", "03:00")] } },
      ],
    });

  it("refuses a week whose opening falls inside a saved special date's overnight tail", async () => {
    const f = await fixture();
    await saveDate(f, null, lateFriday(f));
    const prior = week({ 6: periods(period("12:00", "16:00")) });
    await save(f, f.restaurant, prior);
    const before = await storedWeek(f.restaurant);

    await expect(
      save(f, f.restaurant, week({ 6: periods(period("01:00", "05:00")) })),
    ).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "days.5.cell", date: "2026-10-09", subjectId: f.restaurant.id },
    });
    expect(await storedWeek(f.restaurant)).toEqual(before);
    await save(f, f.restaurant, week({ 6: periods(period("03:00", "05:00")) }));
  });

  it("refuses a week whose overnight tail runs into a special date's opening", async () => {
    const f = await fixture();
    await saveDate(
      f,
      null,
      specialInput({
        date: "2026-10-13",
        cells: [{ subject: f.bar, cell: { mode: "all_day", periods: [] } }],
      }),
    );
    // Monday 12 October's tail runs into Tuesday 13 October's all-day opening.
    await expect(
      save(f, f.bar, week({ 1: periods(period("20:00", "01:00")) })),
    ).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "days.0.cell", date: "2026-10-13", subjectId: f.bar.id },
    });
  });

  it("checks yesterday's tail running into today, but not a past date's", async () => {
    const f = await fixture();
    // Monday 5 October is yesterday at AT; 21 September is long past.
    await saveDate(f, null, { ...lateFriday(f), date: "2026-10-05" });
    await saveDate(f, null, { ...lateFriday(f), date: "2026-09-21" });

    await expect(
      save(f, f.restaurant, week({ 2: periods(period("01:00", "05:00")) })),
    ).rejects.toMatchObject({ code: "hours.invalid", params: { date: "2026-10-05" } });

    const pastOnly = await fixture();
    await saveDate(pastOnly, null, { ...lateFriday(pastOnly), date: "2026-09-21" });
    await save(pastOnly, pastOnly.restaurant, week({ 2: periods(period("01:00", "05:00")) }));
  });

  it("refuses a special date whose tail runs into the next day's standard opening", async () => {
    const f = await fixture();
    await save(f, f.restaurant, week({ 6: periods(period("01:00", "05:00")) }));

    await expect(saveDate(f, null, lateFriday(f))).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "cells.0.cell", date: "2026-10-10", subjectId: f.restaurant.id },
    });
    await saveDate(
      f,
      null,
      specialInput({
        cells: [
          { subject: f.restaurant, cell: { mode: "periods", periods: [period("22:00", "01:00")] } },
        ],
      }),
    );
  });

  it("refuses a special date that opens inside the previous day's standard tail", async () => {
    const f = await fixture();
    await save(f, f.restaurant, week({ 4: periods(period("22:00", "03:00")) }));
    await expect(
      saveDate(
        f,
        null,
        specialInput({
          cells: [
            {
              subject: f.restaurant,
              cell: { mode: "periods", periods: [period("01:00", "05:00")] },
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "cells.0.cell", date: "2026-10-08", subjectId: f.restaurant.id },
    });
  });

  it("refuses moving a special date off a day whose standard hours would then clash", async () => {
    const f = await fixture();
    await save(f, f.restaurant, week({ 6: periods(period("01:00", "05:00")) }));
    // Saturday 10 October is Closed as a special date, so Friday's late special hours can run into it.
    const saturday = await saveDate(
      f,
      null,
      specialInput({
        date: "2026-10-10",
        cells: [{ subject: f.restaurant, cell: { mode: "closed", periods: [] } }],
      }),
    );
    await saveDate(f, null, lateFriday(f));

    await expect(
      saveDate(f, saturday.id, specialInput({ date: "2026-10-20" })),
    ).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "date", date: "2026-10-10", subjectId: f.restaurant.id },
    });
    expect((await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, saturday.id))).date).toBe(
      "2026-10-10",
    );
  });

  it("checks every special date, past ones included, when the venue's clock cannot be read", async () => {
    const f = await fixture();
    await saveDate(f, null, { ...lateFriday(f), date: "2026-09-21" });
    await withTransaction(db, (tx) =>
      tx.update(locations).set({ timeZone: "Mars/Base" }).where(eq(locations.id, f.cfg.locationId)),
    );
    await expect(
      save(f, f.restaurant, week({ 2: periods(period("01:00", "05:00")) })),
    ).rejects.toMatchObject({ code: "hours.invalid", params: { date: "2026-09-21" } });
  });

  it("saves a past special date whose tail would clash, but still checks its own periods", async () => {
    const f = await fixture();
    await save(f, f.restaurant, week({ 6: periods(period("01:00", "05:00")) }));
    // Friday 25 September is in the past at AT; Saturday 26 September opens at 01:00.
    await saveDate(f, null, { ...lateFriday(f), date: "2026-09-25" });
    await expect(
      saveDate(
        f,
        null,
        specialInput({
          date: "2026-09-18",
          cells: [
            {
              subject: f.restaurant,
              cell: {
                mode: "periods",
                periods: [period("10:00", "13:00"), period("12:00", "14:00")],
              },
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "hours.invalid", params: { field: "cells.0.cell.periods.1" } });
  });

  it("refuses reopening a whole-venue closure whose inherited hours overlap the next special date", async () => {
    const f = await fixture();
    const closedFriday = await saveDate(f, null, specialInput({ closeWholeVenue: true }));
    await saveDate(
      f,
      null,
      specialInput({
        date: "2026-10-10",
        cells: [
          { subject: f.deli, cell: { mode: "periods", periods: [period("02:00", "06:00")] } },
        ],
      }),
    );
    // Friday 9 October is closed whole, so its standard 21:00–03:00 cannot reach Saturday.
    await save(f, f.deli, week({ 5: periods(period("21:00", "03:00")) }));

    await expect(saveDate(f, closedFriday.id, specialInput())).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "cells", date: "2026-10-10", subjectId: f.deli.id },
    });
    expect(
      (await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, closedFriday.id)))
        .closeWholeVenue,
    ).toBe(true);
  });

  it("lets a whole-venue closure stand beside any hours, and ignores its retained cells", async () => {
    const f = await fixture();
    await save(f, f.restaurant, week({ 6: periods(period("01:00", "05:00")) }));
    const input = { ...lateFriday(f), closeWholeVenue: true };
    const saved = await saveDate(f, null, input);
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, saved.id))).toEqual({
      kind: "working_day",
      repeats: false,
      ownHours: false,
      id: saved.id,
      date: "2026-10-09",
      name: "Harvest festival",

      closeWholeVenue: true,
      cells: input.cells,
    });
  });
});

describe("special dates on a clock-change day", () => {
  const zone = "Europe/Madrid";
  const forward = clockChangeAfter(zone, "2027-01-01T00:00:00Z", "forward");
  const backward = clockChangeAfter(zone, "2027-07-01T00:00:00Z", "backward");
  const skipped = minutesAfter(forward.before, 1);
  const dateWith = (date: string, f: Fixture, opensAt: string, closesAt: string) =>
    specialInput({
      date,
      cells: [{ subject: f.bar, cell: { mode: "periods", periods: [period(opensAt, closesAt)] } }],
    });

  it("refuses an opening or a closing at a minute the clock skips that day, writing nothing", async () => {
    const f = await fixture();
    await expect(
      saveDate(f, null, dateWith(forward.date, f, skipped, "12:00")),
    ).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "cells.0.cell.periods.0.opensAt" },
    });
    await expect(
      saveDate(f, null, dateWith(forward.date, f, "00:30", skipped)),
    ).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "cells.0.cell.periods.0.closesAt" },
    });
    // Closing after midnight falls on the next date, the clock-change day.
    const dayBefore = new Date(Date.parse(`${forward.date}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    await expect(saveDate(f, null, dateWith(dayBefore, f, "22:00", skipped))).rejects.toMatchObject(
      {
        code: "hours.invalid",
        params: { field: "cells.0.cell.periods.0.closesAt" },
      },
    );
    expect(
      await withTransaction(db, (tx) =>
        tx.select().from(specialDates).where(eq(specialDates.locationId, f.cfg.locationId)),
      ),
    ).toEqual([]);
  });

  it("saves the same times on an ordinary day, and a minute the clock repeats", async () => {
    const f = await fixture();
    await saveDate(f, null, dateWith("2027-02-10", f, skipped, "12:00"));
    await saveDate(f, null, dateWith(backward.date, f, minutesAfter(backward.after, 1), "12:00"));
  });

  it("checks no endpoint while the venue's clock cannot be read", async () => {
    const f = await fixture();
    await withTransaction(db, (tx) =>
      tx.update(locations).set({ timeZone: "Mars/Base" }).where(eq(locations.id, f.cfg.locationId)),
    );
    await saveDate(f, null, dateWith(forward.date, f, skipped, "12:00"));
  });

  it("keeps the standard week, which repeats every week, free to name a skipped minute", async () => {
    const f = await fixture();
    await save(f, f.bar, week({ 0: periods(period(skipped, "12:00")) }));
  });
});

it("refuses a week clashing with yesterday's special tail and leaves every row as it was", async () => {
  const f = await fixture();
  // Monday 5 October is yesterday at AT; its special hours run to 03:00 on Tuesday.
  const monday = await saveDate(
    f,
    null,
    specialInput({
      date: "2026-10-05",
      cells: [
        { subject: f.restaurant, cell: { mode: "periods", periods: [period("22:00", "03:00")] } },
      ],
    }),
  );
  await save(f, f.restaurant, week({ 2: periods(period("12:00", "16:00")) }));
  const weekBefore = await storedWeek(f.restaurant);
  const dateBefore = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, monday.id));
  await expect(
    save(f, f.restaurant, week({ 2: periods(period("01:00", "05:00")) })),
  ).rejects.toMatchObject({
    code: "hours.invalid",
    params: { field: "days.1.cell", date: "2026-10-05", subjectId: f.restaurant.id },
  });
  expect(await storedWeek(f.restaurant)).toEqual(weekBefore);
  expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, monday.id))).toEqual(
    dateBefore,
  );
});

const dateSnapshot = (f: Fixture, subject: HoursSubject, date: LocalDate) =>
  withTransaction(db, async (tx) => {
    const model = await readHoursModel(tx, f.cfg, date, date, AT);
    const day = model.days[0]!;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const standard = model.week.find((entry) => entry.subject.id === subject.id)!;
    const specialCell = model.specialCells
      .find((entry) => entry.specialDateId === day.specialDate?.id)
      ?.cells.find((entry) => entry.subject.id === subject.id)?.cell;
    const states = await stationStates(tx, f.cfg, new Date(`${date}T10:00:00Z`));
    return {
      subject: standard.subject,
      openingDate: day.date,
      specialDateId: day.specialDate?.id ?? null,
      closeWholeVenue: day.specialDate?.closeWholeVenue ?? false,
      standardCell: standard.days.find((entry) => entry.weekday === weekday)!.cell,
      specialCell,
      state: states.get(subject.id)!,
    };
  });

const tone = (f: Fixture, date: LocalDate) =>
  withTransaction(db, async (tx) => (await readCalendarDays(tx, f.cfg, date, date))[0]!.tone);

const duplicate = (
  f: Fixture,
  id: string,
  dates: unknown,
  participants?: readonly SpecialDateParticipant[],
) =>
  withTransaction(db, (tx) =>
    duplicateSpecialDate(tx, f.cfg, id, dates as LocalDate[], AT, participants),
  );

const remove = (f: Fixture, id: string, participants?: readonly SpecialDateParticipant[]) =>
  withTransaction(db, (tx) => deleteSpecialDate(tx, f.cfg, id, AT, participants));

/** Every special date the venue holds, with its cells and periods, in date order. */
const storedDates = (f: Fixture) =>
  withTransaction(db, async (tx) => {
    const rows = await tx
      .select({ id: specialDates.id })
      .from(specialDates)
      .where(eq(specialDates.locationId, f.cfg.locationId))
      .orderBy(asc(specialDates.date));
    const dates = [];
    for (const row of rows) dates.push(await readSpecialDate(tx, f.cfg, row.id));
    return dates;
  });

/** Every stored cell and period row behind one special date, by id. */
const dateRows = (id: string) =>
  withTransaction(db, async (tx) => {
    const cells = await tx
      .select()
      .from(specialDateHours)
      .where(eq(specialDateHours.specialDateId, id));
    const periods = await tx
      .select()
      .from(specialDateHoursPeriods)
      .where(
        inArray(
          specialDateHoursPeriods.cellId,
          cells.map((cell) => cell.id),
        ),
      );
    return { cells, periods };
  });

const makeDefault = (f: Fixture, station: HoursSubject) =>
  withTransaction(db, async (tx) => {
    await tx
      .update(kitchenStations)
      .set({ isDefault: false })
      .where(eq(kitchenStations.id, f.kitchen.id));
    await tx
      .update(kitchenStations)
      .set({ isDefault: true })
      .where(eq(kitchenStations.id, station.id));
  });

const setDepartmentActive = (department: { id: string }, active: boolean) =>
  withTransaction(db, (tx) =>
    tx.update(departments).set({ active }).where(eq(departments.id, department.id)),
  );

async function addSubjects(f: Fixture) {
  return withTransaction(db, async (tx) => {
    const [terrace] = await tx
      .insert(departments)
      .values({
        locationId: f.cfg.locationId,
        name: `Terrace ${randomUUID()}`,
        tradingName: "Terrace",
      })
      .returning();
    const [terraceStation, grill] = await tx
      .insert(kitchenStations)
      .values([
        { locationId: f.cfg.locationId, name: "Terrace pass" },
        { locationId: f.cfg.locationId, name: `Grill ${randomUUID()}` },
      ])
      .returning();
    return {
      terraceDepartment: { kind: "department" as const, id: terrace!.id },
      terrace: { kind: "station", id: terraceStation!.id } as HoursSubject,
      grill: { kind: "station", id: grill!.id } as HoursSubject,
    };
  });
}

describe("a station that stops being the default", () => {
  const check = (f: Fixture, station: HoursSubject, at = AT) =>
    withTransaction(db, (tx) => assertDemotedStationHours(tx, f.cfg, station.id, at));
  const barDate = (f: Fixture, date: string, opensAt: string, closesAt: string) =>
    specialInput({
      date,
      name: date,
      cells: [{ subject: f.bar, cell: { mode: "periods", periods: [period(opensAt, closesAt)] } }],
    });

  it("is refused when a kept date moved while it was the default now runs into another", async () => {
    const f = await fixture();
    await save(f, f.bar, week());
    await saveDate(f, null, barDate(f, "2026-10-09", "22:00", "03:00"));
    const later = await saveDate(f, null, barDate(f, "2026-10-12", "01:00", "05:00"));
    await makeDefault(f, f.bar);
    await check(f, f.bar);
    // Allowed: the default's kept cells take no part in a save's check.
    await saveDate(f, later.id, specialInput({ date: "2026-10-10", name: later.name }));
    await expect(check(f, f.bar)).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "date", date: "2026-10-10", subjectId: f.bar.id },
    });
  });

  it("is refused when a kept date moved beside its standard week now overlaps it", async () => {
    const f = await fixture();
    // Friday runs from 22:00 to 03:00 on Saturday.
    await save(f, f.bar, week({ 5: periods(period("22:00", "03:00")) }));
    const date = await saveDate(f, null, barDate(f, "2026-10-14", "01:00", "05:00"));
    await makeDefault(f, f.bar);
    await saveDate(f, date.id, specialInput({ date: "2026-10-10", name: date.name }));
    // Names the special date holding the kept cell, not the ordinary Friday beside it.
    await expect(check(f, f.bar)).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "date", date: "2026-10-10", subjectId: f.bar.id },
    });
    await remove(f, date.id);
    await check(f, f.bar);
  });

  it("names the special date holding the kept cell when the day it runs into is another special date", async () => {
    const f = await fixture();
    // Sunday runs from 01:00 to 05:00.
    await save(f, f.bar, week({ 0: periods(period("01:00", "05:00")) }));
    const date = await saveDate(f, null, barDate(f, "2026-10-14", "22:00", "03:00"));
    await makeDefault(f, f.bar);
    await saveDate(
      f,
      null,
      specialInput({
        date: "2026-10-11",
        name: "Sunday",
        cells: [{ subject: f.restaurant, cell: { mode: "closed", periods: [] } }],
      }),
    );
    // Saturday 10 October now runs into Sunday's standard 01:00.
    await saveDate(f, date.id, specialInput({ date: "2026-10-10", name: date.name }));
    await expect(check(f, f.bar)).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "date", date: "2026-10-10", subjectId: f.bar.id },
    });
    await remove(f, date.id);
    await check(f, f.bar);
  });

  it("leaves out a clash already past, as a save does", async () => {
    const f = await fixture();
    await save(f, f.bar, week());
    await saveDate(f, null, barDate(f, "2026-10-01", "22:00", "03:00"));
    await saveDate(f, null, barDate(f, "2026-10-02", "01:00", "05:00"));
    await check(f, f.bar);
    await expect(check(f, f.bar, new Date("2026-09-30T10:00:00Z"))).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "date", subjectId: f.bar.id },
    });
  });

  it("is refused when a kept period copied while it was the default opens at a minute the clock skips", async () => {
    const f = await fixture();
    const forward = clockChangeAfter("Europe/Madrid", "2027-01-01T00:00:00Z", "forward");
    const skipped = minutesAfter(forward.before, 1);
    const weekEarlier = new Date(Date.parse(`${forward.date}T00:00:00Z`) - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const source = await saveDate(f, null, barDate(f, weekEarlier, skipped, "12:00"));
    await makeDefault(f, f.bar);
    // Allowed: duplicate skips the default's kept cells when looking for skipped minutes.
    await duplicate(f, source.id, [forward.date]);
    await expect(check(f, f.bar)).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "opensAt", date: forward.date, subjectId: f.bar.id },
    });
    // Once the date and the day after it are past, it is left out.
    await check(f, f.bar, new Date(Date.parse(`${forward.date}T12:00:00Z`) + 2 * 86_400_000));
  });
});

describe("the station hours model on one date", () => {
  it("reads an inherited cell as the standard week, Closed as Closed, and periods for that subject only", async () => {
    const f = await fixture();
    const restaurantMonday = period("09:00", "17:00");
    const deliMonday = period("10:00", "14:00");
    await save(f, f.restaurant, week({ 1: periods(restaurantMonday) }));
    await save(f, f.deli, week({ 1: periods(deliMonday) }));
    const lunch = period("12:00", "15:00");
    // Monday 12 October.
    const monday = await saveDate(
      f,
      null,
      specialInput({
        date: "2026-10-12",
        cells: [
          { subject: f.restaurant, cell: { mode: "inherit", periods: [] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
          { subject: f.bar, cell: { mode: "periods", periods: [lunch] } },
        ],
      }),
    );

    expect(await dateSnapshot(f, f.restaurant, "2026-10-12")).toMatchObject({
      subject: f.restaurant,
      openingDate: "2026-10-12",
      specialDateId: monday.id,
      specialCell: undefined,
      closeWholeVenue: false,
      standardCell: { mode: "periods", periods: [restaurantMonday] },
      state: { open: true, isDefault: false },
    });
    expect(await dateSnapshot(f, f.deli, "2026-10-12")).toMatchObject({
      subject: f.deli,
      openingDate: "2026-10-12",
      specialDateId: monday.id,
      closeWholeVenue: false,
      specialCell: { mode: "closed", periods: [] },
      state: { open: false, isDefault: false },
    });
    expect(await dateSnapshot(f, f.bar, "2026-10-12")).toMatchObject({
      subject: f.bar,
      openingDate: "2026-10-12",
      specialDateId: monday.id,
      closeWholeVenue: false,
      specialCell: { mode: "periods", periods: [lunch] },
      state: { open: true, isDefault: false },
    });
    const rows = await dateRows(monday.id);
    expect(
      rows.cells.map((cell) => [cell.departmentId ?? cell.stationId, cell.mode]).sort(),
    ).toEqual(
      [
        [f.bar.id, "periods"],
        [f.deli.id, "closed"],
      ].sort(),
    );
    expect(rows.periods.map((row) => row.id)).toEqual([lunch.id]);

    // The next Monday is ordinary: the deli's standard Monday is untouched.
    expect(await dateSnapshot(f, f.deli, "2026-10-19")).toMatchObject({
      subject: f.deli,
      openingDate: "2026-10-19",
      specialDateId: null,
      specialCell: undefined,
      closeWholeVenue: false,
      standardCell: { mode: "periods", periods: [deliMonday] },
      state: { open: true, isDefault: false },
    });
    expect((await dateSnapshot(f, f.bar, "2026-10-19")).standardCell).toEqual({
      mode: "not_set",
      periods: [],
    });
    expect(await dateSnapshot(f, f.kitchen, "2026-10-19")).toMatchObject({
      subject: f.kitchen,
      openingDate: "2026-10-19",
      specialDateId: null,
      state: { open: true, isDefault: true },
    });
  });

  it("keeps a date's id and its cells when its name and date change", async () => {
    const f = await fixture();
    const closedDeli: DateHoursCell = { subject: f.deli, cell: { mode: "closed", periods: [] } };
    const first = await saveDate(f, null, specialInput({ cells: [closedDeli] }));
    const moved = await saveDate(
      f,
      first.id,
      specialInput({ date: "2026-10-13", name: "Moved", cells: [closedDeli] }),
    );
    expect(moved.id).toBe(first.id);
    expect(await dateSnapshot(f, f.deli, "2026-10-13")).toMatchObject({
      specialDateId: first.id,
      closeWholeVenue: false,
      specialCell: { mode: "closed", periods: [] },
      state: { open: false, isDefault: false },
    });
    expect(await dateSnapshot(f, f.deli, "2026-10-09")).toMatchObject({
      specialDateId: null,
      specialCell: undefined,
      closeWholeVenue: false,
      standardCell: { mode: "not_set", periods: [] },
      state: { open: true, isDefault: false },
    });
  });

  it("refuses a subject from another venue, and a date that does not exist", async () => {
    const f = await fixture();
    await expect(read(f, f.otherDepartment)).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "subject" },
    });
    await expect(
      withTransaction(db, (tx) => readHoursModel(tx, f.cfg, "2026-02-30", "2026-02-30", AT)),
    ).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "from" },
    });
    await expect(tone(f, "2026-02-30")).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "from" },
    });
  });
});

describe("closing the whole venue on a date", () => {
  it("closes every non-default station, new ones included, and keeps the default open", async () => {
    const f = await fixture();
    await save(f, f.deli, week({ 5: periods(period("10:00", "14:00")) }));
    const evening = period("18:00", "22:00");
    const cells = [
      { subject: f.deli, cell: { mode: "periods", periods: [evening] } },
      { subject: f.bar, cell: { mode: "all_day", periods: [] } },
    ] as SpecialDateInput["cells"];
    const friday = await saveDate(f, null, specialInput({ closeWholeVenue: true, cells }));
    const added = await addSubjects(f);

    for (const subject of [f.restaurant, f.deli, f.bar, added.terrace, added.grill])
      expect(await dateSnapshot(f, subject, "2026-10-09")).toMatchObject({
        subject,
        openingDate: "2026-10-09",
        specialDateId: friday.id,
        closeWholeVenue: true,
        state: { open: false, isDefault: false },
      });
    expect(await dateSnapshot(f, f.kitchen, "2026-10-09")).toMatchObject({
      subject: f.kitchen,
      openingDate: "2026-10-09",
      specialDateId: friday.id,
      state: { open: true, isDefault: true },
    });

    // The cells the closure hides are kept, and reopening the date shows them again.
    const kept = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, friday.id));
    expect(kept.cells).toEqual([...cells].sort((a, b) => (a.subject.id < b.subject.id ? -1 : 1)));
    await saveDate(f, friday.id, specialInput({ closeWholeVenue: false, cells: kept.cells }));
    expect(await dateSnapshot(f, f.deli, "2026-10-09")).toMatchObject({
      closeWholeVenue: false,
      specialCell: { mode: "periods", periods: [evening] },
      state: { open: false, isDefault: false },
    });
    expect(await dateSnapshot(f, f.bar, "2026-10-09")).toMatchObject({
      closeWholeVenue: false,
      specialCell: { mode: "all_day", periods: [] },
      state: { open: true, isDefault: false },
    });
    expect(await dateSnapshot(f, added.terrace, "2026-10-09")).toMatchObject({
      specialCell: undefined,
      closeWholeVenue: false,
      standardCell: { mode: "not_set", periods: [] },
      state: { isDefault: false },
    });
  });
});

describe("the calendar's Closed colour", () => {
  it("is Closed when no active department has a service range, whatever the stations do", async () => {
    const f = await fixture();
    const deliPeriod = await withTransaction(db, async (tx) => {
      const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
      const restaurantPeriod = await saveMenuPeriod(tx, f.cfg, f.departmentIds.restaurant, {
        name: "Lunch",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      const deliPeriod = await saveMenuPeriod(tx, f.cfg, f.departmentIds.deli, {
        name: "Deli",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        f.cfg,
        f.departmentIds.restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots:
            weekday === 1
              ? [{ periodId: restaurantPeriod.id, startsAt: "09:00", endsAt: "17:00" }]
              : [],
        })),
        AT,
      );
      return deliPeriod;
    });
    expect(await tone(f, "2026-10-19")).toBe("standard");
    expect(await tone(f, "2026-10-20")).toBe("closed");
    for (const [date, open] of [
      ["2026-10-21", false],
      ["2026-10-22", true],
      ["2026-10-23", true],
    ] as const) {
      const special = await saveDate(
        f,
        null,
        specialInput({
          date,
          cells: [{ subject: f.bar, cell: { mode: "all_day", periods: [] } }],
        }),
      );
      await db.update(specialDates).set({ ownHours: true }).where(eq(specialDates.id, special.id));
      if (open)
        await withTransaction(db, (tx) =>
          saveSpecialDateMenus(
            tx,
            f.cfg,
            special.id,
            f.departmentIds.deli,
            [{ periodId: deliPeriod.id, startsAt: "10:00", endsAt: "14:00" }],
            AT,
          ),
        );
      expect(await tone(f, date)).toBe(open ? "blue" : "closed");
    }
    const { terraceDepartment: terrace } = await addSubjects(f);
    expect(await tone(f, "2026-10-21")).toBe("closed");
    await withTransaction(db, async (tx) => {
      const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
      const period = await saveMenuPeriod(tx, f.cfg, terrace.id, {
        name: "Terrace",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        f.cfg,
        terrace.id,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: weekday === 3 ? [{ periodId: period.id, startsAt: "09:00", endsAt: "17:00" }] : [],
        })),
        AT,
      );
    });
    expect(await tone(f, "2026-10-21")).toBe("blue");
    await setDepartmentActive(terrace, false);
    expect(await tone(f, "2026-10-21")).toBe("closed");
    await saveDate(f, null, specialInput({ date: "2026-10-26", closeWholeVenue: true }));
    expect(await tone(f, "2026-10-26")).toBe("closed");
  });
});

describe("holiday facts beside the calendar", () => {
  // Invented facts: no fixture here claims a real public holiday.
  const fact = (id: string, date: LocalDate, name: string): HolidayFact => ({
    id,
    date,
    name,
    scope: "local",
    sourceId: "test-source",
  });
  const FACTS = [
    fact("h1", "2026-10-14", "Invented feast"),
    fact("h2", "2026-10-14", "Second invented feast"),
    fact("h3", "2026-10-16", "Another invented day"),
    fact("h4", "2026-11-30", "Outside the range"),
  ];
  /** A reader standing in for a later holiday provider; it records every call it gets. */
  function fakeReader() {
    const calls: { tx: Transaction; cfg: VenueScope; from: LocalDate; to: LocalDate }[] = [];
    const reader: HolidayReader = async (tx, cfg, from, to) => {
      calls.push({ tx, cfg, from, to });
      return FACTS;
    };
    return { reader, calls };
  }
  const calendar = (f: Fixture, reader?: HolidayReader) =>
    withTransaction(db, (tx) => readCalendarDays(tx, f.cfg, "2026-10-13", "2026-10-16", reader));
  const holidaysOn = (days: CalendarDay[], date: LocalDate) =>
    days.find((day) => day.date === date)!.holidays.map((holiday) => holiday.id);

  it("merges each date's facts by date, asking the reader once with the caller's transaction", async () => {
    const f = await fixture();
    const { reader, calls } = fakeReader();
    let outer: Transaction | undefined;
    const days = await withTransaction(db, (tx) => {
      outer = tx;
      return readCalendarDays(tx, f.cfg, "2026-10-13", "2026-10-16", reader);
    });
    expect(calls).toEqual([{ tx: outer, cfg: f.cfg, from: "2026-10-13", to: "2026-10-16" }]);
    expect(calls[0]!.tx).toBe(outer);
    expect(days.map((day) => [day.date, day.holidays.map((holiday) => holiday.name)])).toEqual([
      ["2026-10-13", []],
      ["2026-10-14", ["Invented feast", "Second invented feast"]],
      ["2026-10-15", []],
      ["2026-10-16", ["Another invented day"]],
    ]);
    expect(days[1]!.holidays[0]).toEqual(FACTS[0]);
    // With no reader, no date has a fact.
    expect((await calendar(f)).every((day) => day.holidays.length === 0)).toBe(true);
  });

  it("reads a date with a fact and no special date as that fact with the standard hours", async () => {
    const f = await fixture();
    await save(f, f.restaurant, week({ 3: periods(period("12:00", "16:00")) }));
    const { reader } = fakeReader();
    const wednesday = (await calendar(f, reader))[1]!;
    expect(wednesday).toEqual({
      date: "2026-10-14",
      specialDate: null,
      holidays: [FACTS[0], FACTS[1]],
      tone: "standard",
    });
    const hours = await dateSnapshot(f, f.restaurant, "2026-10-14");
    expect([hours.specialCell, hours.specialDateId, hours.standardCell.mode]).toEqual([
      undefined,
      null,
      "periods",
    ]);
    expect(hours.standardCell.periods.map((p) => [p.opensAt, p.closesAt])).toEqual([
      ["12:00", "16:00"],
    ]);
  });

  it("keeps a date's facts as they are while a special date there is added, renamed and deleted", async () => {
    const f = await fixture();
    const { reader } = fakeReader();
    const before = holidaysOn(await calendar(f, reader), "2026-10-14");
    expect(before).toEqual(["h1", "h2"]);

    const added = await saveDate(
      f,
      null,
      specialInput({ date: "2026-10-14", name: "Our own party" }),
    );
    let days = await calendar(f, reader);
    expect(days[1]!.specialDate).toEqual({
      kind: "working_day",
      repeats: false,
      ownHours: false,
      id: added.id,
      date: "2026-10-14",
      name: "Our own party",

      closeWholeVenue: false,
    });
    expect(holidaysOn(days, "2026-10-14")).toEqual(before);

    await saveDate(f, added.id, specialInput({ date: "2026-10-14", name: "Renamed party" }));
    days = await calendar(f, reader);
    expect(days[1]!.specialDate?.name).toBe("Renamed party");
    expect(holidaysOn(days, "2026-10-14")).toEqual(before);

    await withTransaction(db, (tx) => deleteSpecialDate(tx, f.cfg, added.id, AT));
    days = await calendar(f, reader);
    expect(days[1]!.specialDate).toBeNull();
    expect(holidaysOn(days, "2026-10-14")).toEqual(before);
  });

  it("lets another module read facts and a special date's id from the package, without the page", async () => {
    const f = await fixture();
    const added = await saveDate(f, null, specialInput({ date: "2026-10-16" }));
    const { reader } = fakeReader();
    const days = await withTransaction(db, (tx) =>
      packageReadCalendarDays(tx, f.cfg, "2026-10-16", "2026-10-16", reader),
    );
    expect(days).toEqual([
      {
        date: "2026-10-16",
        specialDate: {
          kind: "working_day",
          repeats: false,
          ownHours: false,
          id: added.id,
          date: "2026-10-16",
          name: "Harvest festival",

          closeWholeVenue: false,
        },
        holidays: [FACTS[2]],
        tone: "blue",
      },
    ]);
  });

  it("ignores the old reserved colour values and stores only the kind", async () => {
    const f = await fixture();
    for (const [index, colour] of ["standard", "closed"].entries()) {
      const date = index === 0 ? "2026-10-09" : "2026-10-10";
      const saved = await saveDate(f, null, {
        ...specialInput({ date }),
        colour,
      } as SpecialDateInput);
      expect(saved).toMatchObject({ date, kind: "working_day" });
      const [row] = await db.select().from(specialDates).where(eq(specialDates.id, saved.id));
      expect(row).toMatchObject({ date, kind: "working_day" });
      expect(saved).not.toHaveProperty("colour");
      expect(row).not.toHaveProperty("colour");
    }
    expect(
      await withTransaction(db, (tx) => readCalendarDays(tx, f.cfg, "2026-10-09", "2026-10-10")),
    ).toMatchObject([
      { date: "2026-10-09", tone: "blue" },
      { date: "2026-10-10", tone: "blue" },
    ]);
  });

  it("gives the page model the same facts", async () => {
    const f = await fixture();
    const { reader, calls } = fakeReader();
    const model = await withTransaction(db, (tx) =>
      readHoursModel(tx, f.cfg, "2026-10-13", "2026-10-16", AT, reader),
    );
    expect(calls.map(({ from, to }) => [from, to])).toEqual([["2026-10-13", "2026-10-16"]]);
    expect(model.days.map((day) => day.holidays.map((holiday) => holiday.id))).toEqual([
      [],
      ["h1", "h2"],
      [],
      ["h3"],
    ]);
  });
});

describe("duplicating a special date", () => {
  it("copies the name and every cell to each target under new ids, an inactive station's included", async () => {
    const f = await fixture();
    const lunch = period("12:00", "15:00");
    const dinner = period("19:00", "23:00");
    const source = await saveDate(
      f,
      null,
      specialInput({
        cells: [
          { subject: f.restaurant, cell: { mode: "periods", periods: [lunch, dinner] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
          { subject: f.bar, cell: { mode: "all_day", periods: [] } },
        ],
      }),
    );
    await withTransaction(db, (tx) =>
      tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.deli.id)),
    );
    const sourceBefore = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, source.id));

    const copies = await duplicate(f, source.id, ["2026-10-23", "2026-10-30"]);
    expect(copies).toEqual([
      { ...source, id: expect.any(String), date: "2026-10-23" },
      { ...source, id: expect.any(String), date: "2026-10-30" },
    ]);
    const ids = new Set([source.id, ...copies.map((copy) => copy.id)]);
    expect(ids.size).toBe(3);

    const periodIds = new Set([lunch.id, dinner.id]);
    for (const copy of copies) {
      const read = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, copy.id));
      const withoutIds = (cells: typeof read.cells) =>
        cells.map(({ subject, cell }) => ({
          subject,
          cell: {
            ...cell,
            periods: cell.periods.map(({ opensAt, closesAt }) => ({ opensAt, closesAt })),
          },
        }));
      expect({ ...read, cells: withoutIds(read.cells) }).toEqual({
        ...copy,
        cells: withoutIds(sourceBefore.cells),
      });
      for (const { cell } of read.cells)
        for (const { id } of cell.periods) {
          expect(periodIds.has(id)).toBe(false);
          periodIds.add(id);
        }
      const rows = await dateRows(copy.id);
      expect(rows.cells.some((cell) => cell.stationId === f.deli.id)).toBe(true);
    }
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, source.id))).toEqual(
      sourceBefore,
    );
  });

  it("copies a whole-venue closure and the cells it hides", async () => {
    const f = await fixture();
    const cells = [
      { subject: f.bar, cell: { mode: "all_day", periods: [] } },
    ] as SpecialDateInput["cells"];
    const source = await saveDate(f, null, specialInput({ closeWholeVenue: true, cells }));
    const [copy] = await duplicate(f, source.id, ["2026-10-16"]);
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, copy!.id))).toEqual({
      ...source,
      id: copy!.id,
      date: "2026-10-16",
      cells,
    });
    expect(await dateSnapshot(f, f.bar, "2026-10-16")).toMatchObject({
      closeWholeVenue: true,
      state: { open: false, isDefault: false },
    });
  });

  it("leaves an inherited cell inheriting, so a Monday copied to a Sunday reads Sunday's week", async () => {
    const f = await fixture();
    const sunday = period("12:00", "16:00");
    await save(f, f.restaurant, week({ 1: periods(period("09:00", "17:00")), 0: periods(sunday) }));
    const monday = await saveDate(
      f,
      null,
      specialInput({
        date: "2026-10-12",
        cells: [
          { subject: f.restaurant, cell: { mode: "inherit", periods: [] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
        ],
      }),
    );
    const [copy] = await duplicate(f, monday.id, ["2026-10-18"]);
    expect(await dateSnapshot(f, f.restaurant, "2026-10-18")).toMatchObject({
      subject: f.restaurant,
      openingDate: "2026-10-18",
      specialDateId: copy!.id,
      specialCell: undefined,
      closeWholeVenue: false,
      standardCell: { mode: "periods", periods: [sunday] },
      state: { isDefault: false },
    });
    expect((await dateRows(copy!.id)).cells.map((cell) => cell.stationId)).toEqual([f.deli.id]);
  });

  const zone = "Europe/Madrid";
  const forward = clockChangeAfter(zone, "2027-01-01T00:00:00Z", "forward");
  const skipped = minutesAfter(forward.before, 1);

  const refusals: [
    string,
    (f: Fixture) => Promise<{ sourceId: string; dates: unknown }>,
    { code: string; params: Record<string, unknown> },
  ][] = [
    [
      "a target repeated within the batch",
      async (f) => ({
        sourceId: (await saveDate(f, null, specialInput())).id,
        dates: ["2026-10-20", "2026-10-21", "2026-10-20"],
      }),
      { code: "hours.invalid", params: { field: "dates.2" } },
    ],
    [
      "a target another special date holds",
      async (f) => {
        await saveDate(f, null, specialInput({ date: "2026-10-21" }));
        return {
          sourceId: (await saveDate(f, null, specialInput())).id,
          dates: ["2026-10-20", "2026-10-21"],
        };
      },
      { code: "special_date.date_taken", params: { date: "2026-10-21" } },
    ],
    [
      "a date that does not exist",
      async (f) => ({
        sourceId: (await saveDate(f, null, specialInput())).id,
        dates: ["2026-10-20", "2026-02-30"],
      }),
      { code: "hours.invalid", params: { field: "dates.1" } },
    ],
    [
      "the source's own date",
      async (f) => ({
        sourceId: (await saveDate(f, null, specialInput())).id,
        dates: ["2026-10-20", "2026-10-09"],
      }),
      { code: "special_date.date_taken", params: { date: "2026-10-09" } },
    ],
    [
      "no targets at all",
      async (f) => ({ sourceId: (await saveDate(f, null, specialInput())).id, dates: [] }),
      { code: "hours.invalid", params: { field: "dates" } },
    ],
    [
      "targets that are not a list",
      async (f) => ({
        sourceId: (await saveDate(f, null, specialInput())).id,
        dates: "2026-10-20",
      }),
      { code: "hours.invalid", params: { field: "dates" } },
    ],
    [
      "a copied period that opens at a minute the clock skips on a target",
      async (f) => ({
        sourceId: (
          await saveDate(
            f,
            null,
            specialInput({
              date: "2027-02-10",
              cells: [
                { subject: f.bar, cell: { mode: "periods", periods: [period(skipped, "12:00")] } },
              ],
            }),
          )
        ).id,
        dates: ["2027-02-17", forward.date],
      }),
      { code: "hours.invalid", params: { field: "dates.1", date: forward.date, subjectId: "bar" } },
    ],
    [
      "a target whose copied tail runs into the next day's standard opening",
      async (f) => {
        await save(f, f.restaurant, week({ 6: periods(period("01:00", "05:00")) }));
        // Wednesday 7 October; the copy on Friday 16 October runs into Saturday 17 October.
        const source = await saveDate(
          f,
          null,
          specialInput({
            date: "2026-10-07",
            cells: [
              {
                subject: f.restaurant,
                cell: { mode: "periods", periods: [period("22:00", "03:00")] },
              },
            ],
          }),
        );
        return { sourceId: source.id, dates: ["2026-10-14", "2026-10-16"] };
      },
      {
        code: "hours.invalid",
        params: { field: "dates.1", date: "2026-10-17", subjectId: "restaurant" },
      },
    ],
    [
      "two adjacent targets whose copies overlap each other",
      async (f) => ({
        sourceId: (
          await saveDate(
            f,
            null,
            specialInput({
              date: "2026-10-07",
              cells: [
                {
                  subject: f.bar,
                  cell: {
                    mode: "periods",
                    periods: [period("01:00", "05:00"), period("22:00", "03:00")],
                  },
                },
              ],
            }),
          )
        ).id,
        dates: ["2026-10-20", "2026-10-21"],
      }),
      { code: "hours.invalid", params: { field: "dates.0", date: "2026-10-21", subjectId: "bar" } },
    ],
  ];

  it.each(refusals)("refuses %s and creates no target at all", async (_, make, expected) => {
    const f = await fixture();
    const { sourceId, dates } = await make(f);
    const before = await storedDates(f);
    const named = (value: unknown) =>
      value === "bar" ? f.bar.id : value === "restaurant" ? f.restaurant.id : value;
    await expect(duplicate(f, sourceId, dates)).rejects.toMatchObject({
      code: expected.code,
      params: Object.fromEntries(
        Object.entries(expected.params).map(([key, value]) => [key, named(value)]),
      ),
    });
    expect(await storedDates(f)).toEqual(before);
  });

  it("copies the cell of a station that has since become the default as it is, and that station stays Always open on each copy", async () => {
    const f = await fixture();
    const evening = period("18:00", "22:00");
    const source = await saveDate(
      f,
      null,
      specialInput({
        cells: [
          { subject: f.bar, cell: { mode: "periods", periods: [evening] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
        ],
      }),
    );
    await makeDefault(f, f.bar);
    const copies = await duplicate(f, source.id, ["2026-10-20", "2026-10-21"]);
    expect(copies.map((copy) => copy.date)).toEqual(["2026-10-20", "2026-10-21"]);
    for (const copy of copies) {
      const read = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, copy.id));
      const bar = read.cells.find(({ subject }) => subject.id === f.bar.id);
      expect(bar).toEqual({
        subject: f.bar,
        cell: {
          mode: "periods",
          periods: [{ id: expect.any(String), opensAt: "18:00", closesAt: "22:00" }],
        },
      });
      expect(bar!.cell.periods[0]!.id).not.toBe(evening.id);
      expect(read.cells.find(({ subject }) => subject.id === f.deli.id)?.cell).toEqual(closed);
      expect(await dateSnapshot(f, f.bar, copy.date)).toMatchObject({
        subject: f.bar,
        openingDate: copy.date,
        specialDateId: copy.id,
        state: { open: true, isDefault: true },
      });
    }
  });

  it("copies the cell of a station that has since become the default onto a day whose clock skips one of its times", async () => {
    const f = await fixture();
    const source = await saveDate(
      f,
      null,
      specialInput({
        date: "2027-02-10",
        cells: [{ subject: f.bar, cell: { mode: "periods", periods: [period(skipped, "12:00")] } }],
      }),
    );
    await makeDefault(f, f.bar);
    const [copy] = await duplicate(f, source.id, [forward.date]);
    expect(copy!.date).toBe(forward.date);
    expect((await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, copy!.id))).cells).toEqual(
      [
        {
          subject: f.bar,
          cell: {
            mode: "periods",
            periods: [{ id: expect.any(String), opensAt: skipped, closesAt: "12:00" }],
          },
        },
      ],
    );
  });

  it("copies a period onto a clock-change day while the venue's clock cannot be read", async () => {
    const f = await fixture();
    const source = await saveDate(
      f,
      null,
      specialInput({
        date: "2027-02-10",
        cells: [{ subject: f.bar, cell: { mode: "periods", periods: [period(skipped, "12:00")] } }],
      }),
    );
    await withTransaction(db, (tx) =>
      tx.update(locations).set({ timeZone: "Mars/Base" }).where(eq(locations.id, f.cfg.locationId)),
    );
    const [copy] = await duplicate(f, source.id, [forward.date]);
    expect(copy!.date).toBe(forward.date);
  });

  it("saves each of two overlapping copies once they are not adjacent", async () => {
    const f = await fixture();
    const source = await saveDate(
      f,
      null,
      specialInput({
        date: "2026-10-07",
        cells: [
          {
            subject: f.bar,
            cell: {
              mode: "periods",
              periods: [period("01:00", "05:00"), period("22:00", "03:00")],
            },
          },
        ],
      }),
    );
    const copies = await duplicate(f, source.id, ["2026-10-20", "2026-10-22"]);
    expect(copies.map((copy) => copy.date)).toEqual(["2026-10-20", "2026-10-22"]);
  });
});

describe("deleting a special date", () => {
  it("removes the date, its cells and periods, and its subjects read their standard week again", async () => {
    const f = await fixture();
    const friday = period("12:00", "16:00");
    await save(f, f.restaurant, week({ 5: periods(friday) }));
    const date = await saveDate(
      f,
      null,
      specialInput({
        cells: [
          { subject: f.restaurant, cell: { mode: "closed", periods: [] } },
          { subject: f.bar, cell: { mode: "periods", periods: [period("10:00", "14:00")] } },
        ],
      }),
    );
    const rows = await dateRows(date.id);
    expect(rows.cells).toHaveLength(2);
    expect(rows.periods).toHaveLength(1);

    await remove(f, date.id);

    expect(await storedDates(f)).toEqual([]);
    const cellIds = rows.cells.map((cell) => cell.id);
    expect(
      await withTransaction(db, (tx) =>
        tx.select().from(specialDateHours).where(inArray(specialDateHours.id, cellIds)),
      ),
    ).toEqual([]);
    expect(
      await withTransaction(db, (tx) =>
        tx
          .select()
          .from(specialDateHoursPeriods)
          .where(inArray(specialDateHoursPeriods.cellId, cellIds)),
      ),
    ).toEqual([]);
    expect(await dateSnapshot(f, f.restaurant, "2026-10-09")).toMatchObject({
      subject: f.restaurant,
      openingDate: "2026-10-09",
      specialDateId: null,
      specialCell: undefined,
      closeWholeVenue: false,
      standardCell: { mode: "periods", periods: [friday] },
      state: { isDefault: false },
    });
    expect((await dateSnapshot(f, f.bar, "2026-10-09")).standardCell).toEqual({
      mode: "not_set",
      periods: [],
    });
    await expect(remove(f, date.id)).rejects.toMatchObject({
      code: "special_date.not_found",
      params: { specialDateId: date.id },
    });
  });

  const withBar = (f: Fixture, date: LocalDate, cell: DateHoursCell["cell"]) =>
    specialInput({ date, cells: [{ subject: f.bar, cell }] });
  const closedCell: DateHoursCell["cell"] = { mode: "closed", periods: [] };

  it("refuses deleting a date whose standard hours would then clash with the special date before it", async () => {
    const f = await fixture();
    await save(f, f.bar, week({ 6: periods(period("01:00", "05:00")) }));
    // Saturday 17 October is Closed, so Friday 16 October's late special hours can run into it.
    const saturday = await saveDate(f, null, withBar(f, "2026-10-17", closedCell));
    await saveDate(
      f,
      null,
      withBar(f, "2026-10-16", { mode: "periods", periods: [period("22:00", "03:00")] }),
    );
    const before = await storedDates(f);
    const rows = await dateRows(saturday.id);
    const participant = { copy: vi.fn(), beforeDelete: vi.fn() };

    await expect(remove(f, saturday.id, [participant])).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "date", date: "2026-10-16", subjectId: f.bar.id },
    });
    expect(participant.beforeDelete).not.toHaveBeenCalled();
    expect(await storedDates(f)).toEqual(before);
    expect(await dateRows(saturday.id)).toEqual(rows);
  });

  it("refuses deleting a Closed date whose standard tail would then run into the special date after it", async () => {
    const f = await fixture();
    await save(f, f.bar, week({ 5: periods(period("22:00", "03:00")) }));
    const friday = await saveDate(f, null, withBar(f, "2026-10-16", closedCell));
    await saveDate(
      f,
      null,
      withBar(f, "2026-10-17", { mode: "periods", periods: [period("01:00", "05:00")] }),
    );
    const before = await storedDates(f);
    const rows = await dateRows(friday.id);

    await expect(remove(f, friday.id)).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "date", date: "2026-10-17", subjectId: f.bar.id },
    });
    expect(await storedDates(f)).toEqual(before);
    expect(await dateRows(friday.id)).toEqual(rows);
  });

  it("deletes a past date beside such a neighbour, since past hours block nothing", async () => {
    const f = await fixture();
    await save(f, f.bar, week({ 6: periods(period("01:00", "05:00")) }));
    // Friday 25 and Saturday 26 September are in the past at AT.
    const saturday = await saveDate(f, null, withBar(f, "2026-09-26", closedCell));
    await saveDate(
      f,
      null,
      withBar(f, "2026-09-25", { mode: "periods", periods: [period("22:00", "03:00")] }),
    );
    await remove(f, saturday.id);
    expect((await storedDates(f)).map((date) => date.date)).toEqual(["2026-09-25"]);
  });

  it("refuses another venue reading, changing, copying or deleting the date", async () => {
    const f = await fixture();
    const other = await fixture();
    const date = await saveDate(
      f,
      null,
      specialInput({ cells: [{ subject: f.deli, cell: { mode: "closed", periods: [] } }] }),
    );
    const before = await storedDates(f);
    const notFound = { code: "special_date.not_found", params: { specialDateId: date.id } };

    await expect(
      withTransaction(db, (tx) => readSpecialDate(tx, other.cfg, date.id)),
    ).rejects.toMatchObject(notFound);
    await expect(
      saveDate(other, date.id, specialInput({ date: "2026-10-20" })),
    ).rejects.toMatchObject(notFound);
    await expect(duplicate(other, date.id, ["2026-10-20"])).rejects.toMatchObject(notFound);
    await expect(remove(other, date.id)).rejects.toMatchObject(notFound);

    expect(await storedDates(f)).toEqual(before);
    expect(await storedDates(other)).toEqual([]);
  });
});

describe("calendar participants", () => {
  it("is the menu timetable's alone", () => {
    expect(VENUE_SERVICE_CALENDAR_PARTICIPANTS).toEqual([MENU_TIMETABLE_CALENDAR_PARTICIPANT]);
  });

  // A stand-in for a module's own date-linked rows, such as a menu timetable's overrides.
  beforeAll(async () => {
    await withTransaction(db, (tx) =>
      tx.run(
        sql`create table if not exists participant_copies (participant text not null, source_id text not null, target_id text not null)`,
      ),
    );
  });

  const participantRows = (targetIds: string[]) =>
    withTransaction(db, (tx) =>
      tx.all<{ participant: string; source_id: string; target_id: string }>(
        sql`select participant, source_id, target_id from participant_copies where target_id in (${sql.join(
          targetIds.map((id) => sql`${id}`),
          sql`, `,
        )}) order by participant, target_id`,
      ),
    );

  interface Call {
    tx: Transaction;
    kind: "copy" | "beforeDelete";
    sourceId?: string;
    targetId?: string;
    id?: string;
    targetExists?: boolean;
    targetCells?: number;
  }

  function recorder(name: string, failOn: { copy?: number; beforeDelete?: boolean } = {}) {
    const calls: Call[] = [];
    const participant: SpecialDateParticipant = {
      async copy(tx, cfg, sourceId, targetId) {
        const [target] = await tx
          .select()
          .from(specialDates)
          .where(and(eq(specialDates.id, targetId), eq(specialDates.locationId, cfg.locationId)));
        const cells = await tx
          .select()
          .from(specialDateHours)
          .where(eq(specialDateHours.specialDateId, targetId));
        calls.push({
          tx,
          kind: "copy",
          sourceId,
          targetId,
          targetExists: target !== undefined,
          targetCells: cells.length,
        });
        await tx.run(
          sql`insert into participant_copies (participant, source_id, target_id) values (${name}, ${sourceId}, ${targetId})`,
        );
        if (calls.filter((call) => call.kind === "copy").length === failOn.copy)
          throw new Error(`${name} refused target ${failOn.copy}`);
      },
      async beforeDelete(tx, _cfg, id) {
        calls.push({ tx, kind: "beforeDelete", id });
        if (failOn.beforeDelete) throw new Error(`${name} refused the delete`);
      },
    };
    return { participant, calls };
  }

  it("hands every target, with its hours written, to every participant inside the same transaction", async () => {
    const f = await fixture();
    const source = await saveDate(
      f,
      null,
      specialInput({
        cells: [
          { subject: f.bar, cell: { mode: "closed", periods: [] } },
          { subject: f.deli, cell: { mode: "all_day", periods: [] } },
        ],
      }),
    );
    const menus = recorder("menus");
    const wages = recorder("wages");
    let outer: Transaction | undefined;
    const copies = await withTransaction(db, (tx) => {
      outer = tx;
      return duplicateSpecialDate(
        tx,
        f.cfg,
        source.id,
        ["2026-10-20", "2026-10-21", "2026-10-22"],
        AT,
        [menus.participant, wages.participant],
      );
    });
    const targetIds = copies.map((copy) => copy.id);
    for (const { calls } of [menus, wages]) {
      expect(
        calls.map(({ kind, sourceId, targetId, targetExists, targetCells }) => ({
          kind,
          sourceId,
          targetId,
          targetExists,
          targetCells,
        })),
      ).toEqual(
        targetIds.map((targetId) => ({
          kind: "copy",
          sourceId: source.id,
          targetId,
          targetExists: true,
          targetCells: 2,
        })),
      );
      for (const call of calls) expect(call.tx).toBe(outer);
    }
    expect(await participantRows(targetIds)).toEqual(
      ["menus", "wages"].flatMap((participant) =>
        [...targetIds].sort().map((target_id) => ({
          participant,
          source_id: source.id,
          target_id,
        })),
      ),
    );
  });

  it("creates no target, cell or participant row when a participant fails on the second target", async () => {
    const f = await fixture();
    const source = await saveDate(
      f,
      null,
      specialInput({
        cells: [{ subject: f.bar, cell: { mode: "periods", periods: [period("12:00", "15:00")] } }],
      }),
    );
    const before = await storedDates(f);
    const cellsBefore = await withTransaction(db, (tx) => tx.select().from(specialDateHours));
    const periodsBefore = await withTransaction(db, (tx) =>
      tx.select().from(specialDateHoursPeriods),
    );
    const menus = recorder("menus", { copy: 2 });

    await expect(
      duplicate(f, source.id, ["2026-10-20", "2026-10-21", "2026-10-22"], [menus.participant]),
    ).rejects.toThrow("menus refused target 2");

    const targetIds = menus.calls.map((call) => call.targetId!);
    expect(targetIds).toHaveLength(2);
    expect(await storedDates(f)).toEqual(before);
    expect(await withTransaction(db, (tx) => tx.select().from(specialDateHours))).toEqual(
      cellsBefore,
    );
    expect(await withTransaction(db, (tx) => tx.select().from(specialDateHoursPeriods))).toEqual(
      periodsBefore,
    );
    expect(await participantRows(targetIds)).toEqual([]);
  });

  it("asks every participant before deleting, inside the deleting transaction", async () => {
    const f = await fixture();
    const date = await saveDate(f, null, specialInput());
    const menus = recorder("menus");
    const wages = recorder("wages");
    let outer: Transaction | undefined;
    await withTransaction(db, (tx) => {
      outer = tx;
      return deleteSpecialDate(tx, f.cfg, date.id, AT, [menus.participant, wages.participant]);
    });
    for (const { calls } of [menus, wages]) {
      expect(calls.map(({ kind, id }) => ({ kind, id }))).toEqual([
        { kind: "beforeDelete", id: date.id },
      ]);
      expect(calls[0]!.tx).toBe(outer);
    }
    expect(await storedDates(f)).toEqual([]);
  });

  it("keeps the date and every cell when a participant refuses the delete", async () => {
    const f = await fixture();
    const date = await saveDate(
      f,
      null,
      specialInput({
        cells: [
          { subject: f.bar, cell: { mode: "periods", periods: [period("12:00", "15:00")] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
        ],
      }),
    );
    const before = await storedDates(f);
    const rowsBefore = await dateRows(date.id);
    const menus = recorder("menus", { beforeDelete: true });

    await expect(remove(f, date.id, [menus.participant])).rejects.toThrow(
      "menus refused the delete",
    );

    expect(await storedDates(f)).toEqual(before);
    expect(await dateRows(date.id)).toEqual(rowsBefore);
  });
});

describe("renaming a special date", () => {
  it("changes its name alone, a default station's dormant cell included", async () => {
    const f = await fixture();
    const source = await saveDate(
      f,
      null,
      specialInput({
        closeWholeVenue: true,
        cells: [{ subject: f.bar, cell: { mode: "periods", periods: [period("12:00", "15:00")] } }],
      }),
    );
    await makeDefault(f, f.bar);
    const before = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, source.id));
    const renamed = await withTransaction(db, (tx) =>
      renameSpecialDate(tx, f.cfg, source.id, "  Feast day "),
    );
    expect(renamed).toEqual({ ...source, name: "Feast day" });
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, source.id))).toEqual({
      ...before,
      name: "Feast day",
    });
  });

  it("refuses a blank name and another venue's date, writing nothing", async () => {
    const f = await fixture();
    const source = await saveDate(f, null, specialInput());
    const before = await storedDates(f);
    for (const name of ["   ", "", 7])
      await expect(
        withTransaction(db, (tx) => renameSpecialDate(tx, f.cfg, source.id, name as string)),
      ).rejects.toMatchObject({ code: "hours.invalid", params: { field: "name" } });
    const other = await fixture();
    await expect(
      withTransaction(db, (tx) => renameSpecialDate(tx, other.cfg, source.id, "Feast day")),
    ).rejects.toMatchObject({ code: "special_date.not_found" });
    expect(await storedDates(f)).toEqual(before);
  });
});

describe("Hours with the holiday store", () => {
  const SHA = "a".repeat(64);
  const long = (letter: string) => letter.repeat(200);
  /** An invented country, so nothing here depends on a real country's holidays. */
  function pack(repeatFacts = false, reads?: string[]): CountryPack {
    const calendar = createHolidayCalendar({
      localEntryLimit: 2,
      sources: [
        { id: "ZZ-ANNEX", title: "Invented annex", url: "https://example.test/annex", sha256: SHA },
      ],
      provinceRegions: { "10": "R1" },
      areas: [],
      years: [
        {
          year: 2026,
          dataVersion: "ZZ-2026.1",
          sourceIds: ["ZZ-ANNEX"],
          rows: [
            ...(
              [
                ["feast", "2026-12-25", "National label", "national"],
                ["north", "2026-12-25", "Regional label", "regional"],
                ["long-n", "2026-08-03", long("a"), "national"],
                ["long-r", "2026-08-03", long("b"), "regional"],
              ] as const
            ).map(([key, date, name, scope]) => ({
              key,
              date,
              name,
              scope,
              regions: ["R1"],
              sourceId: "ZZ-ANNEX",
            })),
          ],
        },
      ],
    });
    return {
      countryCode: "ZZ",
      defaultLocale: "en-GB",
      defaultTimeZone: "Europe/Madrid",
      invoiceLocales: ["en-GB"],
      moduleIds: [],
      availableForVenueSetup: false,
      fiscalJurisdictions: [],
      administrativeAreas: [{ code: "10", name: "Northshire", postalPrefixes: [] }],
      holidayCalendar: {
        ...calendar,
        read: (input) => {
          reads?.push(`${input.from}..${input.to}`);
          const read = calendar.read(input);
          return repeatFacts ? { ...read, facts: [...read.facts, ...read.facts] } : read;
        },
      },
    };
  }
  const store = createHolidayStore((country) => (country === "ZZ" ? pack() : undefined));

  // The file shares one taxpayer row; put back whatever it held before each case moved it.
  let tenantBefore: (typeof tenants.$inferSelect)[] = [];
  beforeAll(async () => {
    tenantBefore = await withTransaction(db, (tx) => tx.select().from(tenants));
  });
  afterEach(async () => {
    await withTransaction(db, async (tx) => {
      await tx.delete(tenants);
      if (tenantBefore.length > 0) await tx.insert(tenants).values(tenantBefore);
    });
  });

  async function placed(): Promise<Fixture> {
    const f = await fixture();
    await withTransaction(db, async (tx) => {
      await tx
        .insert(tenants)
        .values({ id: 1, country: "ZZ", taxId: "X0000000", legalName: "Invented SL" })
        .onConflictDoUpdate({ target: tenants.id, set: { country: "ZZ" } });
      await tx
        .update(locations)
        .set({ province: "Northshire", city: "Villa Real" })
        .where(eq(locations.id, f.cfg.locationId));
    });
    return f;
  }

  const named = (
    f: Fixture,
    id: string,
    dates: unknown,
    participants?: readonly SpecialDateParticipant[],
  ) =>
    withTransaction(db, (tx) =>
      store.duplicateHolidayNamedSpecialDates(
        tx,
        f.cfg,
        id,
        dates as LocalDate[],
        AT,
        participants,
      ),
    );

  it("reads a holiday with no special date as its facts beside the standard hours", async () => {
    const f = await placed();
    await save(f, f.restaurant, week({ 5: periods(period("12:00", "16:00")) }));
    const days = await withTransaction(db, (tx) =>
      readCalendarDays(tx, f.cfg, "2026-12-24", "2026-12-26", store.readHolidayFacts),
    );
    expect(days[1]).toEqual({
      date: "2026-12-25",
      specialDate: null,
      holidays: [
        {
          id: "shipped:feast",
          date: "2026-12-25",
          name: "National label",
          scope: "national",
          sourceId: "ZZ-ANNEX",
        },
        {
          id: "shipped:north",
          date: "2026-12-25",
          name: "Regional label",
          scope: "regional",
          sourceId: "ZZ-ANNEX",
        },
      ],
      tone: "standard",
    });
    expect([days[0]!.holidays, days[2]!.holidays]).toEqual([[], []]);
    expect(await dateSnapshot(f, f.restaurant, "2026-12-25")).toMatchObject({
      specialCell: undefined,
      closeWholeVenue: false,
      specialDateId: null,
      standardCell: { mode: "periods", periods: [{ opensAt: "12:00", closesAt: "16:00" }] },
      state: { isDefault: false },
    });
  });

  it("gives the calendar a fact the provider repeats only once", async () => {
    const f = await placed();
    const repeating = createHolidayStore((country) => (country === "ZZ" ? pack(true) : undefined));
    const days = await withTransaction(db, (tx) =>
      readCalendarDays(tx, f.cfg, "2026-12-25", "2026-12-25", repeating.readHolidayFacts),
    );
    expect(days[0]!.holidays.map(({ id }) => id)).toEqual(["shipped:feast", "shipped:north"]);
  });

  it("keeps a holiday's facts while a special date there is saved, renamed, moved and deleted", async () => {
    const f = await placed();
    const calendar = () =>
      withTransaction(db, (tx) =>
        readCalendarDays(tx, f.cfg, "2026-12-24", "2026-12-25", store.readHolidayFacts),
      );
    const before = await calendar();
    const added = await saveDate(f, null, specialInput({ date: "2026-12-25", name: "Ours" }));
    expect((await calendar())[1]).toEqual({
      ...before[1],
      specialDate: { ...added },
      tone: "blue",
    });
    await saveDate(f, added.id, specialInput({ date: "2026-12-25", name: "Renamed" }));
    expect((await calendar())[1]!.holidays).toEqual(before[1]!.holidays);
    await saveDate(f, added.id, specialInput({ date: "2026-12-24", name: "Renamed" }));
    const moved = await calendar();
    expect(moved.map(({ specialDate }) => specialDate?.id ?? null)).toEqual([added.id, null]);
    expect(moved.map(({ holidays }) => holidays)).toEqual(before.map(({ holidays }) => holidays));
    await remove(f, added.id);
    expect(await calendar()).toEqual(before);
  });

  // A stand-in for a module's own date-linked rows.
  beforeAll(async () => {
    await withTransaction(db, (tx) =>
      tx.run(
        sql`create table if not exists holiday_participant_copies (source_id text not null, target_id text not null)`,
      ),
    );
  });
  const copiedRows = (targetIds: string[]) =>
    withTransaction(db, (tx) =>
      tx.all<{ source_id: string; target_id: string }>(
        sql`select source_id, target_id from holiday_participant_copies where target_id in (${sql.join(
          targetIds.map((id) => sql`${id}`),
          sql`, `,
        )}) order by target_id`,
      ),
    );
  function participant(failOnCopy?: number) {
    const calls: { tx: Transaction; targetId: string }[] = [];
    const value: SpecialDateParticipant = {
      async copy(tx, _cfg, sourceId, targetId) {
        calls.push({ tx, targetId });
        await tx.run(
          sql`insert into holiday_participant_copies (source_id, target_id) values (${sourceId}, ${targetId})`,
        );
        if (calls.length === failOnCopy) throw new Error(`refused target ${failOnCopy}`);
      },
      async beforeDelete() {},
    };
    return { value, calls };
  }

  it("names a copy on a holiday after it and a copy on an ordinary date after the source, copying everything else", async () => {
    const f = await placed();
    const source = await saveDate(
      f,
      null,
      specialInput({
        date: "2026-12-18",
        name: "Summer opening",

        closeWholeVenue: true,
        cells: [
          { subject: f.bar, cell: { mode: "periods", periods: [period("12:00", "15:00")] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
        ],
      }),
    );
    await makeDefault(f, f.bar);
    const sourceBefore = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, source.id));
    const menus = participant();
    let outer: Transaction | undefined;
    const copies = await withTransaction(db, (tx) => {
      outer = tx;
      return store.duplicateHolidayNamedSpecialDates(
        tx,
        f.cfg,
        source.id,
        ["2026-12-25", "2026-12-29"],
        AT,
        [menus.value],
      );
    });
    expect(copies).toEqual([
      {
        kind: "working_day",
        repeats: false,
        ownHours: false,
        id: expect.any(String),
        date: "2026-12-25",
        name: "National label · Regional label",

        closeWholeVenue: true,
      },
      {
        kind: "working_day",
        repeats: false,
        ownHours: false,
        id: expect.any(String),
        date: "2026-12-29",
        name: "Summer opening",

        closeWholeVenue: true,
      },
    ]);
    expect(new Set([source.id, ...copies.map(({ id }) => id)]).size).toBe(3);
    const withoutIds = (cells: DateHoursCell[]) =>
      cells.map(({ subject, cell }) => ({
        subject,
        cell: {
          mode: cell.mode,
          periods: cell.periods.map(({ opensAt, closesAt }) => ({ opensAt, closesAt })),
        },
      }));
    for (const copy of copies) {
      const read = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, copy.id));
      expect({ ...read, cells: withoutIds(read.cells) }).toEqual({
        ...copy,
        cells: withoutIds(sourceBefore.cells),
      });
    }
    expect(menus.calls.map(({ targetId }) => targetId)).toEqual(copies.map(({ id }) => id));
    for (const call of menus.calls) expect(call.tx).toBe(outer);
    expect(await copiedRows(copies.map(({ id }) => id))).toEqual(
      copies
        .map(({ id }) => ({ source_id: source.id, target_id: id }))
        .sort((a, b) => (a.target_id < b.target_id ? -1 : 1)),
    );
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, source.id))).toEqual(
      sourceBefore,
    );
  });

  it("names targets more than a year apart, keeping the source name where the year is not shipped", async () => {
    const f = await placed();
    const source = await saveDate(f, null, specialInput({ name: "Summer opening" }));
    const copies = await named(f, source.id, ["2028-01-05", "2026-12-25"]);
    expect(copies.map(({ date, name }) => [date, name])).toEqual([
      ["2028-01-05", "Summer opening"],
      ["2026-12-25", "National label · Regional label"],
    ]);
    const read = await withTransaction(db, (tx) =>
      store.readHolidays(tx, f.cfg, "2028-01-05", "2028-01-05"),
    );
    expect(read.facts).toEqual([]);
    expect(read.coverage).toMatchObject([{ year: 2028, nationalRegional: "missing_year" }]);
  });

  it("reads holidays once per calendar year the targets touch, not once per target", async () => {
    const f = await placed();
    const reads: string[] = [];
    const counting = createHolidayStore((country) =>
      country === "ZZ" ? pack(false, reads) : undefined,
    );
    const source = await saveDate(f, null, specialInput({ name: "Summer opening" }));
    await withTransaction(db, (tx) =>
      counting.duplicateHolidayNamedSpecialDates(
        tx,
        f.cfg,
        source.id,
        ["2026-12-25", "2028-01-05", "2026-11-02", "2026-12-29"],
        AT,
      ),
    );
    expect(reads.sort()).toEqual(["2026-11-02..2026-12-29", "2028-01-05..2028-01-05"]);
  });

  it("keeps a joined name of two 200-character public labels whole", async () => {
    const f = await placed();
    const source = await saveDate(f, null, specialInput());
    const [copy] = await named(f, source.id, ["2026-08-03"]);
    const joined = `${long("a")} · ${long("b")}`;
    expect(copy!.name).toBe(joined);
    expect((await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, copy!.id))).name).toBe(
      joined,
    );
  });

  const refusals: [string, (f: Fixture, sourceId: string) => Promise<unknown[]>, object][] = [
    [
      "a target another special date holds",
      async (f) => {
        await saveDate(f, null, specialInput({ date: "2026-12-29" }));
        return ["2026-12-25", "2026-12-29"];
      },
      { code: "special_date.date_taken", params: { date: "2026-12-29" } },
    ],
    [
      "a repeated target",
      async () => ["2026-12-25", "2026-12-25"],
      { code: "hours.invalid", params: { field: "dates.1" } },
    ],
    [
      "the source's own date",
      async () => ["2026-12-25", "2026-10-09"],
      { code: "special_date.date_taken", params: { date: "2026-10-09" } },
    ],
    [
      "a date that does not exist",
      async () => ["2026-12-25", "2026-02-30"],
      { code: "hours.invalid", params: { field: "dates.1" } },
    ],
  ];

  it.each(refusals)("refuses %s and creates no target at all", async (_, make, expected) => {
    const f = await placed();
    const source = await saveDate(f, null, specialInput());
    const dates = await make(f, source.id);
    const before = await storedDates(f);
    await expect(named(f, source.id, dates)).rejects.toMatchObject(expected);
    expect(await storedDates(f)).toEqual(before);
  });

  it("creates no target, rename or participant row when a participant fails on the second target", async () => {
    const f = await placed();
    const source = await saveDate(f, null, specialInput());
    const before = await storedDates(f);
    const menus = participant(2);
    await expect(named(f, source.id, ["2026-12-25", "2026-12-29"], [menus.value])).rejects.toThrow(
      "refused target 2",
    );
    expect(menus.calls).toHaveLength(2);
    expect(await storedDates(f)).toEqual(before);
    expect(await copiedRows(menus.calls.map(({ targetId }) => targetId))).toEqual([]);
  });

  it("is exported from the package index, bound to the installed country packs", () => {
    expect(installedDuplicateHolidayNamedSpecialDates).toBeTypeOf("function");
    expect(packageIndex.duplicateHolidayNamedSpecialDates).toBe(
      installedDuplicateHolidayNamedSpecialDates,
    );
    expect(renameSpecialDate).toBeTypeOf("function");
    expect(packageIndex.renameSpecialDate).toBe(renameSpecialDate);
  });
});

describe("Hours on a real Spanish public holiday", () => {
  // Monday 12 October 2026 is Spain's national day; Monday 5 October is an ordinary Monday.
  const HOLIDAY = "2026-10-12";
  const ORDINARY = "2026-10-05";

  let tenantBefore: (typeof tenants.$inferSelect)[] = [];
  beforeAll(async () => {
    tenantBefore = await withTransaction(db, (tx) => tx.select().from(tenants));
  });
  afterEach(async () => {
    await withTransaction(db, async (tx) => {
      await tx.delete(tenants);
      if (tenantBefore.length > 0) await tx.insert(tenants).values(tenantBefore);
    });
  });

  /** The fixture's venue in Seville, Spain, with Monday hours for the restaurant and the bar. */
  async function seville(): Promise<Fixture> {
    const f = await fixture();
    await withTransaction(db, async (tx) => {
      await tx
        .insert(tenants)
        .values({ id: 1, country: "ES", taxId: "X0000000", legalName: "Invented SL" })
        .onConflictDoUpdate({ target: tenants.id, set: { country: "ES" } });
      await tx
        .update(locations)
        .set({ province: "Sevilla", city: "Sevilla" })
        .where(eq(locations.id, f.cfg.locationId));
    });
    await save(f, f.restaurant, week({ 1: periods(period("12:00", "16:00")) }));
    await save(f, f.bar, week({ 1: periods(period("18:00", "23:00")) }));
    return f;
  }

  const schedule = (f: Fixture, from: LocalDate, to: LocalDate) =>
    withTransaction(db, async (tx) =>
      (await readStationSchedules(tx, f.cfg, [f.bar.id], { from, to })).get(f.bar.id)!,
    );

  it("shows the holiday beside the standard hours, and every subject keeps its Monday", async () => {
    const f = await seville();
    const days = await withTransaction(db, (tx) =>
      readCalendarDays(tx, f.cfg, HOLIDAY, HOLIDAY, installedReadHolidayFacts),
    );
    expect(days).toEqual([
      {
        date: HOLIDAY,
        specialDate: null,
        holidays: [expect.objectContaining({ date: HOLIDAY, scope: "national" })],
        tone: "standard",
      },
    ]);
    for (const subject of [f.restaurant, f.bar, f.kitchen]) {
      const holiday = await dateSnapshot(f, subject, HOLIDAY);
      expect({ ...holiday, openingDate: ORDINARY }).toEqual(
        await dateSnapshot(f, subject, ORDINARY),
      );
    }
    expect(await schedule(f, ORDINARY, HOLIDAY)).toEqual({
      weekSet: true,
      hours: [{ weekday: 1, opensAt: "18:00", closesAt: "23:00" }],
      dates: new Map(),
    });
    expect(await storedDates(f)).toEqual([]);
  });

  it("changes a station's hours on the holiday only through a special date the venue saves", async () => {
    const f = await seville();
    const saved = await saveDate(
      f,
      null,
      specialInput({
        date: HOLIDAY,
        cells: [{ subject: f.bar, cell: { mode: "closed", periods: [] } }],
      }),
    );
    expect((await schedule(f, ORDINARY, HOLIDAY)).dates).toEqual(new Map([[HOLIDAY, []]]));
    expect(await dateSnapshot(f, f.bar, HOLIDAY)).toMatchObject({
      specialDateId: saved.id,
      closeWholeVenue: false,
      specialCell: { mode: "closed", periods: [] },
      state: { open: false, isDefault: false },
    });
    expect((await dateSnapshot(f, f.bar, ORDINARY)).specialCell).toBeUndefined();
  });
});

describe("named-day station occurrences", () => {
  async function namedDay(f: Fixture, overrides: Partial<typeof specialDates.$inferInsert> = {}) {
    return withTransaction(db, async (tx) => {
      const [row] = await tx
        .insert(specialDates)
        .values({
          locationId: f.cfg.locationId,
          date: "2026-12-25",
          name: "Navidad",

          repeatOn: "12-25",
          closeWholeVenue: true,
          ...overrides,
        })
        .returning();
      return row!;
    });
  }

  it("closes every station on each yearly occurrence, without closing adjacent dates or earlier years", async () => {
    const f = await fixture();
    await namedDay(f);
    await withTransaction(db, async (tx) => {
      const ids = [f.bar.id, f.restaurant.id, f.kitchen.id];
      const schedules = await readStationSchedules(tx, f.cfg, ids, {
        from: "2027-12-20",
        to: "2027-12-31",
      });
      for (const id of ids) expect(schedules.get(id)!.dates).toEqual(new Map([["2027-12-25", []]]));
      const earlier = await readStationSchedules(tx, f.cfg, ids, {
        from: "2025-12-20",
        to: "2025-12-31",
      });
      for (const id of ids) expect(earlier.get(id)!.dates).toEqual(new Map());
      const untimed = await readStationSchedules(tx, f.cfg, ids, null);
      for (const id of ids) expect(untimed.get(id)!.dates).toEqual(new Map());
    });
  });

  it("applies a repeating leap-day closure only in leap years and only at its venue", async () => {
    const f = await fixture();
    await namedDay(f, { date: "2024-02-29", repeatOn: "02-29" });
    const [otherStation] = await withTransaction(db, (tx) =>
      tx
        .select({ locationId: kitchenStations.locationId })
        .from(kitchenStations)
        .where(eq(kitchenStations.id, f.otherStation.id)),
    );
    await namedDay(f, { locationId: otherStation!.locationId, date: "2027-12-25" });
    await withTransaction(db, async (tx) => {
      expect(
        (
          await readStationSchedules(tx, f.cfg, [f.bar.id], {
            from: "2027-02-28",
            to: "2027-03-01",
          })
        ).get(f.bar.id)!.dates,
      ).toEqual(new Map());
      expect(
        (
          await readStationSchedules(tx, f.cfg, [f.bar.id], {
            from: "2028-02-28",
            to: "2028-03-01",
          })
        ).get(f.bar.id)!.dates,
      ).toEqual(new Map([["2028-02-29", []]]));
      expect(
        (
          await readStationSchedules(tx, f.cfg, [f.bar.id], {
            from: "2027-12-25",
            to: "2027-12-25",
          })
        ).get(f.bar.id)!.dates,
      ).toEqual(new Map());
    });
  });

  it("reports a future recurring venue closure even when its first date is before the requested range", async () => {
    const f = await fixture();
    await namedDay(f);
    const result = await withTransaction(db, (tx) =>
      stationsRestrictedFrom(tx, f.cfg, "2027-01-01"),
    );
    expect(result).toEqual({ wholeVenue: true, stationIds: new Set() });
  });

  it("does not report a repeating closure when no occurrence remains in the date range", async () => {
    const f = await fixture();
    await namedDay(f, { date: "2024-02-29", repeatOn: "02-29" });
    expect(
      await withTransaction(db, (tx) => stationsRestrictedFrom(tx, f.cfg, "9999-01-01")),
    ).toEqual({ wholeVenue: false, stationIds: new Set() });
  });

  it("does not report an expired one-off closure as a future restriction", async () => {
    const f = await fixture();
    await namedDay(f, { repeatOn: null });
    expect(
      await withTransaction(db, (tx) => stationsRestrictedFrom(tx, f.cfg, "2027-01-01")),
    ).toEqual({ wholeVenue: false, stationIds: new Set() });
    expect(await withTransaction(db, (tx) => stationsRestrictedFrom(tx, f.cfg, null))).toEqual({
      wholeVenue: true,
      stationIds: new Set(),
    });
  });

  it("lets dated late station hours reach a repeating closed neighbour", async () => {
    const f = await fixture();
    await save(f, f.bar, week({ 6: periods(period("01:00", "05:00")) }));
    await namedDay(f);
    const saved = await saveDate(
      f,
      null,
      specialInput({
        date: "2027-12-24",
        cells: [{ subject: f.bar, cell: { mode: "periods", periods: [period("22:00", "02:00")] } }],
      }),
    );
    expect((await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, saved.id))).cells).toEqual(
      [
        {
          subject: f.bar,
          cell: {
            mode: "periods",
            periods: [expect.objectContaining({ opensAt: "22:00", closesAt: "02:00" })],
          },
        },
      ],
    );
  });

  it("still refuses the neighbour clash before a repeating closure's first year", async () => {
    const f = await fixture();
    await save(f, f.bar, week({ 6: periods(period("01:00", "05:00")) }));
    await namedDay(f, { date: "2028-12-25" });
    await expect(
      saveDate(
        f,
        null,
        specialInput({
          date: "2027-12-24",
          cells: [
            { subject: f.bar, cell: { mode: "periods", periods: [period("22:00", "02:00")] } },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "cells.0.cell", date: "2027-12-25", subjectId: f.bar.id },
    });
  });
});

describe("named-day writes", () => {
  it.each([
    ["kind", null],
    ["kind", ["holiday"]],
    ["kind", "other"],
    ["repeats", null],
    ["repeats", 1],
    ["repeats", "false"],
    ["ownHours", null],
    ["ownHours", 0],
    ["ownHours", "true"],
    ["closeWholeVenue", null],
    ["closeWholeVenue", 1],
  ])("refuses invalid %s (%j) before storing anything", async (field, value) => {
    const f = await fixture();
    await expect(saveDate(f, null, { ...specialInput(), [field]: value })).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field },
    });
    expect(
      await db.select().from(specialDates).where(eq(specialDates.locationId, f.cfg.locationId)),
    ).toEqual([]);
  });

  it("stores a kind, yearly repeat key and own-hours choice", async () => {
    const f = await fixture();
    const saved = await saveDate(f, null, {
      ...specialInput({ date: "2026-12-25" }),
      kind: "holiday",
      repeats: true,
      ownHours: true,
    });
    const [row] = await db.select().from(specialDates).where(eq(specialDates.id, saved.id));
    expect(row).toMatchObject({
      date: "2026-12-25",
      kind: "holiday",
      repeatOn: "12-25",
      ownHours: true,
    });
  });

  it("defaults absent fields on create and retains stored values on update", async () => {
    const f = await fixture();
    const ordinary = await saveDate(f, null, specialInput());
    const [created] = await db.select().from(specialDates).where(eq(specialDates.id, ordinary.id));
    expect(created).toMatchObject({ kind: "working_day", repeatOn: null, ownHours: false });
    await saveDate(f, ordinary.id, {
      ...specialInput(),
      kind: "holiday",
      repeats: true,
      ownHours: true,
    });
    await saveDate(f, ordinary.id, specialInput({ date: "2026-10-10", name: "Renamed" }));
    const [updated] = await db.select().from(specialDates).where(eq(specialDates.id, ordinary.id));
    expect(updated).toMatchObject({
      name: "Renamed",
      kind: "holiday",
      repeatOn: "10-10",
      ownHours: true,
    });
    await saveDate(f, ordinary.id, {
      ...specialInput({ date: "2026-10-10" }),
      kind: "working_day",
      repeats: false,
      ownHours: false,
    });
    const [reset] = await db.select().from(specialDates).where(eq(specialDates.id, ordinary.id));
    expect(reset).toMatchObject({ kind: "working_day", repeatOn: null, ownHours: false });
  });

  it("refuses own hours alongside whole-venue closure", async () => {
    const f = await fixture();
    await expect(
      saveDate(f, null, { ...specialInput({ closeWholeVenue: true }), ownHours: true }),
    ).rejects.toMatchObject({ code: "hours.invalid", params: { field: "ownHours" } });
  });

  it("refuses repeating days with newly supplied station cells", async () => {
    const f = await fixture();
    await expect(
      saveDate(f, null, {
        ...specialInput({ cells: [{ subject: f.bar, cell: { mode: "closed", periods: [] } }] }),
        repeats: true,
      }),
    ).rejects.toMatchObject({ code: "hours.invalid", params: { field: "repeats" } });
  });

  it("refuses making a day repeat while it retains a default station's dormant cell", async () => {
    const f = await fixture();
    const source = await saveDate(
      f,
      null,
      specialInput({ cells: [{ subject: f.bar, cell: { mode: "closed", periods: [] } }] }),
    );
    await withTransaction(db, async (tx) => {
      await tx
        .update(kitchenStations)
        .set({ isDefault: false })
        .where(eq(kitchenStations.id, f.kitchen.id));
      await tx
        .update(kitchenStations)
        .set({ isDefault: true })
        .where(eq(kitchenStations.id, f.bar.id));
    });
    await expect(
      saveDate(f, source.id, { ...specialInput(), repeats: true }),
    ).rejects.toMatchObject({ code: "hours.invalid", params: { field: "repeats" } });
  });

  it.each([
    ["2026-12-25", true, "2027-12-25", false, "2027-12-25"],
    ["2027-12-25", false, "2026-12-25", true, "2027-12-25"],
    ["2026-12-25", true, "2028-12-25", true, "2028-12-25"],
    ["2028-02-29", true, "2032-02-29", false, "2032-02-29"],
  ])(
    "refuses intersecting occurrences %s/%s and %s/%s",
    async (firstDate, firstRepeats, date, repeats, clash) => {
      const f = await fixture();
      await saveDate(f, null, { ...specialInput({ date: firstDate }), repeats: firstRepeats });
      await expect(saveDate(f, null, { ...specialInput({ date }), repeats })).rejects.toMatchObject(
        { code: "special_date.date_taken", params: { date: clash } },
      );
      expect(
        await db.select().from(specialDates).where(eq(specialDates.locationId, f.cfg.locationId)),
      ).toHaveLength(1);
    },
  );

  it("allows a one-off before a repeat starts and a matching date in another venue", async () => {
    const f = await fixture();
    const other = await fixture();
    await saveDate(f, null, { ...specialInput({ date: "2028-12-25" }), repeats: true });
    const earlier = await saveDate(f, null, specialInput({ date: "2027-12-25" }));
    const elsewhere = await saveDate(other, null, {
      ...specialInput({ date: "2028-12-25" }),
      repeats: true,
    });
    expect(earlier.date).toBe("2027-12-25");
    expect(elsewhere.date).toBe("2028-12-25");
  });

  it("ignores the edited row itself but refuses moving its repeat onto another day", async () => {
    const f = await fixture();
    const source = await saveDate(f, null, {
      ...specialInput({ date: "2026-12-25" }),
      repeats: true,
    });
    const edited = await saveDate(
      f,
      source.id,
      specialInput({ date: "2026-12-25", name: "New name" }),
    );
    expect(edited.id).toBe(source.id);
    await saveDate(f, null, specialInput({ date: "2027-12-26" }));
    await expect(
      saveDate(f, source.id, specialInput({ date: "2026-12-26" })),
    ).rejects.toMatchObject({ code: "special_date.date_taken", params: { date: "2027-12-26" } });
    const [row] = await db.select().from(specialDates).where(eq(specialDates.id, source.id));
    expect(row).toMatchObject({ date: "2026-12-25", repeatOn: "12-25", name: "New name" });
  });

  it("copies a repeat as a one-off, retaining kind and own hours", async () => {
    const f = await fixture();
    const source = await saveDate(f, null, {
      ...specialInput({ date: "2026-12-25" }),
      kind: "holiday",
      repeats: true,
      ownHours: true,
    });
    const [copy] = await withTransaction(db, (tx) =>
      duplicateSpecialDate(tx, f.cfg, source.id, ["2027-12-26"], AT),
    );
    const [row] = await db.select().from(specialDates).where(eq(specialDates.id, copy!.id));
    expect(row).toMatchObject({
      date: "2027-12-26",
      kind: "holiday",
      repeatOn: null,
      ownHours: true,
      closeWholeVenue: false,
    });
    const [original] = await db.select().from(specialDates).where(eq(specialDates.id, source.id));
    expect(original).toMatchObject({ repeatOn: "12-25" });
  });

  it("refuses copying onto a recurring day and rolls back the whole batch", async () => {
    const f = await fixture();
    const source = await saveDate(f, null, specialInput({ date: "2026-12-24" }));
    await saveDate(f, null, { ...specialInput({ date: "2026-12-25" }), repeats: true });
    await expect(
      withTransaction(db, (tx) =>
        duplicateSpecialDate(tx, f.cfg, source.id, ["2027-12-24", "2027-12-25"], AT),
      ),
    ).rejects.toMatchObject({ code: "special_date.date_taken", params: { date: "2027-12-25" } });
    expect(
      (await db.select().from(specialDates).where(eq(specialDates.locationId, f.cfg.locationId)))
        .map((row) => row.date)
        .sort(),
    ).toEqual(["2026-12-24", "2026-12-25"]);
  });
});

describe("named-day response and colour", () => {
  it("returns the named-day kind without a stored colour", async () => {
    const f = await fixture();
    const saved = await saveDate(f, null, {
      date: "2026-12-25",
      name: "Christmas",
      kind: "holiday",
      repeats: true,
      ownHours: true,
      closeWholeVenue: false,
      cells: [],
    });
    expect(saved).toEqual({
      id: expect.any(String),
      date: "2026-12-25",
      name: "Christmas",
      kind: "holiday",
      repeats: true,
      ownHours: true,
      closeWholeVenue: false,
    });
    expect(saved).not.toHaveProperty("colour");
    const edited = await saveDate(f, saved.id, {
      ...specialInput({ date: "2026-12-25" }),
      kind: "working_day",
    });
    expect(edited).toMatchObject({
      kind: "working_day",
      repeats: true,
      ownHours: true,
    });
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, saved.id))).toEqual({
      ...edited,
      cells: [],
    });
    expect(
      await withTransaction(db, (tx) => renameSpecialDate(tx, f.cfg, saved.id, "Dinner")),
    ).toEqual({ ...edited, name: "Dinner" });
  });
});

describe("named-day own-hours switching", () => {
  async function setup() {
    const f = await fixture();
    const other = await fixture();
    const seeded = await withTransaction(db, async (tx) => {
      const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
      const lunch = await saveMenuPeriod(tx, f.cfg, f.departmentIds.restaurant, {
        name: "Lunch",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      for (const [cfg, departmentId, periodId] of [
        [f.cfg, f.departmentIds.restaurant, lunch.id],
        [
          other.cfg,
          other.departmentIds.restaurant,
          (
            await saveMenuPeriod(tx, other.cfg, other.departmentIds.restaurant, {
              name: "Other lunch",
              menuId: menu!.id,
              staffMenuIds: [],
            })
          ).id,
        ],
      ] as const) {
        await replaceMenuWeek(
          tx,
          cfg,
          departmentId,
          [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            slots: weekday === 5 ? [{ periodId, startsAt: "12:00", endsAt: "15:00" }] : [],
          })),
          AT,
        );
        const [zone] = await tx
          .insert(floorZones)
          .values({ locationId: cfg.locationId, name: "Terrace" })
          .returning();
        await tx
          .insert(zoneServicePolicies)
          .values({ locationId: cfg.locationId, zoneId: zone!.id, departmentId });
        await tx.insert(zoneClosedTimes).values([
          { zoneId: zone!.id, weekday: 5, startsAt: "13:00:00", endsAt: "14:00:00" },
          { zoneId: zone!.id, weekday: 1, startsAt: "10:00:00", endsAt: "11:00:00" },
        ]);
      }
      return { lunch };
    });
    return { f, other, ...seeded };
  }

  async function snapshot(id: string) {
    return withTransaction(db, async (tx) => {
      const days = await tx
        .select()
        .from(menuDayTimetables)
        .where(eq(menuDayTimetables.specialDateId, id));
      const slots =
        days.length === 0
          ? []
          : await tx
              .select()
              .from(menuSlots)
              .where(
                inArray(
                  menuSlots.timetableId,
                  days.map((d) => d.id),
                ),
              );
      const closures = await tx
        .select()
        .from(zoneClosedTimes)
        .where(eq(zoneClosedTimes.specialDateId, id));
      return { days, slots, closures };
    });
  }

  it("copies only the stored weekday and location when own hours are enabled", async () => {
    const { f, lunch } = await setup();
    const day = await saveDate(f, null, specialInput({ ownHours: true }));
    const rows = await snapshot(day.id);
    expect(rows.days.map((d) => [d.departmentId, d.weekday, d.specialDateId])).toEqual([
      [f.departmentIds.restaurant, null, day.id],
    ]);
    expect(rows.slots.map((s) => [s.departmentId, s.periodId, s.startsAt, s.endsAt])).toEqual([
      [f.departmentIds.restaurant, lunch.id, "12:00:00", "15:00:00"],
    ]);
    expect(rows.closures.map((c) => [c.weekday, c.specialDateId, c.startsAt, c.endsAt])).toEqual([
      [null, day.id, "13:00:00", "14:00:00"],
    ]);
    const [policy] = await db
      .select()
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, rows.closures[0]!.zoneId));
    expect(policy!.locationId).toBe(f.cfg.locationId);
  });

  it("copies on an off-to-on update and leaves the standard week intact", async () => {
    const { f } = await setup();
    const day = await saveDate(f, null, specialInput());
    expect(await snapshot(day.id)).toEqual({ days: [], slots: [], closures: [] });
    const before = await db.select().from(menuSlots);
    await saveDate(f, day.id, specialInput({ ownHours: true }));
    expect((await snapshot(day.id)).slots).toHaveLength(1);
    expect(
      (await db.select().from(menuSlots)).filter((s) => before.some((b) => b.id === s.id)),
    ).toEqual(before);
  });

  it("removes all dated department and zone rows when own hours are disabled", async () => {
    const { f } = await setup();
    const day = await saveDate(f, null, specialInput({ ownHours: true }));
    await withTransaction(db, async (tx) => {
      await saveSpecialDateMenus(tx, f.cfg, day.id, f.departmentIds.deli, [], AT);
      const [zone] = await tx
        .select()
        .from(zoneServicePolicies)
        .where(eq(zoneServicePolicies.locationId, f.cfg.locationId));
      await tx.insert(zoneClosedTimes).values({
        zoneId: zone!.zoneId,
        specialDateId: day.id,
        startsAt: "15:00:00",
        endsAt: "16:00:00",
      });
    });
    const before = await snapshot(day.id);
    expect(before.days).toHaveLength(2);
    expect(before.slots).toHaveLength(1);
    expect(before.closures).toHaveLength(2);
    await saveDate(f, day.id, specialInput({ ownHours: false }));
    expect(await snapshot(day.id)).toEqual({ days: [], slots: [], closures: [] });
    expect(
      await db
        .select()
        .from(zoneClosedTimes)
        .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, zoneClosedTimes.zoneId))
        .where(
          and(eq(zoneClosedTimes.weekday, 5), eq(zoneServicePolicies.locationId, f.cfg.locationId)),
        ),
    ).toHaveLength(1);
  });

  it("keeps dated edits and row identities when own hours remain on", async () => {
    const { f, lunch } = await setup();
    const day = await saveDate(f, null, specialInput({ ownHours: true }));
    await withTransaction(db, (tx) =>
      saveSpecialDateMenus(
        tx,
        f.cfg,
        day.id,
        f.departmentIds.restaurant,
        [{ periodId: lunch.id, startsAt: "16:00", endsAt: "18:00" }],
        AT,
      ),
    );
    const before = await snapshot(day.id);
    await saveDate(f, day.id, specialInput({ ownHours: true, name: "Renamed" }));
    expect(await snapshot(day.id)).toEqual(before);
  });

  it("rolls back copied rows and the flag when a participant refuses the save", async () => {
    const { f } = await setup();
    const day = await saveDate(f, null, specialInput());
    await expect(
      withTransaction(db, (tx) =>
        saveSpecialDate(tx, f.cfg, day.id, specialInput({ ownHours: true }), AT, [
          {
            async copy() {},
            async beforeDelete() {},
            async afterChange(tx) {
              const rows = await tx
                .select()
                .from(menuDayTimetables)
                .where(eq(menuDayTimetables.specialDateId, day.id));
              expect(rows).toHaveLength(1);
              throw new Error("participant refusal");
            },
          },
        ]),
      ),
    ).rejects.toThrow("participant refusal");
    expect(await snapshot(day.id)).toEqual({ days: [], slots: [], closures: [] });
    expect((await readSpecialDateAt(f, day.id)).ownHours).toBe(false);
  });

  async function readSpecialDateAt(f: Fixture, id: string) {
    return withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, id));
  }
});
