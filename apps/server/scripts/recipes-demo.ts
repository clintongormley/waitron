// Shows ingredient allergen declarations flowing onto a product through its recipe, in a throwaway
// venue directory: the derived floor unions with the product's manual overlay (add-only), and one
// unreviewed ingredient makes the whole product PENDING. Each step's published `products.allergens`
// is checked, and a mismatch throws.
//
// The story (design D4 — floor ∪ manual, add-only, with PENDING contagion):
//   3. setProductRecipe(bocadillo, [alioli, pan])            → {eggs, gluten}         (inherited floor)
//   4. updateProduct(bocadillo, { may_contain nuts })        → {eggs, gluten, nuts}   (floor ∪ manual)
//   5. setProductRecipe(bocadillo, [alioli, pan, misterio])  → null                   (PENDING contagion)
//   6. updateIngredient(misterio, { contains fish })         → not null, republished  (propagation)
//
// `apps/*` is out of the english-only guard's scope, so the Spanish names (alioli, pan, misterio,
// bocadillo) are fine here.
//
// Run it: pnpm --filter @waitron/server demo:recipes
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

/** The published column the till sells from. */
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
    .map(([code, d]) => `${code}: ${d.presence}${d.source === undefined ? "" : ` (${d.source})`}`);
  return `{ ${parts.join(", ")} }`;
}

function codes(a: ProductAllergens | null): string[] {
  return a === null ? ["<pending>"] : Object.keys(a).sort((x, y) => x.localeCompare(y));
}

function expect(actual: ProductAllergens | null, expected: string[]): void {
  console.log(`  products.allergens = ${format(actual)}`);
  console.log(`  expected codes     = { ${expected.join(", ")} }`);
  const got = codes(actual);
  const want = [...expected].sort((x, y) => x.localeCompare(y));
  const ok = got.length === want.length && got.every((c, i) => c === want[i]);
  console.log(`  ${ok ? "OK" : "MISMATCH"}`);
  if (!ok) {
    throw new Error(`recipes-demo: expected { ${want.join(", ")} }, got { ${got.join(", ")} }`);
  }
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
        allergens: { eggs: { presence: "contains" } },
      });
      const pan = await createIngredient(tx, {
        name: "pan",
        allergens: { gluten: { presence: "contains", source: "wheat" } },
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
      expect(await readPublished(tx, bocadillo.id), ["eggs", "gluten"]);
      console.log("");

      // Step 4 — a manual declaration unions with the derived floor; it never subtracts.
      console.log(
        'Step 4 — updateProduct(bocadillo, { allergens: "may_contain nuts (shared slicer)" })',
      );
      await updateProduct(tx, bocadillo.id, {
        allergens: { nuts: { presence: "may_contain", source: "shared slicer" } },
      });
      expect(await readPublished(tx, bocadillo.id), ["eggs", "gluten", "nuts"]);
      console.log("");

      // Step 5 — one unreviewed ingredient makes the product PENDING; the manual `nuts` does not
      // rescue it.
      console.log(
        "Step 5 — setProductRecipe(bocadillo, [alioli, pan, misterio])  → PENDING contagion",
      );
      await setProductRecipe(tx, bocadillo.id, [alioli.id, pan.id, misterio.id]);
      expect(await readPublished(tx, bocadillo.id), ["<pending>"]);
      console.log("");

      // Step 6 — reviewing the ingredient republishes every product whose recipe uses it.
      console.log(
        "Step 6 — updateIngredient(misterio, { allergens: { contains fish } })  → propagation",
      );
      await updateIngredient(tx, misterio.id, {
        allergens: { fish: { presence: "contains" } },
      });
      expect(await readPublished(tx, bocadillo.id), ["eggs", "fish", "gluten", "nuts"]);
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
