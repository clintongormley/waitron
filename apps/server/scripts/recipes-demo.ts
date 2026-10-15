// Shows ingredient allergen declarations flowing onto a product through its recipe, in a throwaway
// venue directory: the derived floor unions with the product's manual overlay (add-only), and one
// unreviewed ingredient makes the whole product PENDING. Each step's published `products.allergens`
// is checked, and a mismatch throws.
//
// Run it: pnpm --filter @waitron/server demo:recipes
import { deepStrictEqual } from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openVenueDatabase, products, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createCatalogue, createProduct, updateProduct } from "@waitron/catalogue";
import type { ProductAllergens } from "@waitron/catalogue";
import { createIngredient, setProductRecipe, updateIngredient } from "@waitron/recipes";

const SETS = ["core", "catalogue"];

async function readPublished(tx: Transaction, productId: string): Promise<ProductAllergens | null> {
  const [row] = await tx
    .select({ allergens: products.allergens })
    .from(products)
    .where(eq(products.id, productId));
  return row?.allergens ?? null;
}

function format(a: ProductAllergens | null): string {
  if (a === null) return "PENDING (null)";
  const parts = Object.entries(a)
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([code, d]) => `${code}${d.kinds === undefined ? "" : ` (${d.kinds.join(", ")})`}`);
  return `{ ${parts.join(", ")} }`;
}

function expect(actual: ProductAllergens | null, expected: ProductAllergens | null): void {
  console.log(`  products.allergens = ${format(actual)}`);
  console.log(`  expected           = ${format(expected)}`);
  deepStrictEqual(actual, expected);
  console.log("  OK");
}

async function main(): Promise<void> {
  const venueDir = await mkdtemp(join(tmpdir(), "recipes-demo-"));
  const sets = manifestSets().filter((set) => SETS.includes(set.name));
  await applyMigrations(venueDir, migrationOptionsFor(sets, null));
  const store = await openVenueDatabase(venueDir);
  try {
    await withTransaction(store.venue, async (tx) => {
      console.log("recipes-demo: allergen inheritance from ingredients to a product, end-to-end");
      console.log("");

      // Step 1 — two reviewed ingredients and one unreviewed, which makes the product PENDING in step 5.
      const alioli = await createIngredient(tx, {
        name: "alioli",
        allergens: { eggs: {} },
      });
      const pan = await createIngredient(tx, {
        name: "pan",
        allergens: { gluten: { kinds: ["wheat"] } },
      });
      const misterio = await createIngredient(tx, { name: "misterio" }); // allergens omitted → null

      console.log("Step 1 — ingredients (raw materials):");
      console.log(`  alioli   → ${format(alioli.allergens)}`);
      console.log(`  pan      → ${format(pan.allergens)}`);
      console.log(`  misterio → ${format(misterio.allergens)}  (unreviewed on purpose)`);
      console.log("");

      // Step 2 — a product with no manual allergens of its own.
      const cat = await createCatalogue(tx, { name: "Delicatessen" });
      const bocadillo = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "bocadillo",
        pricingUnit: "each",
        unitPrice: "5.50",
        vatClass: "reduced",
      });
      console.log(`Step 2 — product "bocadillo" created with no manual allergens`);
      console.log(`  ${format(bocadillo.allergens)}`);
      console.log("");

      // Step 3 — a recipe of the two reviewed ingredients: the derived floor.
      console.log("Step 3 — setProductRecipe(bocadillo, [alioli, pan])  → inherited floor");
      await setProductRecipe(tx, bocadillo.id, [alioli.id, pan.id]);
      expect(await readPublished(tx, bocadillo.id), { eggs: {}, gluten: { kinds: ["wheat"] } });
      console.log("");

      // Step 4 — a manual declaration unions with the derived floor; it never subtracts.
      console.log(
        'Step 4 — updateProduct(bocadillo, { allergens: "nuts (almonds) (shared slicer)" })',
      );
      await updateProduct(tx, bocadillo.id, {
        allergens: { nuts: { kinds: ["almonds"] } },
      });
      expect(await readPublished(tx, bocadillo.id), {
        eggs: {},
        gluten: { kinds: ["wheat"] },
        nuts: { kinds: ["almonds"] },
      });
      console.log("");

      // Step 5 — one unreviewed ingredient makes the product PENDING; the manual `nuts` does not
      // rescue it.
      console.log(
        "Step 5 — setProductRecipe(bocadillo, [alioli, pan, misterio])  → PENDING contagion",
      );
      await setProductRecipe(tx, bocadillo.id, [alioli.id, pan.id, misterio.id]);
      expect(await readPublished(tx, bocadillo.id), null);
      console.log("");

      // Step 6 — reviewing the ingredient republishes every product whose recipe uses it.
      console.log("Step 6 — updateIngredient(misterio, { allergens: { fish } })  → propagation");
      await updateIngredient(tx, misterio.id, {
        allergens: { fish: {} },
      });
      expect(await readPublished(tx, bocadillo.id), {
        eggs: {},
        fish: {},
        gluten: { kinds: ["wheat"] },
        nuts: { kinds: ["almonds"] },
      });
      console.log("");

      console.log(
        "recipes-demo: all six steps matched — allergen inheritance is end-to-end green.",
      );
    });
  } finally {
    await store.close();
    await rm(venueDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error("recipes-demo: failed");
  console.error(error);
  process.exit(1);
});
