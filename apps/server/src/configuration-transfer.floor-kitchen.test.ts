import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { kitchenStations, withTransaction } from "@waitron/db";
import { hashPassword, hashPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { planVenue, type VenueRequest } from "@waitron/provisioning";
import { applyHistoricalTestVenue } from "@waitron/provisioning/testing/allocated-venue";
import { ALL_MODULES } from "./modules.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { buildConfigurationBundle, importConfigurationTables } from "./configuration-transfer.js";
import { useTestProducer } from "./testing/test-producer.js";

useTestProducer();
const source = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const target = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
function request(taxId: string): VenueRequest {
  return {
    country: "ES",
    taxId,
    legalName: "Test restaurant SL",
    taxpayerDomicile: "Street 1, Madrid",
    name: "Test restaurant",
    invoiceLocales: ["en-GB"],
    operationDescription: "Restaurant",
    fiscalTerritory: "ES-common",
    addressLine1: "Street 1",
    addressLine2: null,
    postalCode: "28001",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
    seriesCode: "F",
    fullSeriesCode: "FF",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Admin",
      email: `${taxId}@example.test`,
      pinHash: hashPin("1234"),
      passwordHash: hashPassword("a secure password"),
    },
  };
}
it("exports neither today's keep-open nor station closure, and imports both as open", async () => {
  const prepared = await applyHistoricalTestVenue(planVenue(request("B44001122"), ALL_MODULES), {
    db: source.db,
    modules: ALL_MODULES,
  });
  await withTransaction(source.db, async (tx) => {
    await tx.execute(
      sql`update floor_zones set kept_open_day='2026-11-12', kept_open_from='22:00:00', kept_open_until='23:30:00'`,
    );
    const [destination] = await tx.select({ id: kitchenStations.id }).from(kitchenStations);
    await tx.insert(kitchenStations).values({
      name: "Grill closed today",
      closedOnDay: "2026-11-12",
      closedSendsToStationId: destination!.id,
    });
  });
  const versions = await schemaVersionsByModule(
    { venue: source.db, node: source.node },
    ALL_MODULES,
  );
  const bundle = await buildConfigurationBundle(
    source.db,
    prepared,
    ALL_MODULES,
    new Date("2026-11-12T22:00:00Z"),
    versions,
  );
  expect(bundle.tables.floor_zones!.length).toBeGreaterThan(0);
  expect(bundle.tables.kitchen_stations!.length).toBeGreaterThan(0);
  for (const row of bundle.tables.floor_zones!)
    for (const column of ["kept_open_day", "kept_open_from", "kept_open_until"])
      expect(row).not.toHaveProperty(column);
  for (const row of bundle.tables.kitchen_stations!)
    for (const column of ["closed_on_day", "closed_sends_to_station_id"])
      expect(row).not.toHaveProperty(column);
  await applyHistoricalTestVenue(planVenue(request("B44001133"), ALL_MODULES), {
    db: target.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, bundle, ALL_MODULES, versions),
  });
  expect(
    target.db.all(sql`select kept_open_day, kept_open_from, kept_open_until from floor_zones`),
  ).toEqual(
    bundle.tables.floor_zones!.map(() => ({
      kept_open_day: null,
      kept_open_from: null,
      kept_open_until: null,
    })),
  );
  expect(
    target.db.all(sql`select closed_on_day, closed_sends_to_station_id from kitchen_stations`),
  ).toEqual(
    bundle.tables.kitchen_stations!.map(() => ({
      closed_on_day: null,
      closed_sends_to_station_id: null,
    })),
  );
});
