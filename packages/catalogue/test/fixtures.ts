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

export interface SeededVenue {
  tenantId: TenantId;
  locationId: string;
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
}

// Mirrors packages/reporting/test/fixtures.ts's seedVenue: tenant + node come off @waitron/db's own
// seeders (they own the NIF counter and the tenants/nodes inserts), this file adds the
// location/till/series db has no seeder for. Run as the connection owner (superuser) — RLS is
// bypassed, so this is pure setup. Catalogue tests only read `tenantId`/`locationId`, but the full
// shape is kept so a later catalogue test that needs a till or a sale reuses one fixture.
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

/**
 * Seeds one catalogue, two categories ("Food"/"Drinks") and two products (one `each`, one `weight`),
 * then assigns the catalogue to `venue.locationId`. Runs through the operations under test on a `tx`
 * already scoped to a tenant (via `withTenant` + `asAppUser`), so the inserted rows adopt that
 * tenant through `current_tenant_id()`. English test strings only (this package is english-only
 * guarded).
 */
export async function seedCatalogueFixture(
  tx: Transaction,
  venue: { locationId: string },
): Promise<SeededCatalogue> {
  const catalogue = await createCatalogue(tx, { name: "Deli" });
  const food = await createCategory(tx, { name: "Food" });
  const drinks = await createCategory(tx, { name: "Drinks" });
  const slicedHam = await createProduct(tx, {
    catalogueId: catalogue.id,
    categoryId: food.id,
    descriptions: { en: "sliced ham" },
    pricingUnit: "weight",
    unitPrice: "24.90",
    vatClass: "reduced",
  });
  const water = await createProduct(tx, {
    catalogueId: catalogue.id,
    categoryId: drinks.id,
    descriptions: { en: "water" },
    pricingUnit: "each",
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
