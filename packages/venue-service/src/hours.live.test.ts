import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, expect, it, onTestFinished } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_CHANGE_SOURCES,
  CORE_MIGRATIONS,
  installChangeFeed,
  kitchenStations,
  locations,
  subscribeToChanges,
  tenants,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_CHANGE_SOURCES } from "./classification.js";
import { saveHolidayArea } from "./holidays.js";
import { QUERY_DEPENDENCIES } from "./dashboard/live-queries.js";
import { deleteSpecialDate, duplicateSpecialDate, saveSpecialDate } from "./hours.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import type { VenueScope } from "./operations.js";
import { departments } from "./schema/service.js";
import { writeEditSentLines } from "./kitchen-notices.js";
import { setStationToday } from "./station-times.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
let db: Database;
beforeAll(async () => {
  db = suite.db;
  await installChangeFeed(db, [...CORE_CHANGE_SOURCES, ...VENUE_SERVICE_CHANGE_SOURCES]);
});

let unsubscribe = (): void => {};
afterEach(() => unsubscribe());

/** Every resource type one committed write announces. */
async function announced(write: (tx: Transaction) => Promise<unknown>): Promise<Set<string>> {
  const types = new Set<string>();
  unsubscribe = subscribeToChanges((change) => {
    for (const resource of change.resources) types.add(resource.type);
  });
  await withTransaction(db, write);
  unsubscribe();
  return types;
}

const reaches = (types: Set<string>, query: readonly string[]) =>
  query.filter((type) => types.has(type));

it("refreshes Calendar and routing from named days, clock and daily station status", async () => {
  const at = new Date("2026-10-06T10:00:00Z");
  const { cfg, departmentId, bar, kitchen } = await withTransaction(db, async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({
        name: `Venue ${randomUUID()}`,
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
        timeZone: "Europe/Madrid",
      })
      .returning();
    const [department] = await tx
      .insert(departments)
      .values({
        locationId: location!.id,
        name: "Deli",
        tradingName: "Deli",
        isDefault: true,
      })
      .returning();
    const [barRow, kitchenRow] = await tx
      .insert(kitchenStations)
      .values([
        { locationId: location!.id, name: "Bar" },
        { locationId: location!.id, name: "Kitchen", isDefault: true },
        { locationId: location!.id, name: "Deli pass" },
      ])
      .returning();
    return {
      cfg: { locationId: locationId(location!.id) } as VenueScope,
      departmentId: department!.id,
      bar: barRow!.id,
      kitchen: kitchenRow!.id,
    };
  });
  const calendar = QUERY_DEPENDENCIES["named-days"];
  const routing = QUERY_DEPENDENCIES.routing;

  let id = "";
  const created = await announced(async (tx) => {
    id = (
      await saveSpecialDate(
        tx,
        cfg,
        null,
        {
          date: "2030-10-15",
          name: "Party",
          closeWholeVenue: false,
        },
        at,
      )
    ).id;
  });
  const dateTables = ["special_dates"];
  expect(reaches(created, calendar)).toEqual(dateTables);
  expect(reaches(created, routing)).toEqual(dateTables);
  const copied = await announced((tx) => duplicateSpecialDate(tx, cfg, id, ["2030-10-22"], at));
  expect(reaches(copied, calendar)).toEqual(["special_dates"]);
  expect(reaches(copied, routing)).toEqual(["special_dates"]);
  const removed = await announced((tx) => deleteSpecialDate(tx, cfg, id, at));
  expect(reaches(removed, calendar)).toEqual(dateTables);
  expect(reaches(removed, routing)).toEqual(dateTables);

  const clock = await announced((tx) =>
    tx.update(locations).set({ timeZone: "Europe/Lisbon" }).where(eq(locations.id, cfg.locationId)),
  );
  expect(reaches(clock, calendar)).toEqual(["locations"]);
  expect(reaches(clock, routing)).toEqual(["locations"]);

  const renamed = await announced((tx) =>
    tx.update(departments).set({ name: "Shop" }).where(eq(departments.id, departmentId)),
  );
  expect(reaches(renamed, calendar)).toEqual(["departments"]);
  const station = await announced((tx) =>
    tx.update(kitchenStations).set({ isDefault: false }).where(eq(kitchenStations.id, kitchen)),
  );
  expect(reaches(station, calendar)).toEqual([]);
  const today = await announced((tx) => setStationToday(tx, cfg, bar, "closed", at));
  expect(reaches(today, calendar)).toEqual([]);
  expect(reaches(today, routing)).toEqual(["station_day_states"]);
  const unrelated = await announced((tx) => writeEditSentLines(tx, false));
  expect(unrelated.size).toBeGreaterThan(0);
  expect(reaches(unrelated, calendar)).toEqual([]);
});

it("refreshes Calendar and holiday coverage after every named day, area, address and country change", async () => {
  const before = await db.select().from(tenants);
  onTestFinished(() =>
    withTransaction(db, async (tx) => {
      await tx.delete(tenants);
      if (before.length > 0) await tx.insert(tenants).values(before);
    }),
  );
  const cfg = await withTransaction(db, async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Invented SL" })
      .onConflictDoUpdate({ target: tenants.id, set: { country: "ES" } });
    const [location] = await tx
      .insert(locations)
      .values({
        name: `Venue ${randomUUID()}`,
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
        timeZone: "Europe/Madrid",
        province: "Lleida",
        city: "Vielha",
      })
      .returning();
    return { locationId: locationId(location!.id) } as VenueScope;
  });
  const calendar = QUERY_DEPENDENCIES["named-days"];
  const holidays = QUERY_DEPENDENCIES.holidays;
  const both = (types: Set<string>) => [reaches(types, calendar), reaches(types, holidays)];

  const named = await announced((tx) =>
    saveSpecialDate(
      tx,
      cfg,
      null,
      { date: "2026-06-17", name: "Arán", kind: "holiday", closeWholeVenue: false },
      new Date("2026-01-01T12:00:00Z"),
    ),
  );
  expect(both(named)).toEqual([["special_dates"], ["special_dates"]]);
  const area = await announced((tx) => saveHolidayArea(tx, cfg, { areaKey: "aran" }));
  expect(both(area)).toEqual([["holiday_geographies"], ["holiday_geographies"]]);
  const moved = await announced((tx) =>
    tx.update(locations).set({ city: "Lleida" }).where(eq(locations.id, cfg.locationId)),
  );
  expect(both(moved)).toEqual([["locations"], ["locations"]]);
  const country = await announced((tx) => tx.update(tenants).set({ country: "PT" }));
  expect(both(country)).toEqual([["tenants"], ["tenants"]]);
});

it("daily station status refreshes routing and named days refresh Opening hours", async () => {
  const at = new Date("2026-10-06T10:00:00Z");
  const { cfg, bar, dateId } = await withTransaction(db, async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({
        name: `Retained ${randomUUID()}`,
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
        timeZone: "Europe/Madrid",
      })
      .returning();
    const cfg = { locationId: locationId(location!.id) };
    const [bar] = await tx
      .insert(kitchenStations)
      .values([
        { locationId: cfg.locationId, name: "Bar" },
        { locationId: cfg.locationId, name: "Kitchen", isDefault: true },
      ])
      .returning();
    const date = await saveSpecialDate(
      tx,
      cfg,
      null,
      {
        date: "2030-10-15",
        name: "Party",
        closeWholeVenue: false,
      },
      at,
    );
    return { cfg, bar: bar!.id, dateId: date.id };
  });
  const sources = [QUERY_DEPENDENCIES.routing, QUERY_DEPENDENCIES["opening-hours"]];
  const station = await announced((tx) => setStationToday(tx, cfg, bar, "closed", at));
  expect(reaches(station, sources[0]!)).toEqual(["station_day_states"]);
  const named = await announced((tx) =>
    saveSpecialDate(
      tx,
      cfg,
      dateId,
      {
        date: "2030-10-15",
        name: "Party renamed",
        closeWholeVenue: false,
      },
      at,
    ),
  );
  expect(reaches(named, sources[1]!)).toEqual(["special_dates"]);
});
