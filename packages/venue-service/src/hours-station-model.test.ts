import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, kitchenStations, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { readHoursModel } from "./hours.js";
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
