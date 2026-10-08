import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, kitchenStations, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import {
  readHoursModel,
  readSpecialDate,
  readWeekHours,
  duplicateSpecialDate,
  replaceWeekHours,
  saveSpecialDate,
} from "./hours.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
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
const at = new Date("2026-10-06T10:00:00Z");

async function fixture() {
  return withTransaction(suite.db, async (tx) => {
    const [venue, other] = await tx
      .insert(locations)
      .values(
        ["Venue", "Other"].map((name) => ({
          name: `${name} ${randomUUID()}`,
          invoiceLocales: ["en-GB"],
          operationDescription: "Hospitality",
          timeZone: "Europe/Madrid",
          dayCutover: "04:30:00",
        })),
      )
      .returning();
    const cfg = { locationId: locationId(venue!.id) };
    const [department] = await tx
      .insert(departments)
      .values({
        locationId: cfg.locationId,
        name: "Dining",
        tradingName: "Dining",
        defaultServiceMode: "table_tab",
        isDefault: true,
      })
      .returning();
    const [special] = await tx
      .insert(specialDates)
      .values({
        locationId: cfg.locationId,
        date: "2026-10-09",
        name: "Festival",
        colour: "green",
        closeWholeVenue: false,
      })
      .returning();
    return { cfg, other: other!.id, department: department!.id, special: special!.id };
  });
}

describe("station-only Hours page model", () => {
  it("keeps station ordering, inactive stations and exact periods while ignoring retained department and foreign-station cells", async () => {
    const f = await fixture();
    const ids = await withTransaction(suite.db, async (tx) => {
      const [bar, prep, kitchen, foreign] = await tx
        .insert(kitchenStations)
        .values([
          { locationId: f.cfg.locationId, name: "Bar", displayOrder: 2 },
          { locationId: f.cfg.locationId, name: "Prep", displayOrder: 1, active: false },
          { locationId: f.cfg.locationId, name: "Kitchen", displayOrder: 0, isDefault: true },
          { locationId: f.other, name: "Elsewhere" },
        ])
        .returning();
      const [legacyWeek, stationWeek, foreignWeek] = await tx
        .insert(hoursWeekCells)
        .values([
          { departmentId: f.department, weekday: 5, mode: "periods" as const },
          { stationId: bar!.id, weekday: 5, mode: "periods" as const },
          { stationId: foreign!.id, weekday: 5, mode: "periods" as const },
        ])
        .returning();
      const weekPeriod = randomUUID();
      await tx.insert(hoursWeekPeriods).values([
        {
          id: randomUUID(),
          cellId: legacyWeek!.id,
          position: 0,
          opensAt: "01:00:00",
          closesAt: "02:00:00",
        },
        {
          id: weekPeriod,
          cellId: stationWeek!.id,
          position: 0,
          opensAt: "09:00:00",
          closesAt: "17:00:00",
        },
        {
          id: randomUUID(),
          cellId: foreignWeek!.id,
          position: 0,
          opensAt: "03:00:00",
          closesAt: "04:00:00",
        },
      ]);
      const [legacyDate, stationDate, foreignDate] = await tx
        .insert(specialDateHours)
        .values([
          { specialDateId: f.special, departmentId: f.department, mode: "periods" as const },
          { specialDateId: f.special, stationId: bar!.id, mode: "periods" as const },
          { specialDateId: f.special, stationId: foreign!.id, mode: "periods" as const },
        ])
        .returning();
      const datePeriod = randomUUID();
      await tx.insert(specialDateHoursPeriods).values([
        {
          id: randomUUID(),
          cellId: legacyDate!.id,
          position: 0,
          opensAt: "01:00:00",
          closesAt: "02:00:00",
        },
        {
          id: datePeriod,
          cellId: stationDate!.id,
          position: 0,
          opensAt: "10:00:00",
          closesAt: "14:00:00",
        },
        {
          id: randomUUID(),
          cellId: foreignDate!.id,
          position: 0,
          opensAt: "03:00:00",
          closesAt: "04:00:00",
        },
      ]);
      return { bar: bar!.id, prep: prep!.id, kitchen: kitchen!.id, weekPeriod, datePeriod };
    });
    const model = await withTransaction(suite.db, (tx) =>
      readHoursModel(tx, f.cfg, "2026-10-09", "2026-10-09", at),
    );
    expect(model.subjects).toEqual([
      { kind: "station", id: ids.kitchen, name: "Kitchen", active: true, isDefault: true },
      { kind: "station", id: ids.prep, name: "Prep", active: false, isDefault: false },
      { kind: "station", id: ids.bar, name: "Bar", active: true, isDefault: false },
    ]);
    expect(model.week).toEqual(
      [ids.kitchen, ids.prep, ids.bar].map((id) => ({
        subject: { kind: "station", id },
        days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          cell:
            id === ids.bar && weekday === 5
              ? {
                  mode: "periods",
                  periods: [{ id: ids.weekPeriod, opensAt: "09:00", closesAt: "17:00" }],
                }
              : { mode: "not_set", periods: [] },
        })),
      })),
    );
    expect(model.specialCells).toEqual([
      {
        specialDateId: f.special,
        cells: [
          {
            subject: { kind: "station", id: ids.bar },
            cell: {
              mode: "periods",
              periods: [{ id: ids.datePeriod, opensAt: "10:00", closesAt: "14:00" }],
            },
          },
        ],
      },
    ]);
    expect(model.specialDates).toEqual([
      {
        id: f.special,
        date: "2026-10-09",
        name: "Festival",
        colour: "green",
        closeWholeVenue: false,
      },
    ]);
    expect([model.timeZone, model.dayCutover, model.civilDate, model.clockReadable]).toEqual([
      "Europe/Madrid",
      "04:30",
      "2026-10-06",
      true,
    ]);
  });

  it("keeps named dates but offers no hours subjects when the venue has no stations", async () => {
    const f = await fixture();
    await withTransaction(suite.db, (tx) =>
      tx
        .insert(specialDateHours)
        .values({ specialDateId: f.special, departmentId: f.department, mode: "closed" }),
    );
    const model = await withTransaction(suite.db, (tx) =>
      readHoursModel(tx, f.cfg, "2026-10-09", "2026-10-09", at),
    );
    expect(model.subjects).toEqual([]);
    expect(model.week).toEqual([]);
    expect(model.specialCells).toEqual([{ specialDateId: f.special, cells: [] }]);
    expect(model.days).toEqual([
      {
        date: "2026-10-09",
        specialDate: {
          id: f.special,
          date: "2026-10-09",
          name: "Festival",
          colour: "green",
          closeWholeVenue: false,
        },
        holidays: [],
        tone: "closed",
      },
    ]);
  });
});

describe("station-only Hours writers", () => {
  it("refuses department weeks at subject.kind without storing hours", async () => {
    const f = await fixture();
    await expect(
      withTransaction(suite.db, (tx) =>
        replaceWeekHours(
          tx,
          f.cfg,
          { kind: "department" as never, id: f.department },
          [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            cell: { mode: "closed", periods: [] },
          })),
          at,
        ),
      ),
    ).rejects.toMatchObject({ code: "hours.invalid", params: { field: "subject.kind" } });
    expect(
      await suite.db
        .select()
        .from(hoursWeekCells)
        .where(eq(hoursWeekCells.departmentId, f.department)),
    ).toEqual([]);
  });

  it("refuses department special-date cells before changing the named date", async () => {
    const f = await fixture();
    await expect(
      withTransaction(suite.db, (tx) =>
        saveSpecialDate(
          tx,
          f.cfg,
          f.special,
          {
            date: "2026-10-09",
            name: "Changed",
            colour: "red",
            closeWholeVenue: false,
            cells: [
              {
                subject: { kind: "department" as never, id: f.department },
                cell: { mode: "closed", periods: [] },
              },
            ],
          },
          at,
        ),
      ),
    ).rejects.toMatchObject({ code: "hours.invalid", params: { field: "cells.0.subject.kind" } });
    const saved = await suite.db.select().from(specialDates);
    expect(saved.find((row) => row.id === f.special)).toMatchObject({
      name: "Festival",
      colour: "green",
    });
  });
});

describe("station-only Hours readers", () => {
  it("refuses a department week read at subject.kind", async () => {
    const f = await fixture();
    await expect(
      withTransaction(suite.db, (tx) =>
        readWeekHours(tx, f.cfg, { kind: "department" as never, id: f.department }),
      ),
    ).rejects.toMatchObject({ code: "hours.invalid", params: { field: "subject.kind" } });
  });

  it("reads and duplicates station cells without copying retained department hours", async () => {
    const f = await fixture();
    const station = await withTransaction(suite.db, async (tx) => {
      const [station] = await tx
        .insert(kitchenStations)
        .values({ locationId: f.cfg.locationId, name: "Pass" })
        .returning();
      await tx.insert(specialDateHours).values([
        { specialDateId: f.special, departmentId: f.department, mode: "closed" },
        { specialDateId: f.special, stationId: station!.id, mode: "all_day" },
      ]);
      return station!.id;
    });
    const read = await withTransaction(suite.db, (tx) => readSpecialDate(tx, f.cfg, f.special));
    expect(read.cells).toEqual([
      { subject: { kind: "station", id: station }, cell: { mode: "all_day", periods: [] } },
    ]);
    const [copy] = await withTransaction(suite.db, (tx) =>
      duplicateSpecialDate(tx, f.cfg, f.special, ["2026-10-16"], at),
    );
    const copied = await withTransaction(suite.db, (tx) => readSpecialDate(tx, f.cfg, copy!.id));
    expect(copied.cells).toEqual([
      { subject: { kind: "station", id: station }, cell: { mode: "all_day", periods: [] } },
    ]);
    expect(
      await suite.db
        .select()
        .from(specialDateHours)
        .where(eq(specialDateHours.specialDateId, copy!.id)),
    ).toEqual([
      expect.objectContaining({ departmentId: null, stationId: station, mode: "all_day" }),
    ]);
  });
});

it("ignores retained department clashes when editing a station-hours named date", async () => {
  const f = await fixture();
  await withTransaction(suite.db, async (tx) => {
    const [legacyWeek] = await tx
      .insert(hoursWeekCells)
      .values({ departmentId: f.department, weekday: 5, mode: "periods" })
      .returning();
    await tx.insert(hoursWeekPeriods).values({
      id: randomUUID(),
      cellId: legacyWeek!.id,
      position: 0,
      opensAt: "22:00",
      closesAt: "03:00",
    });
    const [next] = await tx
      .insert(specialDates)
      .values({
        locationId: f.cfg.locationId,
        date: "2026-10-10",
        name: "Legacy",
        colour: "blue",
        closeWholeVenue: false,
      })
      .returning();
    const [legacyDate] = await tx
      .insert(specialDateHours)
      .values({ specialDateId: next!.id, departmentId: f.department, mode: "periods" })
      .returning();
    await tx.insert(specialDateHoursPeriods).values({
      id: randomUUID(),
      cellId: legacyDate!.id,
      position: 0,
      opensAt: "01:00",
      closesAt: "02:00",
    });
  });
  const saved = await withTransaction(suite.db, (tx) =>
    saveSpecialDate(
      tx,
      f.cfg,
      f.special,
      {
        date: "2026-10-09",
        name: "Renamed",
        colour: "purple",
        closeWholeVenue: false,
        cells: [],
      },
      at,
    ),
  );
  expect(saved).toEqual({
    id: f.special,
    date: "2026-10-09",
    name: "Renamed",
    colour: "purple",
    closeWholeVenue: false,
  });
  const read = await withTransaction(suite.db, (tx) => readSpecialDate(tx, f.cfg, f.special));
  expect(read.cells).toEqual([]);
});

it("keeps local department names for timetable refusals outside the editable station columns", async () => {
  const f = await fixture();
  const inactive = await withTransaction(suite.db, async (tx) => {
    const [row] = await tx
      .insert(departments)
      .values({
        locationId: f.cfg.locationId,
        name: "Closed dining",
        tradingName: "Closed dining",
        defaultServiceMode: "table_tab",
        active: false,
      })
      .returning();
    await tx.insert(departments).values({
      locationId: f.other,
      name: "Foreign dining",
      tradingName: "Foreign dining",
      defaultServiceMode: "table_tab",
    });
    return row!.id;
  });
  const model = await withTransaction(suite.db, (tx) =>
    readHoursModel(tx, f.cfg, "2026-10-09", "2026-10-09", at),
  );
  expect(model.departments).toEqual([
    { id: f.department, name: "Dining" },
    { id: inactive, name: "Closed dining" },
  ]);
  expect(model.subjects.every(({ kind }) => kind === "station")).toBe(true);
});
