import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  diningTables,
  floorZones,
  kitchenStations,
  locations,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId as brandLocationId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createDepartment, createServiceZone } from "./operations.js";
import { departments } from "./schema/service.js";
import { listNeedsClearingDepartmentIds, readTablesNeedingClearing } from "./table-clearing.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

function scoped<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, fn);
}

async function seedLocation(name: string): Promise<LocationId> {
  const [row] = await db
    .insert(locations)
    .values({ name, invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning({ id: locations.id });
  const locationId = brandLocationId(row!.id);
  await db.insert(kitchenStations).values({ locationId, name: "Default prep", isDefault: true });
  return locationId;
}

async function switchOn(departmentId: string): Promise<void> {
  await db.execute(sql`update departments set needs_clearing = 1 where id = ${departmentId}`);
}

async function departmentWithTable(cfg: { locationId: LocationId }, name: string) {
  return scoped(async (tx) => {
    const department = await createDepartment(tx, cfg, { name, orderStart: "table" });
    const zone = await createServiceZone(tx, cfg, { name, departmentId: department.id });
    const [table] = await tx
      .insert(diningTables)
      .values({ locationId: cfg.locationId, zoneId: zone.id, label: randomUUID() })
      .returning({ id: diningTables.id });
    return { departmentId: department.id, tableId: table!.id };
  });
}

describe("readTablesNeedingClearing", () => {
  it("reads a table in a department with Needs clearing on, and not one in a department with it off", async () => {
    const cfg = { locationId: await seedLocation("Clearing on and off") };
    const a = await departmentWithTable(cfg, "A");
    const b = await departmentWithTable(cfg, "B");
    await switchOn(a.departmentId);
    expect(await scoped((tx) => readTablesNeedingClearing(tx, [a.tableId, b.tableId]))).toEqual(
      new Set([a.tableId]),
    );
  });

  it("leaves out a table whose zone has no department", async () => {
    const cfg = { locationId: await seedLocation("Clearing without department") };
    const a = await departmentWithTable(cfg, "A");
    const [zone] = await db
      .insert(floorZones)
      .values({ locationId: cfg.locationId, name: "No department" })
      .returning({ id: floorZones.id });
    const [table] = await db
      .insert(diningTables)
      .values({ locationId: cfg.locationId, zoneId: zone!.id, label: randomUUID() })
      .returning({ id: diningTables.id });
    await db
      .update(departments)
      .set({ needsClearing: true })
      .where(eq(departments.locationId, cfg.locationId));
    const found = await scoped((tx) => readTablesNeedingClearing(tx, [a.tableId, table!.id]));
    expect(found.has(table!.id)).toBe(false);
    expect(found.has(a.tableId)).toBe(true);
  });

  it("answers an empty list with an empty set, without a query", async () => {
    const untouchable = new Proxy({} as Transaction, {
      get(_target, key) {
        throw new Error(`the transaction was used: ${String(key)}`);
      },
    });
    expect((await readTablesNeedingClearing(untouchable, [])).size).toBe(0);
  });

  it("leaves out an id that is no table", async () => {
    const cfg = { locationId: await seedLocation("Clearing unknown id") };
    const a = await departmentWithTable(cfg, "A");
    await switchOn(a.departmentId);
    const unknown = randomUUID();
    const found = await scoped((tx) => readTablesNeedingClearing(tx, [a.tableId, unknown]));
    expect(found.has(unknown)).toBe(false);
    expect(found.has(a.tableId)).toBe(true);
  });
});

describe("listNeedsClearingDepartmentIds", () => {
  it("lists the active departments with Needs clearing on", async () => {
    const cfg = { locationId: await seedLocation("Clearing list") };
    const a = await departmentWithTable(cfg, "A");
    await departmentWithTable(cfg, "B");
    const c = await departmentWithTable(cfg, "C");
    await switchOn(a.departmentId);
    await switchOn(c.departmentId);
    await db.execute(sql`update departments set active = 0 where id = ${c.departmentId}`);
    expect(await scoped((tx) => listNeedsClearingDepartmentIds(tx, cfg))).toEqual([a.departmentId]);
  });
});
