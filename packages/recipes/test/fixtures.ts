import { beforeEach } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { asAppUser, withTransaction } from "@waitron/db";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createProduct,
  createUnit,
} from "@waitron/catalogue";
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
  return withTransaction(db, async (tx: Transaction) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, tenantId, { name: "Deli" });
    const unit = await createUnit(
      tx,
      tenantId,
      { name: { en: "each" }, precision: 0, abbreviation: { en: "ea" } },
      "en",
    );
    const p = await createProduct(tx, tenantId, {
      catalogueId: cat.id,
      categoryId: null,
      name: "bocadillo",
      unitId: unit.id,
      unitPrice: "3.50",
      vatClass: "general",
    });
    return p.id;
  });
}

/** Share the migrated database; each ingredient case starts with empty ingredient tables. */
export function useIngredientDb(): { readonly db: Database } {
  const fx = usePgliteDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
  beforeEach(async () => {
    await fx.db.execute(sql`truncate recipe_lines, ingredients`);
  });
  return fx;
}
