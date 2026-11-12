import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  floorPlanSets,
  departments,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { addFloorPlanSet, readFloorPlanSets } from "./floor-plan-set-store.js";
import { createDepartment, createServiceZone } from "./operations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
});

async function venue(tx: Transaction) {
  await seedVenue(tx, {
    name: randomUUID(),
    invoiceLocales: ["en-GB"],
    operationDescription: "Hospitality",
  });
  const restaurant = await createDepartment(tx, { name: "Restaurant", orderStart: "table" });
  const bar = await createDepartment(tx, { name: "Bar", orderStart: "table" });
  return { restaurant: restaurant.id, bar: bar.id };
}

describe("a department's floor plan sets", () => {
  it("makes a department's first set its default", async () => {
    await withTransaction(suite.db, async (tx) => {
      const { restaurant } = await venue(tx);

      await addFloorPlanSet(tx, { departmentId: restaurant, name: "Standard" });
      await addFloorPlanSet(tx, { departmentId: restaurant, name: "Dinner" });
      const sets = await readFloorPlanSets(tx, { departmentId: restaurant });
      expect(sets.map(({ name, isDefault }) => ({ name, isDefault }))).toEqual([
        { name: "Standard", isDefault: true },
        { name: "Dinner", isDefault: false },
      ]);
    });
  });

  it("lists the default first, then the others by name", async () => {
    await withTransaction(suite.db, async (tx) => {
      const { restaurant } = await venue(tx);
      for (const name of ["Standard", "Dinner", "Brunch"])
        await addFloorPlanSet(tx, { departmentId: restaurant, name });
      const sets = await readFloorPlanSets(tx, { departmentId: restaurant });
      expect(sets.map(({ name, isDefault }) => ({ name, isDefault }))).toEqual([
        { name: "Standard", isDefault: true },
        { name: "Brunch", isDefault: false },
        { name: "Dinner", isDefault: false },
      ]);
    });
  });

  it("refuses a name the department already has", async () => {
    await withTransaction(suite.db, async (tx) => {
      const { restaurant } = await venue(tx);
      await addFloorPlanSet(tx, { departmentId: restaurant, name: "Dinner" });
      await expect(
        addFloorPlanSet(tx, { departmentId: restaurant, name: "Dinner" }),
      ).rejects.toMatchObject({
        code: "floor_plan_set.name_taken",
        params: { departmentId: restaurant, name: "Dinner" },
      });
    });
  });

  it("allows the same name in two departments", async () => {
    await withTransaction(suite.db, async (tx) => {
      const { restaurant, bar } = await venue(tx);

      const a = await addFloorPlanSet(tx, { departmentId: restaurant, name: "Standard" });
      const b = await addFloorPlanSet(tx, { departmentId: bar, name: "Standard" });
      const sets = await readFloorPlanSets(tx, { setIds: [a, b] });
      expect(
        sets.map(({ setId, departmentId, isDefault }) => [setId, departmentId, isDefault]),
      ).toEqual(
        expect.arrayContaining([
          [a, restaurant, true],
          [b, bar, true],
        ]),
      );
      expect(sets).toHaveLength(2);
    });
  });

  it("lists a set with its department's zones", async () => {
    await withTransaction(suite.db, async (tx) => {
      const { restaurant, bar } = await venue(tx);
      const terrace = await createServiceZone(tx, {
        name: "Terrace",
        departmentId: restaurant,
        displayOrder: 2,
      });
      const dining = await createServiceZone(tx, {
        name: "Dining room",
        departmentId: restaurant,
        displayOrder: 1,
      });
      await createServiceZone(tx, { name: "Counter", departmentId: bar, displayOrder: 0 });

      const set = await addFloorPlanSet(tx, { departmentId: restaurant, name: "Standard" });
      const [summary] = await readFloorPlanSets(tx, { setIds: [set] });
      expect(summary).toEqual({
        setId: set,
        departmentId: restaurant,
        name: "Standard",
        isDefault: true,
        zoneIds: [dining.id, terrace.id],
      });
    });
  });

  it("leaves out an inactive department's sets and refuses to link one to it", async () => {
    await withTransaction(suite.db, async (tx) => {
      const { restaurant, bar } = await venue(tx);

      const kept = await addFloorPlanSet(tx, { departmentId: restaurant, name: "Standard" });
      const hidden = await addFloorPlanSet(tx, { departmentId: bar, name: "Standard" });
      await tx.update(departments).set({ active: false }).where(eq(departments.id, bar));
      expect((await readFloorPlanSets(tx)).map(({ setId }) => setId)).toEqual([kept]);
      await expect(
        addFloorPlanSet(tx, { departmentId: bar, name: "Dinner" }),
      ).rejects.toMatchObject({ code: "department.not_found", params: { departmentId: bar } });
    });
  });

  it("holds one default per department in the database", async () => {
    await withTransaction(suite.db, async (tx) => {
      const { restaurant } = await venue(tx);
      await tx.insert(floorPlanSets).values({
        departmentId: restaurant,
        name: "Standard",
        isDefault: true,
      });
      await tx.insert(floorPlanSets).values({
        departmentId: restaurant,
        name: "Brunch",
        isDefault: false,
      });
      await expect(
        tx.insert(floorPlanSets).values({
          departmentId: restaurant,
          name: "Dinner",
          isDefault: true,
        }),
      ).rejects.toThrow(/UNIQUE constraint failed: floor_plan_sets\.department_id$/);
      const index = await tx.all<{ sql: string }>(
        sql`select sql from sqlite_master where type = 'index' and name = 'floor_plan_sets_one_default_key'`,
      );
      expect(index.map((row) => / WHERE (.*)$/.exec(row.sql)?.[1])).toEqual([
        `"floor_plan_sets"."is_default"`,
      ]);
    });
  });
});
