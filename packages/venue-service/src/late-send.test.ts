import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, kitchenStations, locations, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId as brandLocationId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import { listLateSendManagerDepartmentIds, readLateSendNeedsManager } from "./late-send.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createDepartment } from "./operations.js";
import { departments } from "./schema/service.js";

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

async function department(cfg: { locationId: LocationId }, name: string): Promise<string> {
  return scoped(async (tx) => (await createDepartment(tx, cfg, { name })).id);
}

async function switchOn(departmentId: string): Promise<void> {
  await db
    .update(departments)
    .set({ lateSendNeedsManager: true })
    .where(eq(departments.id, departmentId));
}

describe("readLateSendNeedsManager", () => {
  it("answers false for a new department and true once the setting is on", async () => {
    const cfg = { locationId: await seedLocation("Late send read") };
    const id = await department(cfg, "Restaurant");
    expect(await scoped((tx) => readLateSendNeedsManager(tx, cfg, id))).toBe(false);
    await switchOn(id);
    expect(await scoped((tx) => readLateSendNeedsManager(tx, cfg, id))).toBe(true);
  });
});

describe("listLateSendManagerDepartmentIds", () => {
  it("lists this venue's active departments with the setting on", async () => {
    const cfg = { locationId: await seedLocation("Late send list") };
    const a = await department(cfg, "A");
    await department(cfg, "B");
    const c = await department(cfg, "C");
    for (const id of [a, c]) await switchOn(id);
    await db.update(departments).set({ active: false }).where(eq(departments.id, c));
    expect(await scoped((tx) => listLateSendManagerDepartmentIds(tx, cfg))).toEqual([a]);
  });
});
