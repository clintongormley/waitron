import { beforeEach } from "vitest";
import { CORE_MIGRATIONS, ingredients, recipeLines, venueLocationId } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { Database, Transaction } from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { withTransaction } from "@waitron/db";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createProduct,
  createUnit,
} from "@waitron/catalogue";

export interface SeededVenue {
  locationId: string;
}

/** Seeds the taxpayer, the venue and a node. */
export async function seedVenueWithNode(db: Database): Promise<SeededVenue> {
  await seedVenue(db, { name: "Main", invoiceLocales: ["en-GB"], operationDescription: "Test op" });
  await seedNode(db);
  return { locationId: await venueLocationId(db) };
}

/** Seed a catalogue + one product; returns the product id, for recipe tests. */
export async function seedProduct(db: Database): Promise<string> {
  return withTransaction(db, async (tx: Transaction) => {
    const cat = await createCatalogue(tx, { name: "Deli" });
    const unit = await createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "each" },
        precision: 0,
        abbreviation: { en: "ea" },
      },
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
 * Share the migrated database; each ingredient case starts with empty ingredient tables. The lines
 * go first — `recipe_lines` holds the foreign key.
 */
export function useIngredientDb(): { readonly db: Database } {
  const fx = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
  beforeEach(async () => {
    await fx.db.delete(recipeLines);
    await fx.db.delete(ingredients);
  });
  return fx;
}
