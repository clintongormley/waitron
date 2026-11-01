import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { floorZones, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { planVenue, type VenueRequest } from "@waitron/provisioning";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { locationId } from "@waitron/shared";
import { createDepartment, createServiceZone, resolveSalePolicy } from "@waitron/venue-service";
import { ALL_MODULES } from "./modules.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import {
  buildConfigurationBundle,
  exportConfigurationTables,
  importConfigurationTables,
} from "./configuration-transfer.js";

const source = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const target = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

function request(taxId: string): VenueRequest {
  return {
    country: "ES",
    taxId,
    legalName: "Policy import fixture",
    location: {
      name: "Policy import venue",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant",
      addressLine1: "1 Central Street",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
    },
    seriesCode: "A",
    fullSeriesCode: "FF",
    rectificativeSeriesCode: "R",
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
  const cfg = { locationId: locationId(prepared.locationId) };
  const { department, zone } = await withTransaction(source.db, async (tx) => {
    const department = await createDepartment(tx, cfg, { name: "Terrace", orderStart: "table" });
    const zone = await createServiceZone(tx, cfg, {
      name: "Garden",
      departmentId: department.id,
    });
    return { department, zone };
  });
  const [operator] = await source.db.select().from(persons).where(eq(persons.role, "admin"));
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

describe.each(["one row", "every row"])("with %s missing", (missing) => {
  it.each([
    ["department_sale_policies", "department_id"],
    ["zone_service_policies", "zone_id"],
    ["zone_sale_policies", "zone_id"],
  ] as const)("refuses an import missing a %s row and preserves the target", async (table, key) => {
    const f = await fixture();
    const id = key === "department_id" ? f.department.id : f.zone.id;
    const rows = f.bundle.tables[table]!;
    expect(rows.some((row) => row[key] === id)).toBe(true);
    f.bundle.tables[table] = missing === "one row" ? rows.filter((row) => row[key] !== id) : [];
    if (table === "zone_service_policies")
      f.bundle.tables.zone_sale_policies = f.bundle.tables.zone_sale_policies!.filter(
        (row) => missing === "one row" && row.zone_id !== id,
      );
    expect(f.bundle.tables[table]).toHaveLength(missing === "one row" ? rows.length - 1 : 0);
    const before = await exportConfigurationTables(target.db, ALL_MODULES);
    await expect(
      withTransaction(target.db, (tx) =>
        importConfigurationTables(tx, f.bundle, f.installed, ALL_MODULES, f.versions),
      ),
    ).rejects.toMatchObject({ code: "setup.request_invalid", params: { field: table } });
    expect(await exportConfigurationTables(target.db, ALL_MODULES)).toEqual(before);
  });
});

it("imports complete policies and resolves inherited values for the remapped zone", async () => {
  const f = await fixture();
  await withTransaction(target.db, (tx) =>
    importConfigurationTables(tx, f.bundle, f.installed, ALL_MODULES, f.versions),
  );
  const [zone] = await target.db.select().from(floorZones).where(eq(floorZones.name, "Garden"));
  expect(zone!.id).not.toBe(f.zone.id);
  expect(
    await withTransaction(target.db, (tx) =>
      resolveSalePolicy(tx, { locationId: locationId(f.installed.locationId) }, zone!.id),
    ),
  ).toMatchObject({
    zoneId: zone!.id,
    departmentName: "Terrace",
    orderStart: "table",
    paidWhen: "prepay",
    collectionNumber: "none",
    receiptPrintMode: "auto",
    printTradingName: true,
  });
});
