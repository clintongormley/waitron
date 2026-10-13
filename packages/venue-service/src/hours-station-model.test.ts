import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, kitchenStations, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { readSpecialDaysModel } from "./named-days.js";
import { specialDayDates, specialDays } from "./schema/seasons.js";
import { readOpeningHoursModel } from "./menu-timetable.js";
import { routingModel } from "./routing-store.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
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
        isDefault: true,
      })
      .returning();
    return { cfg, other: other!.id, department: department!.id };
  });
}

/** A special day "Festival" on 2026-10-09, written straight to its tables. */
async function festival(f: Awaited<ReturnType<typeof fixture>>) {
  return withTransaction(suite.db, async (tx) => {
    const [day] = await tx
      .insert(specialDays)
      .values({ locationId: f.cfg.locationId, name: "Festival", repeatsYearly: false })
      .returning({ id: specialDays.id });
    await tx
      .insert(specialDayDates)
      .values({ specialDayId: day!.id, locationId: f.cfg.locationId, date: "2026-10-09" });
    return day!.id;
  });
}

describe("Calendar without a station-hours page model", () => {
  it("keeps local stations separate from special-day Calendar facts", async () => {
    const f = await fixture();
    const special = await festival(f);
    const ids = await withTransaction(suite.db, async (tx) => {
      const [bar, prep, kitchen] = await tx
        .insert(kitchenStations)
        .values([
          { locationId: f.cfg.locationId, name: "Bar", displayOrder: 2 },
          { locationId: f.cfg.locationId, name: "Prep", displayOrder: 1, active: false },
          { locationId: f.cfg.locationId, name: "Kitchen", displayOrder: 0, isDefault: true },
          { locationId: f.other, name: "Elsewhere" },
        ])
        .returning();
      return { bar: bar!.id, prep: prep!.id, kitchen: kitchen!.id };
    });
    const model = await withTransaction(suite.db, (tx) =>
      readSpecialDaysModel(tx, f.cfg, "2026-10-09", "2026-10-09", at),
    );
    for (const field of ["subjects", "week", "specialCells", "specialDates"])
      expect(model).not.toHaveProperty(field);
    const routing = await withTransaction(suite.db, (tx) => routingModel(tx, f.cfg, at));
    expect(routing.stations).toEqual([
      { id: ids.bar, name: "Bar", active: true },
      { id: ids.kitchen, name: "Kitchen", active: true },
    ]);
    expect(
      (await suite.db.select().from(kitchenStations)).find((row) => row.id === ids.prep),
    ).toMatchObject({ id: ids.prep, name: "Prep", active: false, locationId: f.cfg.locationId });
    expect(routing.stationTimes.map((row) => row.stationId)).not.toContain(ids.prep);
    expect(model.days[0]!.specialDay).toEqual({ id: special, name: "Festival" });
    expect([model.timeZone, model.dayCutover, model.civilDate, model.clockReadable]).toEqual([
      "Europe/Madrid",
      "04:30",
      "2026-10-06",
      true,
    ]);
  });

  it("keeps special days without station-hour fields when the venue has no stations", async () => {
    const f = await fixture();
    const special = await festival(f);
    const model = await withTransaction(suite.db, (tx) =>
      readSpecialDaysModel(tx, f.cfg, "2026-10-09", "2026-10-09", at),
    );
    for (const field of ["subjects", "week", "specialCells", "specialDates"])
      expect(model).not.toHaveProperty(field);
    expect(model.days).toEqual([
      {
        date: "2026-10-09",
        specialDay: { id: special, name: "Festival" },
        holidays: [],
        tone: "special_day",
        closed: true,
      },
    ]);
  });
});

it("keeps local department names in the Opening hours model without station columns", async () => {
  const f = await fixture();
  const inactive = await withTransaction(suite.db, async (tx) => {
    const [row] = await tx
      .insert(departments)
      .values({
        locationId: f.cfg.locationId,
        name: "Closed dining",
        tradingName: "Closed dining",
        active: false,
      })
      .returning();
    await tx.insert(departments).values({
      locationId: f.other,
      name: "Foreign dining",
      tradingName: "Foreign dining",
    });
    return row!.id;
  });
  const model = await withTransaction(suite.db, (tx) => readOpeningHoursModel(tx, f.cfg, at));
  expect(model.departments.map(({ id, name }) => ({ id, name }))).toEqual([
    { id: f.department, name: "Dining" },
  ]);
  expect(model.departments.some(({ id }) => id === inactive)).toBe(false);
  expect(model.departments.some(({ name }) => name === "Foreign dining")).toBe(false);
  expect(model).not.toHaveProperty("subjects");
});

it("the public module no longer offers the retired station-hours page model", async () => {
  const api = await import("./index.js");
  expect(api).not.toHaveProperty("readHoursModel");
});

it.each(["readWeekHours", "replaceWeekHours"])(
  "the public module no longer offers the retired station-week function %s",
  async (method) => {
    const api = await import("./index.js");
    expect(api).not.toHaveProperty(method);
  },
);

it.each(["readWeekHours", "replaceWeekHours"])(
  "the production calendar module no longer offers the retired station-week function %s",
  async (method) => {
    const api = await import("./hours.js");
    expect(api).not.toHaveProperty(method);
  },
);

it.each(["./index.js", "./hours.js", "./hours-rules.js"])(
  "the production module %s no longer offers station-cell interval conversion",
  async (module) => {
    const api = await import(module);
    expect(api).not.toHaveProperty("cellIntervals");
  },
);

it.each(["parseSubject", "parseWeek", "tailOverlaps", "pairMatters", "effective"])(
  "the production calendar rules no longer offer the station-week rule %s",
  async (method) => {
    const api = await import("./hours-rules.js");
    expect(api).not.toHaveProperty(method);
  },
);
