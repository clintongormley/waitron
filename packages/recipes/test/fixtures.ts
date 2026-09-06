import { afterEach, beforeEach } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
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

// Seed tenant, location and node as the connection owner.
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
    const cat = await createCatalogue(tx, tenantId, { name: "Deli" });
    const p = await createProduct(tx, tenantId, {
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

/** Each case gets its own database so unfiltered ingredient reads see only that case's fixture. */
export function useIngredientDb(): { readonly db: Database } {
  let db: Database | undefined;
  beforeEach(async () => {
    db = await createPgliteDb();
    await runMigrations(db, CORE_MIGRATIONS);
  });
  afterEach(async () => {
    const started = db;
    db = undefined;
    if (started !== undefined) await started.close();
  });
  return {
    get db() {
      if (db === undefined) throw new Error("ingredient database is not started");
      return db;
    },
  };
}
