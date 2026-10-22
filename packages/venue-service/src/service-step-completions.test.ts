import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  diningTables,
  floorZones,
  kitchenStations,
  locations,
  parties,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId as brandLocationId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createDepartment, createServiceZone } from "./operations.js";
import { saveServiceSteps } from "./service-steps.js";
import {
  readStepCompletions,
  readTableStepRules,
  recordStepCompletions,
} from "./service-step-completions.js";

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

async function departmentWithTables(cfg: { locationId: LocationId }, name: string, count = 1) {
  return scoped(async (tx) => {
    const department = await createDepartment(tx, cfg, { name, orderStart: "table" });
    const zone = await createServiceZone(tx, cfg, { name, departmentId: department.id });
    const tables = await tx
      .insert(diningTables)
      .values(
        Array.from({ length: count }, () => ({
          locationId: cfg.locationId,
          zoneId: zone.id,
          label: randomUUID(),
        })),
      )
      .returning({ id: diningTables.id });
    return { departmentId: department.id, tableIds: tables.map((table) => table.id) };
  });
}

async function newParty(): Promise<string> {
  const [party] = await db.insert(parties).values({ openedBy: "sender" }).returning();
  return party!.id;
}

describe("readTableStepRules", () => {
  it("reads each table's department's steps in list order", async () => {
    const cfg = { locationId: await seedLocation("Steps in order") };
    const a = await departmentWithTables(cfg, "A", 2);
    const b = await departmentWithTables(cfg, "B");
    const empty = await departmentWithTables(cfg, "Empty");
    await scoped(async (tx) => {
      await saveServiceSteps(tx, cfg, a.departmentId, [
        { name: "Bread", start: "seated", courseId: null, minutes: 0 },
        { name: "Order", start: "after_previous", courseId: null, minutes: 2 },
        { name: "Drinks?", start: "since_last_order", courseId: null, minutes: 20 },
      ]);
      await saveServiceSteps(tx, cfg, b.departmentId, [
        { name: "Bill?", start: "all_served", courseId: null, minutes: 10 },
      ]);
      await saveServiceSteps(tx, cfg, empty.departmentId, []);
    });

    const read = await scoped((tx) =>
      readTableStepRules(tx, [...a.tableIds, ...b.tableIds, ...empty.tableIds]),
    );

    const ruleShape = (rules: readonly { name: string; start: string; minutes: number }[]) =>
      rules.map(({ name, start, minutes }) => ({ name, start, minutes }));
    const aRules = [
      { name: "Bread", start: "seated", minutes: 0 },
      { name: "Order", start: "after_previous", minutes: 2 },
      { name: "Drinks?", start: "since_last_order", minutes: 20 },
    ];
    expect(read.size).toBe(4);
    for (const tableId of a.tableIds) {
      expect(read.get(tableId)?.departmentId).toBe(a.departmentId);
      expect(ruleShape(read.get(tableId)!.rules)).toEqual(aRules);
    }
    expect(read.get(b.tableIds[0]!)).toEqual({
      departmentId: b.departmentId,
      rules: [
        {
          id: expect.any(String),
          name: "Bill?",
          start: "all_served",
          courseId: null,
          minutes: 10,
        },
      ],
    });
    expect(read.get(empty.tableIds[0]!)).toEqual({ departmentId: empty.departmentId, rules: [] });
  });

  it("leaves out a table whose zone has no department", async () => {
    const cfg = { locationId: await seedLocation("Steps without department") };
    const a = await departmentWithTables(cfg, "A");
    const [zone] = await db
      .insert(floorZones)
      .values({ locationId: cfg.locationId, name: "No department" })
      .returning({ id: floorZones.id });
    const [table] = await db
      .insert(diningTables)
      .values({ locationId: cfg.locationId, zoneId: zone!.id, label: randomUUID() })
      .returning({ id: diningTables.id });

    const read = await scoped((tx) => readTableStepRules(tx, [a.tableIds[0]!, table!.id]));

    expect(read.has(table!.id)).toBe(false);
    expect(read.has(a.tableIds[0]!)).toBe(true);
  });
});

describe("step completions", () => {
  it("records completions and reads them back by party", async () => {
    const cfg = { locationId: await seedLocation("Completions") };
    const a = await departmentWithTables(cfg, "A");
    const [first, second] = (
      await scoped(async (tx) => {
        await saveServiceSteps(tx, cfg, a.departmentId, [
          { name: "Bread", start: "seated", courseId: null, minutes: 0 },
          { name: "Order", start: "after_previous", courseId: null, minutes: 2 },
        ]);
        return readTableStepRules(tx, a.tableIds);
      })
    )
      .get(a.tableIds[0]!)!
      .rules.map((rule) => rule.id);
    const one = await newParty();
    const two = await newParty();
    const other = await newParty();

    await scoped((tx) =>
      recordStepCompletions(tx, [
        { partyId: one, stepId: first!, doneAt: "2026-10-22T20:33:00.000Z", doneBy: "p1" },
        { partyId: one, stepId: second!, doneAt: "2026-10-22T20:40:00.000Z", doneBy: "p1" },
        { partyId: two, stepId: first!, doneAt: "2026-10-22T20:35:00.000Z", doneBy: "p2" },
        { partyId: other, stepId: first!, doneAt: "2026-10-22T20:36:00.000Z", doneBy: "p2" },
      ]),
    );
    await scoped((tx) =>
      recordStepCompletions(tx, [
        { partyId: one, stepId: first!, doneAt: "2026-10-22T21:00:00.000Z", doneBy: "p3" },
      ]),
    );

    const read = await scoped((tx) => readStepCompletions(tx, [one, two]));
    const order = (row: { partyId: string; stepId: string; doneAt: string }) =>
      `${row.partyId}|${row.doneAt}`;
    expect([...read].sort((x, y) => order(x).localeCompare(order(y)))).toEqual(
      [
        { partyId: one, stepId: first!, doneAt: "2026-10-22T20:33:00.000Z" },
        { partyId: one, stepId: second!, doneAt: "2026-10-22T20:40:00.000Z" },
        { partyId: one, stepId: first!, doneAt: "2026-10-22T21:00:00.000Z" },
        { partyId: two, stepId: first!, doneAt: "2026-10-22T20:35:00.000Z" },
      ].sort((x, y) => order(x).localeCompare(order(y))),
    );
  });

  it("reads nothing and writes nothing for no ids", async () => {
    const untouchable = new Proxy({} as Transaction, {
      get(_target, key) {
        throw new Error(`the transaction was used: ${String(key)}`);
      },
    });
    expect((await readTableStepRules(untouchable, [])).size).toBe(0);
    expect(await readStepCompletions(untouchable, [])).toEqual([]);
    await expect(recordStepCompletions(untouchable, [])).resolves.toBeUndefined();
  });
});
