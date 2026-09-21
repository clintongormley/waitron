import { beforeEach } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import {
  locationId as brandLocationId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SeriesId, TillId } from "@waitron/shared";
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
  locationId: string;
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
}

/** Seed the two legacy product choices with real unit identities. */
export async function seedLegacySellingUnits(db: Database): Promise<void> {
  await db.execute(sql`
    insert into units (seed_key, name, abbreviation, precision, hardware_unit) values
      ('each', '{"en":"each","fr":"unité"}'::jsonb, '{"en":"ea","fr":"u"}'::jsonb, 0, null),
      ('kg', '{"en":"kg","fr":"kg"}'::jsonb, '{"en":"kg","fr":"kg"}'::jsonb, 3, 'kg')`);
}

export async function seedVenue(db: Database): Promise<SeededVenue> {
  await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (name, invoice_locales, operation_description) values ('Main', array['en-GB'], 'Test op') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(
    sql`insert into tills (location_id, name) values (${locationId}, 'Till 1') returning id`,
  );
  const tillId = brandTillId(till.rows[0]!.id);
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const series = await db.execute<{ id: string }>(
    sql`insert into invoice_series (node_id, code) values (${nodeId}, 'A') returning id`,
  );
  const seriesId = brandSeriesId(series.rows[0]!.id);
  return { locationId, tillId, nodeId, seriesId };
}

export interface SeededCatalogue {
  catalogueId: string;
  categoryIds: { food: string; drinks: string };
  /** The `each`-priced product and the `weight`-priced product, keyed by pricing unit. */
  productIds: { each: string; weight: string };
}

export async function seedCatalogueFixture(
  tx: Transaction,
  venue: { locationId: string },
): Promise<SeededCatalogue> {
  const catalogue = await createCatalogue(tx, { name: "Deli" });
  const food = await createCategory(tx, { name: { en: "Food" } });
  const drinks = await createCategory(tx, { name: { en: "Drinks" } });
  const eachUnitId = (
    await createUnit(tx, { name: { en: "each" }, precision: 0, abbreviation: { en: "ea" } }, "en")
  ).id;
  const kgUnitId = (
    await createUnit(tx, { name: { en: "kg" }, precision: 3, abbreviation: { en: "kg" } }, "en")
  ).id;
  const slicedHam = await createProduct(tx, {
    catalogueId: catalogue.id,
    categoryId: food.id,
    name: "sliced ham",
    unitId: kgUnitId,
    unitPrice: "24.90",
    vatClass: "reduced",
  });
  const water = await createProduct(tx, {
    catalogueId: catalogue.id,
    categoryId: drinks.id,
    name: "water",
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
  const fx = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
  beforeEach(async () => {
    // DELETE avoids TRUNCATE CASCADE following catalogue references into locations and immutable
    // sales tables. These tests write mutable authoring rows; venue identity rows can stay.
    await fx.db.transaction(async (tx) => {
      await tx.execute(sql`delete from menu_item_variants`);
      await tx.execute(sql`delete from menu_items`);
      await tx.execute(sql`delete from product_variants`);
      await tx.execute(sql`delete from menu_sections`);
      await tx.execute(sql`delete from product_units`);
      await tx.execute(sql`delete from products`);
      await tx.execute(sql`delete from categories`);
      await tx.execute(sql`delete from location_catalogues`);
      await tx.execute(sql`update locations set catalogue_id = null`);
      await tx.execute(sql`delete from catalogues`);
    });
  });
  return fx;
}
