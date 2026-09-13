import { beforeEach } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { sql } from "drizzle-orm";
import {
  locationId as brandLocationId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SeriesId, TenantId, TillId } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "../src/operations.js";
import { CATALOGUE_MIGRATIONS } from "../src/migrations.js";
import { createUnit } from "../src/units.js";

export interface SeededVenue {
  tenantId: TenantId;
  locationId: string;
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
}

/** Seed the two legacy product choices with real tenant-scoped unit identities. */
export async function seedLegacySellingUnits(db: Database, tenantId: string): Promise<void> {
  await db.execute(sql`
    insert into units (tenant_id, seed_key, name, precision, hardware_unit) values
      (${tenantId}, 'each', '{"en":"each","fr":"unité"}'::jsonb, 0, null),
      (${tenantId}, 'kg', '{"en":"kg","fr":"kg"}'::jsonb, 3, 'kg')`);
}

export async function seedVenue(db: Database): Promise<SeededVenue> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Main', array['en-GB'], 'Test op') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Till 1') returning id`,
  );
  const tillId = brandTillId(till.rows[0]!.id);
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));
  const series = await db.execute<{ id: string }>(
    sql`insert into invoice_series (tenant_id, node_id, code) values (${tenantId}, ${nodeId}, 'A') returning id`,
  );
  const seriesId = brandSeriesId(series.rows[0]!.id);
  return { tenantId, locationId, tillId, nodeId, seriesId };
}

export interface SeededCatalogue {
  catalogueId: string;
  categoryIds: { food: string; drinks: string };
  /** The `each`-priced product and the `weight`-priced product, keyed by pricing unit. */
  productIds: { each: string; weight: string };
}

export async function seedCatalogueFixture(
  tx: Transaction,
  venue: { tenantId: TenantId; locationId: string },
): Promise<SeededCatalogue> {
  const catalogue = await createCatalogue(tx, venue.tenantId, { name: "Deli" });
  const food = await createCategory(tx, venue.tenantId, { name: { en: "Food" } });
  const drinks = await createCategory(tx, venue.tenantId, { name: { en: "Drinks" } });
  const eachUnitId = (
    await createUnit(tx, venue.tenantId, { name: { en: "each" }, precision: 0 }, "en")
  ).id;
  const kgUnitId = (
    await createUnit(tx, venue.tenantId, { name: { en: "kg" }, precision: 3 }, "en")
  ).id;
  const slicedHam = await createProduct(tx, venue.tenantId, {
    catalogueId: catalogue.id,
    categoryId: food.id,
    descriptions: { en: "sliced ham" },
    unitId: kgUnitId,
    unitPrice: "24.90",
    vatClass: "reduced",
  });
  const water = await createProduct(tx, venue.tenantId, {
    catalogueId: catalogue.id,
    categoryId: drinks.id,
    descriptions: { en: "water" },
    unitId: eachUnitId,
    unitPrice: "1.50",
    vatClass: "general",
  });
  await assignCatalogueToLocation(tx, venue.locationId, catalogue.id);
  return {
    catalogueId: catalogue.id,
    categoryIds: { food: food.id, drinks: drinks.id },
    productIds: { each: water.id, weight: slicedHam.id },
  };
}

/** Share the migrated database; clear authoring rows before each fixture is seeded. */
export function useCatalogueDb(): { readonly db: Database } {
  const fx = usePgliteDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
  beforeEach(async () => {
    // DELETE avoids TRUNCATE CASCADE following catalogue references into locations and immutable
    // sales tables. These tests write mutable authoring rows; venue identity rows can stay.
    await fx.db.transaction(async (tx) => {
      await tx.execute(sql`delete from menu_item_options`);
      await tx.execute(sql`delete from menu_item_option_groups`);
      await tx.execute(sql`delete from menu_items`);
      await tx.execute(sql`delete from menu_sections`);
      await tx.execute(sql`delete from product_option_groups`);
      await tx.execute(sql`delete from product_units`);
      await tx.execute(sql`delete from option_group_items`);
      await tx.execute(sql`delete from option_groups`);
      await tx.execute(sql`delete from products`);
      await tx.execute(sql`delete from categories`);
      await tx.execute(sql`delete from location_catalogues`);
      await tx.execute(sql`update locations set catalogue_id = null`);
      await tx.execute(sql`delete from catalogues`);
    });
  });
  return fx;
}
