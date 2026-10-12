import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { diningTables, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { locationId, nodeId } from "@waitron/shared";
import {
  createDepartment,
  createServiceZone,
  deleteDepartment,
  departments,
  readDepartmentDeleteImpact,
  readZoneDeleteImpact,
} from "@waitron/venue-service";
import { createTable } from "./testing/live-table.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { moduleCoreServices } from "./parties.js";
import type { TillConfig } from "./till-config.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(
    manifestSets().filter((set) => set.name !== "bookings"),
    null,
  ),
  timeoutMs: 60_000,
});
const NOW = new Date("2026-10-11T12:00:00Z");

it("deletes through the real core seat when the optional bookings table was never migrated", async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Booking-free venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    })
    .returning({ id: locations.id });
  const cfg: TillConfig = {
    locationId: locationId(location!.id),
    nodeId: nodeId(randomUUID()),
    locale: "en-GB",
    invoiceLocales: ["en-GB"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const f = await withTransaction(suite.db, async (tx) => {
    await createDepartment(tx, cfg, { name: "Keep", orderStart: "table" });
    const department = await createDepartment(tx, cfg, { name: "Delete", orderStart: "table" });
    const zone = await createServiceZone(tx, cfg, { name: "Terrace", departmentId: department.id });
    const table = await createTable(tx, cfg, { label: "1", zoneId: zone.id });
    return { departmentId: department.id, zoneId: zone.id, tableId: table.id };
  });
  const absent = await suite.db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name = 'bookings'`,
  );
  expect(absent.rows).toEqual([]);

  const floor = moduleCoreServices(
    cfg,
    enabledTableRemovals(ALL_MODULES.filter((module) => module.name !== "bookings")),
  ).floorDeletion;
  const zone = await withTransaction(suite.db, (tx) =>
    readZoneDeleteImpact(tx, cfg, floor, f.zoneId, NOW),
  );
  expect(zone.target.id).toBe(f.zoneId);
  expect(zone.refusals).toEqual([]);
  const preview = await withTransaction(suite.db, (tx) =>
    readDepartmentDeleteImpact(tx, cfg, floor, f.departmentId, NOW),
  );
  expect(preview.refusals).toEqual([]);
  const impact = await withTransaction(suite.db, (tx) =>
    deleteDepartment(tx, cfg, floor, f.departmentId, NOW),
  );
  expect(impact.target.id).toBe(f.departmentId);
  expect(
    (
      await withTransaction(suite.db, (tx) =>
        tx.select().from(departments).where(eq(departments.id, f.departmentId)),
      )
    )[0]?.active,
  ).toBe(false);
  expect(
    await withTransaction(suite.db, (tx) =>
      tx.select().from(diningTables).where(eq(diningTables.id, f.tableId)),
    ),
  ).toEqual([]);
});
