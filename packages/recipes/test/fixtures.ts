import { beforeEach } from "vitest";
import { CORE_MIGRATIONS, ingredients, locations, recipeLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { Database, Transaction } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { withTransaction } from "@waitron/db";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createProduct,
  createUnit,
} from "@waitron/catalogue";
import { locationId as brandLocationId } from "@waitron/shared";

export interface SeededVenue {
  locationId: string;
}

/**
 * Seed tenant, location and node.
 *
 * The location goes in through the drizzle table rather than a hand-written `insert`: `id` is
 * generated in JavaScript now (`$defaultFn`, not a SQL default), so a raw insert that omits it
 * reaches a NOT NULL column with nothing in it, and `invoice_locales` is a JSON array in a text
 * column rather than a PostgreSQL array, so `array['en-GB']` has no meaning here. Going through the
 * table gets both from the column vocabulary instead of restating them.
 */
export async function seedVenue(db: Database): Promise<SeededVenue> {
  await seedTenant(db);
  const [loc] = await db
    .insert(locations)
    .values({ name: "Main", invoiceLocales: ["en-GB"], operationDescription: "Test op" })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  await seedNode(db, brandLocationId(locationId));
  return { locationId };
}

/** Seed a catalogue + one product; returns the product id, for recipe tests. */
export async function seedProduct(db: Database): Promise<string> {
  return withTransaction(db, async (tx: Transaction) => {
    const cat = await createCatalogue(tx, { name: "Deli" });
    const unit = await createUnit(
      tx,
      { name: { en: "each" }, precision: 0, abbreviation: { en: "ea" } },
      "en",
    );
    const p = await createProduct(tx, {
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

/**
 * Share the migrated database; each ingredient case starts with empty ingredient tables.
 *
 * Two `delete`s rather than one `truncate`: SQLite has no TRUNCATE statement at all
 * (`near "truncate": syntax error`). The lines go first and the ingredients second, which is the
 * order the `truncate` named them in — `recipe_lines` holds the foreign key.
 */
export function useIngredientDb(): { readonly db: Database } {
  const fx = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
  beforeEach(async () => {
    await fx.db.delete(recipeLines);
    await fx.db.delete(ingredients);
  });
  return fx;
}
