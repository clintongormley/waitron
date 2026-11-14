import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, departments, kitchenStations, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { listLateSendManagerDepartmentIds, readLateSendNeedsManager } from "./late-send.js";
import { createDepartment } from "./operations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

function scoped<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, fn);
}

async function seedFixtureVenue(name: string): Promise<void> {
  await seedVenue(db, { name, invoiceLocales: ["en-GB"], operationDescription: "Hospitality" });
  await db.insert(kitchenStations).values({ name: "Default prep", isDefault: true });
}

async function department(name: string): Promise<string> {
  return scoped(async (tx) => (await createDepartment(tx, { name })).id);
}

async function switchOn(departmentId: string): Promise<void> {
  await db
    .update(departments)
    .set({ lateSendNeedsManager: true })
    .where(eq(departments.id, departmentId));
}

describe("readLateSendNeedsManager", () => {
  it("answers false for a new department and true once the setting is on", async () => {
    await seedFixtureVenue("Late send read");
    const id = await department("Restaurant");
    expect(await scoped((tx) => readLateSendNeedsManager(tx, id))).toBe(false);
    await switchOn(id);
    expect(await scoped((tx) => readLateSendNeedsManager(tx, id))).toBe(true);
  });
});

describe("listLateSendManagerDepartmentIds", () => {
  it("lists this venue's active departments with the setting on", async () => {
    await seedFixtureVenue("Late send list");
    const a = await department("A");
    await department("B");
    const c = await department("C");
    for (const id of [a, c]) await switchOn(id);
    await db.update(departments).set({ active: false }).where(eq(departments.id, c));
    expect(await scoped((tx) => listLateSendManagerDepartmentIds(tx))).toEqual([a]);
  });
});
