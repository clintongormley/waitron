import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  locations,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import {
  cellIntervals,
  deleteSpecialDate,
  duplicateSpecialDate,
  readCalendarDays,
  readSpecialDate,
  readWeekHours,
  replaceWeekHours,
  resolveOpeningDateHours,
  saveSpecialDate,
  type SpecialDateParticipant,
} from "./hours.js";
import {
  WEEK_DISPLAY_ORDER,
  type DateHoursCell,
  type HourPeriod,
  type HoursSubject,
  type LocalDate,
  type SpecialDateInput,
  type WeekCell,
  type WeekDay,
} from "./hours-types.js";
import { VENUE_SERVICE_CALENDAR_PARTICIPANTS } from "./calendar-participants.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import type { VenueScope } from "./operations.js";
import {
  hoursWeekCells,
  hoursWeekPeriods,
  specialDateHours,
  specialDateHoursPeriods,
  specialDates,
} from "./schema/hours.js";
import { departments } from "./schema/service.js";
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
      defaultServiceMode: "table_tab",
      isDefault,
    });
    const [restaurant, deli, otherDepartment] = await tx
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
    return {
      cfg,
      restaurant: { kind: "department", id: restaurant!.id },
      deli: { kind: "department", id: deli!.id },
      bar: { kind: "station", id: bar!.id },
      kitchen: { kind: "station", id: kitchen!.id },
      otherDepartment: { kind: "department", id: otherDepartment!.id },
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
    const owner =
      subject.kind === "department"
        ? eq(hoursWeekCells.departmentId, subject.id)
        : eq(hoursWeekCells.stationId, subject.id);
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
  colour: "amber",
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
    [
      "another venue's department",
      (f) => ({ subject: f.otherDepartment, days: week() }),
      "subject",
    ],
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
      id: expect.any(String),
      date: "2026-10-09",
      name: "Harvest festival",
      colour: "amber",
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
        colour: "purple",
        closeWholeVenue: true,
        cells: [{ subject: f.deli, cell: { mode: "inherit", periods: [] } }],
      }),
    );
    expect(edited).toEqual({
      id: first.id,
      date: "2026-10-12",
      name: "Founders' day",
      colour: "purple",
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
    ["a colour outside the palette", () => specialInput({ colour: "pink" as never }), "colour"],
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
      id: saved.id,
      date: "2026-10-09",
      name: "Harvest festival",
      colour: "amber",
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

const resolve = (f: Fixture, subject: HoursSubject, date: LocalDate) =>
  withTransaction(db, (tx) => resolveOpeningDateHours(tx, f.cfg, subject, date));

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

const setDepartmentActive = (department: HoursSubject, active: boolean) =>
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
        defaultServiceMode: "table_tab",
      })
      .returning();
    const [grill] = await tx
      .insert(kitchenStations)
      .values({ locationId: f.cfg.locationId, name: `Grill ${randomUUID()}` })
      .returning();
    return {
      terrace: { kind: "department", id: terrace!.id } as HoursSubject,
      grill: { kind: "station", id: grill!.id } as HoursSubject,
    };
  });
}

describe("one subject's hours on one opening date", () => {
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

    expect(await resolve(f, f.restaurant, "2026-10-12")).toEqual({
      subject: f.restaurant,
      openingDate: "2026-10-12",
      specialDateId: monday.id,
      source: "standard",
      cell: { mode: "periods", periods: [restaurantMonday] },
    });
    expect(await resolve(f, f.deli, "2026-10-12")).toEqual({
      subject: f.deli,
      openingDate: "2026-10-12",
      specialDateId: monday.id,
      source: "special",
      cell: { mode: "closed", periods: [] },
    });
    expect(await resolve(f, f.bar, "2026-10-12")).toEqual({
      subject: f.bar,
      openingDate: "2026-10-12",
      specialDateId: monday.id,
      source: "special",
      cell: { mode: "periods", periods: [lunch] },
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
    expect(await resolve(f, f.deli, "2026-10-19")).toEqual({
      subject: f.deli,
      openingDate: "2026-10-19",
      specialDateId: null,
      source: "standard",
      cell: { mode: "periods", periods: [deliMonday] },
    });
    expect((await resolve(f, f.bar, "2026-10-19")).cell).toEqual({ mode: "not_set", periods: [] });
    expect(await resolve(f, f.kitchen, "2026-10-19")).toEqual({
      subject: f.kitchen,
      openingDate: "2026-10-19",
      specialDateId: null,
      source: "default_station",
      cell: { mode: "always_open", periods: [] },
    });
  });

  it("keeps a date's id and its cells when its name, colour and date change", async () => {
    const f = await fixture();
    const closedDeli: DateHoursCell = { subject: f.deli, cell: { mode: "closed", periods: [] } };
    const first = await saveDate(f, null, specialInput({ cells: [closedDeli] }));
    const moved = await saveDate(
      f,
      first.id,
      specialInput({ date: "2026-10-13", name: "Moved", colour: "blue", cells: [closedDeli] }),
    );
    expect(moved.id).toBe(first.id);
    expect(await resolve(f, f.deli, "2026-10-13")).toMatchObject({
      specialDateId: first.id,
      source: "special",
      cell: { mode: "closed", periods: [] },
    });
    expect(await resolve(f, f.deli, "2026-10-09")).toMatchObject({
      specialDateId: null,
      source: "standard",
    });
  });

  it("refuses a subject from another venue, and a date that does not exist", async () => {
    const f = await fixture();
    await expect(resolve(f, f.otherDepartment, "2026-10-12")).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "subject" },
    });
    await expect(resolve(f, f.deli, "2026-02-30")).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "openingDate" },
    });
    await expect(tone(f, "2026-02-30")).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "from" },
    });
  });
});

describe("closing the whole venue on a date", () => {
  it("closes every department and non-default station, new ones included, and keeps the default open", async () => {
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
      expect(await resolve(f, subject, "2026-10-09")).toEqual({
        subject,
        openingDate: "2026-10-09",
        specialDateId: friday.id,
        source: "whole_venue",
        cell: { mode: "closed", periods: [] },
      });
    expect(await resolve(f, f.kitchen, "2026-10-09")).toEqual({
      subject: f.kitchen,
      openingDate: "2026-10-09",
      specialDateId: friday.id,
      source: "default_station",
      cell: { mode: "always_open", periods: [] },
    });

    // The cells the closure hides are kept, and reopening the date shows them again.
    const kept = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, friday.id));
    expect(kept.cells).toEqual([...cells].sort((a, b) => (a.subject.id < b.subject.id ? -1 : 1)));
    await saveDate(f, friday.id, specialInput({ closeWholeVenue: false, cells: kept.cells }));
    expect(await resolve(f, f.deli, "2026-10-09")).toMatchObject({
      source: "special",
      cell: { mode: "periods", periods: [evening] },
    });
    expect(await resolve(f, f.bar, "2026-10-09")).toMatchObject({
      source: "special",
      cell: { mode: "all_day", periods: [] },
    });
    expect(await resolve(f, added.terrace, "2026-10-09")).toMatchObject({
      source: "standard",
      cell: { mode: "not_set", periods: [] },
    });
  });
});

describe("the calendar's Closed colour", () => {
  it("is Closed only when every active department is Closed, whatever the stations do", async () => {
    const f = await fixture();
    await save(f, f.restaurant, week({ 1: periods(period("09:00", "17:00")) }));

    // Monday 19 October: the restaurant is open and the deli has no hours.
    expect(await tone(f, "2026-10-19")).toBe("standard");
    // Tuesday 20 October: the restaurant is Closed, but no hours set is not Closed.
    expect(await tone(f, "2026-10-20")).toBe("standard");

    const closedDeli: DateHoursCell = { subject: f.deli, cell: { mode: "closed", periods: [] } };
    // Wednesday 21 October: both departments Closed (the restaurant by its week), the bar open.
    await saveDate(
      f,
      null,
      specialInput({
        date: "2026-10-21",
        colour: "green",
        cells: [closedDeli, { subject: f.bar, cell: { mode: "all_day", periods: [] } }],
      }),
    );
    expect(await tone(f, "2026-10-21")).toBe("closed");
    // Thursday 22 October: only the restaurant is Closed, so the date keeps its own colour.
    await saveDate(
      f,
      null,
      specialInput({
        date: "2026-10-22",
        colour: "purple",
        cells: [
          { subject: f.deli, cell: { mode: "periods", periods: [period("10:00", "14:00")] } },
        ],
      }),
    );
    expect(await tone(f, "2026-10-22")).toBe("purple");
    // Friday 23 October: every station Closed and the deli open.
    await save(f, f.bar, week());
    await saveDate(
      f,
      null,
      specialInput({
        date: "2026-10-23",
        colour: "red",
        cells: [{ subject: f.deli, cell: { mode: "all_day", periods: [] } }],
      }),
    );
    expect(await tone(f, "2026-10-23")).toBe("red");

    // A new department with no hours stops Wednesday being Closed until it is switched off.
    const { terrace } = await addSubjects(f);
    expect(await tone(f, "2026-10-21")).toBe("green");
    await setDepartmentActive(terrace, false);
    expect(await tone(f, "2026-10-21")).toBe("closed");

    await saveDate(
      f,
      null,
      specialInput({ date: "2026-10-26", colour: "blue", closeWholeVenue: true }),
    );
    expect(await tone(f, "2026-10-26")).toBe("closed");

    // An ordinary date is Closed once every active department's week is Closed that day.
    await save(f, f.deli, week());
    expect(await tone(f, "2026-10-20")).toBe("closed");
  });
});

describe("duplicating a special date", () => {
  it("copies the name, colour and every cell to each target under new ids, an inactive department's included", async () => {
    const f = await fixture();
    const lunch = period("12:00", "15:00");
    const dinner = period("19:00", "23:00");
    const source = await saveDate(
      f,
      null,
      specialInput({
        colour: "purple",
        cells: [
          { subject: f.restaurant, cell: { mode: "periods", periods: [lunch, dinner] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
          { subject: f.bar, cell: { mode: "all_day", periods: [] } },
        ],
      }),
    );
    await setDepartmentActive(f.deli, false);
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
      expect(rows.cells.some((cell) => cell.departmentId === f.deli.id)).toBe(true);
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
    expect(await resolve(f, f.bar, "2026-10-16")).toMatchObject({ source: "whole_venue" });
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
    expect(await resolve(f, f.restaurant, "2026-10-18")).toEqual({
      subject: f.restaurant,
      openingDate: "2026-10-18",
      specialDateId: copy!.id,
      source: "standard",
      cell: { mode: "periods", periods: [sunday] },
    });
    expect((await dateRows(copy!.id)).cells.map((cell) => cell.departmentId)).toEqual([f.deli.id]);
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
      "a copied cell for a station that has since become the default",
      async (f) => {
        const source = await saveDate(
          f,
          null,
          specialInput({ cells: [{ subject: f.bar, cell: { mode: "closed", periods: [] } }] }),
        );
        await makeDefault(f, f.bar);
        return { sourceId: source.id, dates: ["2026-10-20", "2026-10-21"] };
      },
      { code: "station.always_open", params: { stationId: "bar" } },
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
    expect(await resolve(f, f.restaurant, "2026-10-09")).toEqual({
      subject: f.restaurant,
      openingDate: "2026-10-09",
      specialDateId: null,
      source: "standard",
      cell: { mode: "periods", periods: [friday] },
    });
    expect((await resolve(f, f.bar, "2026-10-09")).cell).toEqual({ mode: "not_set", periods: [] });
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
  it("has none of its own in step 5", () => {
    expect(VENUE_SERVICE_CALENDAR_PARTICIPANTS).toEqual([]);
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
