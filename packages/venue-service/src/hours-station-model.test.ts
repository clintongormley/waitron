import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  departments,
  kitchenStations,
  specialDayDates,
  specialDays,
  withTransaction,
  venueLocationId,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { readCalendarDays } from "./hours.js";
import { readOpeningHoursModel } from "./menu-timetable.js";
import { routingModel } from "./routing-store.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
const at = new Date("2026-10-06T10:00:00Z");

async function fixture() {
  return withTransaction(suite.db, async (tx) => {
    await seedVenue(tx, {
      name: `Venue ${randomUUID()}`,
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      timeZone: "Europe/Madrid",
      dayCutover: "04:30:00",
    });
    const venueId = await venueLocationId(tx);
    const cfg = { locationId: venueId };
    const [department] = await tx
      .insert(departments)
      .values({
        name: "Dining",
        tradingName: "Dining",
        isDefault: true,
      })
      .returning();
    return { cfg, department: department!.id };
  });
}

/** A special day "Festival" on 2026-10-09, written straight to its tables. */
async function festival() {
  return withTransaction(suite.db, async (tx) => {
    const [day] = await tx
      .insert(specialDays)
      .values({ name: "Festival", repeatsYearly: false })
      .returning({ id: specialDays.id });
    await tx.insert(specialDayDates).values({ specialDayId: day!.id, date: "2026-10-09" });
    return day!.id;
  });
}

describe("Calendar without a station-hours page model", () => {
  it("keeps local stations separate from special-day Calendar facts", async () => {
    await fixture();
    const special = await festival();
    const ids = await withTransaction(suite.db, async (tx) => {
      const [bar, prep, kitchen] = await tx
        .insert(kitchenStations)
        .values([
          { name: "Bar" },
          { name: "Prep", active: false },
          { name: "Kitchen", isDefault: true },
        ])
        .returning();
      return { bar: bar!.id, prep: prep!.id, kitchen: kitchen!.id };
    });
    const model = await withTransaction(suite.db, (tx) =>
      readCalendarDays(tx, "2026-10-09", "2026-10-09"),
    );
    const routing = await withTransaction(suite.db, (tx) => routingModel(tx, at));
    expect(routing.stations).toEqual([
      { id: ids.bar, name: "Bar", active: true, colour: "red" },
      { id: ids.kitchen, name: "Kitchen", active: true, colour: "red" },
    ]);
    expect(
      (await suite.db.select().from(kitchenStations)).find((row) => row.id === ids.prep),
    ).toMatchObject({ id: ids.prep, name: "Prep", active: false });
    expect(routing.stationTimes.map((row) => row.stationId)).not.toContain(ids.prep);
    expect(model[0]!.specialDay).toEqual({ id: special, name: "Festival" });
  });

  it("keeps special days without station-hour fields when the venue has no stations", async () => {
    await fixture();
    const special = await festival();
    const model = await withTransaction(suite.db, (tx) =>
      readCalendarDays(tx, "2026-10-09", "2026-10-09"),
    );
    expect(model).toEqual([
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
        name: "Closed dining",
        tradingName: "Closed dining",
        active: false,
      })
      .returning();
    return row!.id;
  });
  const model = await withTransaction(suite.db, (tx) => readOpeningHoursModel(tx, at));
  expect(model.departments.map(({ id, name }) => ({ id, name }))).toEqual([
    { id: f.department, name: "Dining" },
  ]);
  expect(model.departments.some(({ id }) => id === inactive)).toBe(false);
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
