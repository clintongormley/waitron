import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
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
  readSpecialDate,
  readWeekHours,
  replaceWeekHours,
  saveSpecialDate,
} from "./hours.js";
import {
  WEEK_DISPLAY_ORDER,
  type HourPeriod,
  type HoursSubject,
  type SpecialDateInput,
  type WeekCell,
  type WeekDay,
} from "./hours-types.js";
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
