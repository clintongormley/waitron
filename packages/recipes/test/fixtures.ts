import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { asAppUser, withTenant } from "@waitron/db";
import { createCatalogue, createProduct } from "@waitron/catalogue";
import { locationId as brandLocationId } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";

export interface SeededVenue {
  tenantId: TenantId;
  locationId: string;
}

// Mirrors packages/catalogue/test/fixtures.ts's seedVenue: tenant + node come off @waitron/db's own
// seeders (they own the NIF counter and the tenants/nodes inserts), this file adds the location db
// has no seeder for. Run as the connection owner (superuser) — RLS is bypassed, so this is pure
// setup. The recipe ingredient tests only read `tenantId`; `locationId` is kept for the product
// seed and for recipe-composition tests in a later slice.
export async function seedVenue(db: Database): Promise<SeededVenue> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Main', array['en-GB'], 'Test op') returning id`);
  const locationId = loc.rows[0]!.id;
  await seedNode(db, tenantId, brandLocationId(locationId));
  return { tenantId, locationId };
}

/** Seed a catalogue + one product; returns the product id, for recipe tests. */
export async function seedProduct(db: Database, tenantId: TenantId): Promise<string> {
  return withTenant(db, tenantId, async (tx: Transaction) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Deli" });
    const p = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: null,
      descriptions: { en: "bocadillo" },
      pricingUnit: "each",
      unitPrice: "3.50",
      vatClass: "general",
    });
    return p.id;
  });
}
