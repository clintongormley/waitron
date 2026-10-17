import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorPlanSets,
  locations,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId, type LocationId } from "@waitron/shared";
import { linkFloorPlanSet, readFloorPlanSets } from "./floor-plan-set-store.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createDepartment, createServiceZone } from "./operations.js";
import { departmentFloorPlanSets } from "./schema/floor-plan-sets.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});

async function venue(tx: Transaction) {
  const [place] = await tx
    .insert(locations)
    .values({ name: randomUUID(), invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning();
  const cfg = { locationId: locationId(place!.id) };
  const restaurant = await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" });
  const bar = await createDepartment(tx, cfg, { name: "Bar", orderStart: "table" });
  return { cfg, restaurant: restaurant.id, bar: bar.id };
}

async function newSet(tx: Transaction, cfg: { locationId: LocationId }): Promise<string> {
  const [row] = await tx
    .insert(floorPlanSets)
    .values({ locationId: cfg.locationId })
    .returning({ id: floorPlanSets.id });
  return row!.id;
}

describe("a department's floor plan sets", () => {
  it("makes a department's first set its default", async () => {
    await withTransaction(suite.db, async (tx) => {
      const { cfg, restaurant } = await venue(tx);
      const standard = await newSet(tx, cfg);
      const dinner = await newSet(tx, cfg);
      await linkFloorPlanSet(tx, cfg, {
        setId: standard,
        departmentId: restaurant,
        name: "Standard",
      });
      await linkFloorPlanSet(tx, cfg, { setId: dinner, departmentId: restaurant, name: "Dinner" });
      const sets = await readFloorPlanSets(tx, cfg, { departmentId: restaurant });
      expect(sets.map(({ name, isDefault }) => ({ name, isDefault }))).toEqual([
        { name: "Standard", isDefault: true },
        { name: "Dinner", isDefault: false },
      ]);
    });
  });

  it("lists the default first, then the others by name", async () => {
    await withTransaction(suite.db, async (tx) => {
      const { cfg, restaurant } = await venue(tx);
      for (const name of ["Standard", "Dinner", "Brunch"])
        await linkFloorPlanSet(tx, cfg, {
          setId: await newSet(tx, cfg),
          departmentId: restaurant,
          name,
        });
      const sets = await readFloorPlanSets(tx, cfg, { departmentId: restaurant });
      expect(sets.map(({ name, isDefault }) => ({ name, isDefault }))).toEqual([
        { name: "Standard", isDefault: true },
        { name: "Brunch", isDefault: false },
        { name: "Dinner", isDefault: false },
      ]);
    });
  });

  it("refuses a name the department already has", async () => {
    await withTransaction(suite.db, async (tx) => {
      const { cfg, restaurant } = await venue(tx);
      await linkFloorPlanSet(tx, cfg, {
        setId: await newSet(tx, cfg),
        departmentId: restaurant,
        name: "Dinner",
      });
      const again = await newSet(tx, cfg);
      await expect(
        linkFloorPlanSet(tx, cfg, { setId: again, departmentId: restaurant, name: "Dinner" }),
      ).rejects.toMatchObject({
        code: "floor_plan_set.name_taken",
        params: { departmentId: restaurant, name: "Dinner" },
      });
    });
  });

  it("allows the same name in two departments", async () => {
    await withTransaction(suite.db, async (tx) => {
      const { cfg, restaurant, bar } = await venue(tx);
      const a = await newSet(tx, cfg);
      const b = await newSet(tx, cfg);
      await linkFloorPlanSet(tx, cfg, { setId: a, departmentId: restaurant, name: "Standard" });
      await linkFloorPlanSet(tx, cfg, { setId: b, departmentId: bar, name: "Standard" });
      const sets = await readFloorPlanSets(tx, cfg, { setIds: [a, b] });
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
      const { cfg, restaurant, bar } = await venue(tx);
      const terrace = await createServiceZone(tx, cfg, {
        name: "Terrace",
        departmentId: restaurant,
        displayOrder: 2,
      });
      const dining = await createServiceZone(tx, cfg, {
        name: "Dining room",
        departmentId: restaurant,
        displayOrder: 1,
      });
      await createServiceZone(tx, cfg, { name: "Counter", departmentId: bar, displayOrder: 0 });
      const set = await newSet(tx, cfg);
      await linkFloorPlanSet(tx, cfg, { setId: set, departmentId: restaurant, name: "Standard" });
      const [summary] = await readFloorPlanSets(tx, cfg, { setIds: [set] });
      expect(summary).toEqual({
        setId: set,
        departmentId: restaurant,
        name: "Standard",
        isDefault: true,
        zoneIds: [dining.id, terrace.id],
      });
    });
  });

  it("holds one default per department in the database", async () => {
    await withTransaction(suite.db, async (tx) => {
      const { cfg, restaurant } = await venue(tx);
      await tx.insert(departmentFloorPlanSets).values({
        setId: await newSet(tx, cfg),
        departmentId: restaurant,
        name: "Standard",
        isDefault: true,
      });
      await tx.insert(departmentFloorPlanSets).values({
        setId: await newSet(tx, cfg),
        departmentId: restaurant,
        name: "Brunch",
        isDefault: false,
      });
      const second = await newSet(tx, cfg);
      await expect(
        tx.insert(departmentFloorPlanSets).values({
          setId: second,
          departmentId: restaurant,
          name: "Dinner",
          isDefault: true,
        }),
      ).rejects.toThrow(/UNIQUE constraint failed: department_floor_plan_sets\.department_id$/);
      const index = await tx.all<{ sql: string }>(
        sql`select sql from sqlite_master where type = 'index' and name = 'department_floor_plan_sets_one_default_key'`,
      );
      expect(index.map((row) => / WHERE (.*)$/.exec(row.sql)?.[1])).toEqual([
        `"department_floor_plan_sets"."is_default"`,
      ]);
    });
  });
});
