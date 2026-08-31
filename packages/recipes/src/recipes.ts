import { eq } from "drizzle-orm";
import { ingredients, recipeLines } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  applyDietDerivation,
  applyRecipeDerivation,
  mergeAllergenMaps,
  type DietaryOrigin,
  type ProductAllergens,
  type RecipeDerivation,
} from "@waitron/catalogue";
import { CURRENT_TENANT, INGREDIENT_COLUMNS } from "./columns.js";
import type { Ingredient } from "./ingredients.js";

/**
 * Recipe composition and allergen derivation — the flat `recipe_lines` between a product and its
 * ingredients, plus the fold that turns those ingredients' declarations into the product's derived
 * allergen floor.
 *
 * Every function takes a `(tx, …)` and runs under the CALLER's tenant context (the caller opens the
 * transaction with `withTenant`/`asAppUser`), exactly as `ingredients.ts` does: inserts adopt the
 * tenant through `current_tenant_id()` and reads are filtered by the tenant-isolation policy.
 *
 * The `Ingredient` import is TYPE-ONLY (`import type`), so it is erased at compile time and creates
 * no runtime edge back to `ingredients.ts`. `ingredients.ts` value-imports this module's propagation
 * helpers, so the only runtime edge runs ingredients → recipes. `CURRENT_TENANT`/`INGREDIENT_COLUMNS`
 * come from the leaf `./columns.js` (which imports neither file), so sharing them adds no back edge.
 */

/** The ingredients that make up a product (ordered by created_at then id — a stable order, not
 * the order the ids were passed to setProductRecipe: setProductRecipe inserts every line in one
 * batch, so created_at ties on every row and the tiebreak falls to id, a random gen_random_uuid()). */
export async function getProductRecipe(tx: Transaction, productId: string): Promise<Ingredient[]> {
  return tx
    .select(INGREDIENT_COLUMNS)
    .from(recipeLines)
    .innerJoin(ingredients, eq(ingredients.id, recipeLines.ingredientId))
    .where(eq(recipeLines.productId, productId))
    .orderBy(recipeLines.createdAt, recipeLines.id);
}

/** Recompute a product's derived allergen floor from its recipe and republish its declaration.
 * No recipe lines → clears the derivation (null → falls back to the manual overlay). Any unreviewed
 * (allergens = null) ingredient → pending = true (the product publishes PENDING). */
export async function recomputeProductAllergens(tx: Transaction, productId: string): Promise<void> {
  const rows = await tx
    .select({ allergens: ingredients.allergens })
    .from(recipeLines)
    .innerJoin(ingredients, eq(ingredients.id, recipeLines.ingredientId))
    .where(eq(recipeLines.productId, productId));

  if (rows.length === 0) {
    await applyRecipeDerivation(tx, productId, null);
    return;
  }
  let pending = false;
  let floor: ProductAllergens = {};
  for (const row of rows) {
    if (row.allergens === null) pending = true;
    else floor = mergeAllergenMaps(floor, row.allergens);
  }
  const derivation: RecipeDerivation = { allergens: floor, pending };
  await applyRecipeDerivation(tx, productId, derivation);
}

/** Recompute a product's derived DIET floor from its recipe and republish its profile — the diet
 * twin of {@link recomputeProductAllergens}. Folds the ingredients' `dietary_origin` into a
 * deduped+sorted origin set; any uncategorised (dietary_origin = null) ingredient sets `pending`, so
 * the product publishes diet-PENDING (vegan/vegetarian read "unknown") rather than a false "vegan".
 * No recipe lines → clears the derivation (null → the published profile reverts to the override
 * overlaid on the empty derived profile). */
export async function recomputeProductDiet(tx: Transaction, productId: string): Promise<void> {
  const rows = await tx
    .select({ origin: ingredients.dietaryOrigin })
    .from(recipeLines)
    .innerJoin(ingredients, eq(ingredients.id, recipeLines.ingredientId))
    .where(eq(recipeLines.productId, productId));

  if (rows.length === 0) {
    await applyDietDerivation(tx, productId, null);
    return;
  }
  let pending = false;
  const set = new Set<DietaryOrigin>();
  for (const row of rows) {
    if (row.origin === null) pending = true;
    else set.add(row.origin as DietaryOrigin);
  }
  await applyDietDerivation(tx, productId, { origins: [...set].sort(), pending });
}

/** Replace a product's recipe with exactly `ingredientIds`, then recompute its allergens + diet. */
export async function setProductRecipe(
  tx: Transaction,
  productId: string,
  ingredientIds: string[],
): Promise<void> {
  await tx.delete(recipeLines).where(eq(recipeLines.productId, productId));
  if (ingredientIds.length > 0) {
    await tx.insert(recipeLines).values(
      ingredientIds.map((ingredientId) => ({
        tenantId: CURRENT_TENANT,
        productId,
        ingredientId,
      })),
    );
  }
  await recomputeProductAllergens(tx, productId);
  await recomputeProductDiet(tx, productId);
}

/** Every product whose recipe includes the given ingredient — used to propagate an ingredient's
 * allergen change. */
export async function productsUsingIngredient(
  tx: Transaction,
  ingredientId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ productId: recipeLines.productId })
    .from(recipeLines)
    .where(eq(recipeLines.ingredientId, ingredientId));
  return rows.map((r) => r.productId);
}
