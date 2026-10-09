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
import {
  deleteSpecialDate,
  duplicateSpecialDate,
  replaceWeekHours,
  saveSpecialDate,
} from "./hours.js";
import { WEEK_DISPLAY_ORDER, type HoursSubject } from "./hours-types.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import type { VenueScope } from "./operations.js";
import { departments } from "./schema/service.js";
import { writeEditSentLines } from "./kitchen-notices.js";
import { setStationFallback, setStationToday } from "./station-times.js";

// A file of its own: the triggers `installChangeFeed` puts on the suite's database stay there for
// every later test in the file.
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

it("refreshes Hours and routing after every schedule, date, clock, subject and override change", async () => {
  const at = new Date("2026-10-06T10:00:00Z");
  const { cfg, departmentId, deli, bar, kitchen } = await withTransaction(db, async (tx) => {
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
    const [barRow, kitchenRow, deliRow] = await tx
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
      deli: { kind: "station", id: deliRow!.id } as HoursSubject,
      bar: { kind: "station", id: barRow!.id } as HoursSubject,
      kitchen: kitchenRow!.id,
    };
  });
  const mornings = WEEK_DISPLAY_ORDER.map((weekday) => ({
    weekday,
    cell: {
      mode: "periods" as const,
      periods: [{ id: randomUUID(), opensAt: "08:00", closesAt: "09:00" }],
    },
  }));
  const hours = QUERY_DEPENDENCIES.hours;
  const routing = QUERY_DEPENDENCIES.routing;

  const week = await announced((tx) => replaceWeekHours(tx, cfg, bar, mornings, at));
  expect(reaches(week, hours)).toEqual(["hours_week_cells", "hours_week_periods"]);
  expect(reaches(week, routing)).toEqual(["hours_week_cells", "hours_week_periods"]);

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
          cells: [
            { subject: deli, cell: { mode: "closed", periods: [] } },
            {
              subject: bar,
              cell: {
                mode: "periods",
                periods: [{ id: randomUUID(), opensAt: "10:00", closesAt: "12:00" }],
              },
            },
          ],
        },
        at,
      )
    ).id;
  });
  const dateTables = ["special_dates", "special_date_hours", "special_date_hours_periods"];
  expect(reaches(created, hours)).toEqual(dateTables);
  expect(reaches(created, routing)).toEqual(dateTables);
  const copied = await announced((tx) => duplicateSpecialDate(tx, cfg, id, ["2030-10-22"], at));
  expect(reaches(copied, hours)).toEqual(dateTables);
  const removed = await announced((tx) => deleteSpecialDate(tx, cfg, id, at));
  expect(reaches(removed, hours)).toEqual(dateTables);
  expect(reaches(removed, routing)).toEqual(dateTables);

  const clock = await announced((tx) =>
    tx.update(locations).set({ timeZone: "Europe/Lisbon" }).where(eq(locations.id, cfg.locationId)),
  );
  expect(reaches(clock, hours)).toEqual(["locations"]);
  expect(reaches(clock, routing)).toEqual(["locations"]);

  const renamed = await announced((tx) =>
    tx.update(departments).set({ name: "Shop" }).where(eq(departments.id, departmentId)),
  );
  expect(reaches(renamed, hours)).toEqual(["departments"]);
  const station = await announced((tx) =>
    tx.update(kitchenStations).set({ isDefault: false }).where(eq(kitchenStations.id, kitchen)),
  );
  expect(reaches(station, hours)).toEqual(["kitchen_stations"]);
  const today = await announced((tx) => setStationToday(tx, cfg, bar.id, "closed", at));
  expect(reaches(today, hours)).toEqual(["station_day_states"]);
  const fallback = await announced((tx) => setStationFallback(tx, cfg, bar.id, kitchen));
  expect(reaches(fallback, hours)).toEqual(["station_fallbacks"]);

  // Control: a write Hours does not read reaches neither query.
  const unrelated = await announced((tx) => writeEditSentLines(tx, false));
  expect(unrelated.size).toBeGreaterThan(0);
  expect(reaches(unrelated, hours)).toEqual([]);
});

it("refreshes Hours and holiday coverage after every named day, area, address and country change", async () => {
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
  const hours = QUERY_DEPENDENCIES.hours;
  const holidays = QUERY_DEPENDENCIES.holidays;
  const both = (types: Set<string>) => [reaches(types, hours), reaches(types, holidays)];

  const named = await announced((tx) =>
    saveSpecialDate(
      tx,
      cfg,
      null,
      { date: "2026-06-17", name: "Arán", kind: "holiday", closeWholeVenue: false, cells: [] },
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
