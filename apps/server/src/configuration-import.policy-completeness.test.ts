import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { floorZones, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { planVenue, type VenueRequest } from "@waitron/provisioning";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { createDepartment, createServiceZone, resolveSalePolicy } from "@waitron/venue-service";
import { ALL_MODULES } from "./modules.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { buildConfigurationBundle, importConfigurationTables } from "./configuration-transfer.js";

const source = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const target = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

function request(taxId: string): VenueRequest {
  return {
    country: "ES",
    taxId,
    legalName: "Policy import fixture",
    name: "Policy import venue",
    fiscalTerritory: "ES-common",
    invoiceLocales: ["es-ES"],
    addressLine1: "1 Central Street",
    addressLine2: null,
    postalCode: "28013",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
    seriesCode: "A",
    fullSeriesCode: "FF",
    correctiveSeriesCode: "R",
    admin: {
      displayName: "Owner",
      pinHash: "scrypt$00$00",
      passwordHash: "scrypt$00$00",
      email: "owner@example.test",
    },
  };
}

async function fixture() {
  const prepared = await applyVenue(planVenue(request("B10101010"), ALL_MODULES), {
    db: source.db,
    modules: ALL_MODULES,
  });
  const installed = await applyVenue(planVenue(request("B20202020"), ALL_MODULES), {
    db: target.db,
    modules: ALL_MODULES,
  });
  const { department, zone } = await withTransaction(source.db, async (tx) => {
    const department = await createDepartment(tx, { name: "Terrace", orderStart: "table" });
    const zone = await createServiceZone(tx, {
      name: "Garden",
      departmentId: department.id,
    });
    return { department, zone };
  });
  const [operator] = await source.db
    .select()
    .from(persons)
    .where(eq(persons.email, "owner@example.test"));
  const versions = await schemaVersionsByModule(
    { venue: source.db, node: source.node },
    ALL_MODULES,
  );
  const bundle = await buildConfigurationBundle(
    source.db,
    { ...prepared, sourceOperatorId: operator!.id },
    ALL_MODULES,
    new Date("2026-10-22T10:00:00Z"),
    versions,
  );
  return { installed, department, zone, bundle, versions };
}

it("imports complete policies and resolves inherited values for the remapped zone", async () => {
  const f = await fixture();
  await withTransaction(target.db, (tx) =>
    importConfigurationTables(tx, f.bundle, ALL_MODULES, f.versions),
  );
  const [zone] = await target.db.select().from(floorZones).where(eq(floorZones.name, "Garden"));
  expect(zone!.id).not.toBe(f.zone.id);
  expect(await withTransaction(target.db, (tx) => resolveSalePolicy(tx, zone!.id))).toMatchObject({
    zoneId: zone!.id,
    departmentName: "Terrace",
    orderStart: "table",
    paidWhen: "prepay",
    collectionNumber: "none",
    printTradingName: true,
  });
});
