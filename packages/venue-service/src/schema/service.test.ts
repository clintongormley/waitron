import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  departments,
  kitchenNotices,
  routingCellPeriods,
  routingCells,
  withTransaction,
  floorZones,
} from "@waitron/db";
import { seedTaxpayer, seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * The Drizzle declarations, read without a database. A foreign key's name exists only here: the
 * generated SQL emits no `CONSTRAINT` clause for one, so `../migrations.test.ts` can read back a
 * key's shape but never its name.
 */
const EXPECTED: Record<
  string,
  {
    table: SQLiteTable;
    foreignKeys: string[];
    checks: string[];
    indexes: string[];
    uniqueConstraints: string[];
    primaryKeys: string[];
  }
> = {
  departments: {
    table: departments,
    foreignKeys: ["departments_transfer_desk_profile_fk", "departments_receipt_logo_fk"],
    checks: [
      "departments_order_start_ck",
      "departments_paid_when_ck",
      "departments_collection_number_ck",
      "departments_dining_ck",
      "departments_dining_starts_as_ck",
      "departments_estimated_margin_ck",
    ],
    indexes: ["departments_name_key", "departments_one_default_key"],
    uniqueConstraints: [],
    primaryKeys: [],
  },
  routing_cells: {
    table: routingCells,
    foreignKeys: [
      "routing_cells_category_fk",
      "routing_cells_product_fk",
      "routing_cells_zone_fk",
      "routing_cells_station_fk",
    ],
    checks: [
      "routing_cells_subject_ck",
      "routing_cells_coordinate_ck",
      "routing_cells_target_ck",
      "routing_cells_no_category_ck",
    ],
    indexes: [
      "routing_cells_category_every_zone_key",
      "routing_cells_category_zone_key",
      "routing_cells_product_every_zone_key",
      "routing_cells_product_zone_key",
      "routing_cells_all_zone_key",
      "routing_cells_no_category_every_zone_key",
      "routing_cells_no_category_zone_key",
    ],
    uniqueConstraints: [],
    primaryKeys: [],
  },
  routing_cell_periods: {
    table: routingCellPeriods,
    foreignKeys: [
      "routing_cell_periods_cell_fk",
      "routing_cell_periods_period_fk",
      "routing_cell_periods_station_fk",
    ],
    checks: ["routing_cell_periods_target_ck"],
    indexes: ["routing_cell_periods_cell_period_key"],
    uniqueConstraints: [],
    primaryKeys: [],
  },
  kitchen_notices: {
    table: kitchenNotices,
    foreignKeys: [
      "kitchen_notices_station_fk",
      "kitchen_notices_order_fk",
      "kitchen_notices_ticket_item_fk",
    ],
    checks: [
      "kitchen_notices_ticket_item_kind_ck",
      "kitchen_notices_kind_ck",
      "kitchen_notices_allergy_block_ck",
      "kitchen_notices_allergy_kind_ck",
      "kitchen_notices_allergy_options_ck",
      "kitchen_notices_quantity_ck",
      "kitchen_notices_moved_to_ck",
      "kitchen_notices_rerouted_to_ck",
      "kitchen_notices_direction_ck",
      "kitchen_notices_direction_kind_ck",
      "kitchen_notices_cancelled_extra_kind_ck",
    ],
    indexes: [
      "kitchen_notices_order_idx",
      "kitchen_notices_ticket_item_idx",
      "kitchen_notices_open_idx",
    ],
    uniqueConstraints: [],
    primaryKeys: [],
  },
};

describe("venue-service schema", () => {
  // Without it, an emptied EXPECTED would leave the loop below passing over nothing.
  it("covers the remaining service tables it lists", () => {
    expect(Object.keys(EXPECTED)).toHaveLength(4);
  });

  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`declares ${name}'s keys, checks and indexes`, () => {
      const config = getTableConfig(expected.table);
      expect(config.name).toBe(name);
      expect(config.foreignKeys.map((key) => key.getName())).toEqual(expected.foreignKeys);
      expect(config.checks.map((check) => check.name)).toEqual(expected.checks);
      expect(config.indexes.map((index) => index.config.name)).toEqual(expected.indexes);
      expect(config.uniqueConstraints.map((unique) => unique.getName())).toEqual(
        expected.uniqueConstraints,
      );
      expect(config.primaryKeys.map((key) => key.getName())).toEqual(expected.primaryKeys);
    });
  }

  // Dropping a predicate leaves the index's name unchanged, so the per-table assertions above
  // cannot see it.
  it("keeps every partial index partial", () => {
    const partial = [
      ...getTableConfig(departments).indexes,
      ...getTableConfig(floorZones).indexes,
      ...getTableConfig(kitchenNotices).indexes,
      ...getTableConfig(routingCells).indexes,
    ].filter((index) => index.config.where !== undefined);
    expect(partial.map((index) => [index.config.name, index.config.unique])).toEqual([
      ["departments_name_key", true],
      ["departments_one_default_key", true],
      ["floor_zones_one_counter_default_key", true],
      ["floor_zones_name_key", true],
      ["kitchen_notices_ticket_item_idx", false],
      ["kitchen_notices_open_idx", false],
      ["routing_cells_category_every_zone_key", true],
      ["routing_cells_category_zone_key", true],
      ["routing_cells_product_every_zone_key", true],
      ["routing_cells_product_zone_key", true],
      ["routing_cells_all_zone_key", true],
      ["routing_cells_no_category_every_zone_key", true],
      ["routing_cells_no_category_zone_key", true],
    ]);
  });
});

describe("department name storage", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS],
  });
  async function seedNamedVenue(name: string) {
    await seedVenueSettings(suite.db, {
      name,
      invoiceLocales: ["es"],
    });
    await seedBusinessDay(suite.db, {});
  }
  async function insert(name: string) {
    return withTransaction(suite.db, async (tx) => {
      const [row] = await tx.insert(departments).values({ name, tradingName: name }).returning();
      return row!;
    });
  }
  it("reuses a deleted department name with a new id", async () => {
    await seedTaxpayer(suite.db);
    await seedNamedVenue("Venue");
    const old = await insert("Deli");
    await suite.db.update(departments).set({ active: false }).where(eq(departments.id, old.id));
    const replacement = await insert("Deli");
    expect(replacement.id).not.toBe(old.id);
    expect(await suite.db.select().from(departments).where(eq(departments.id, old.id))).toEqual([
      { ...old, active: false },
    ]);
  });
  it("still refuses two live names in one venue", async () => {
    await seedTaxpayer(suite.db);
    await seedNamedVenue("Venue");
    await insert("Deli");
    await expect(insert("Deli")).rejects.toThrow("UNIQUE constraint failed:");
  });
});

describe("department estimated margin", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS],
  });
  async function insertWithMargin(name: string, estimatedMarginBp: number | null) {
    return withTransaction(suite.db, async (tx) => {
      const [row] = await tx
        .insert(departments)
        .values({ name, tradingName: name, estimatedMarginBp })
        .returning();
      return row!;
    });
  }
  it("takes no margin, 0, 3000 and 10000", async () => {
    await seedTaxpayer(suite.db);
    const stored = [];
    for (const [name, margin] of [
      ["None", null],
      ["Zero", 0],
      ["Typical", 3000],
      ["Whole", 10000],
    ] as const) {
      stored.push((await insertWithMargin(name, margin)).estimatedMarginBp);
    }
    expect(stored).toEqual([null, 0, 3000, 10000]);
  });
  it("refuses a margin below 0 or above 10000 by its constraint", async () => {
    await seedTaxpayer(suite.db);
    await expect(insertWithMargin("Negative", -1)).rejects.toThrow(
      "CHECK constraint failed: departments_estimated_margin_ck",
    );
    await expect(insertWithMargin("Over", 10001)).rejects.toThrow(
      "CHECK constraint failed: departments_estimated_margin_ck",
    );
  });
  it("refuses a fraction of a basis point by its constraint", async () => {
    await seedTaxpayer(suite.db);
    await expect(insertWithMargin("Fraction", 3000.5)).rejects.toThrow(
      "CHECK constraint failed: departments_estimated_margin_ck",
    );
  });
});
