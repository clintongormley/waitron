import { eq } from "drizzle-orm";
import { ingredients, recipeLines } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TenantId } from "@waitron/shared";
import {
  applyDietDerivation,
  applyRecipeDerivation,
  mergeAllergenMaps,
  type DietaryOrigin,
  type ProductAllergens,
  type RecipeDerivation,
} from "@waitron/catalogue";
import { INGREDIENT_COLUMNS } from "./columns.js";
import type { Ingredient } from "./ingredients.js";

/** Recipe changes and their derived allergen and diet values share the caller's transaction. */

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

/** Recompute BOTH a product's derived allergen floor and its derived DIET floor from its recipe, and
 * republish each, from a SINGLE recipe read. The allergen and diet folds are independent but read the
 * same `recipe_lines ⋈ ingredients` rows, so running one join and folding both accumulators in one
 * pass gives byte-for-byte the same two derivations the separate reads did — with one round-trip
 * instead of two. It is always safe to recompute both together: every caller that changes a recipe or
 * a derivation input (`setProductRecipe`, the ingredient fan-out) needs both refreshed.
 *
 * Allergens: no recipe lines → clears the derivation (null → falls back to the manual overlay); any
 * unreviewed (allergens = null) ingredient → allergen pending = true (publishes PENDING).
 * Diet: folds the ingredients' `dietary_origin` into a deduped+sorted origin set; any uncategorised
 * (dietary_origin = null) ingredient sets diet pending, so the product publishes diet-PENDING
 * (vegan/vegetarian read "unknown") rather than a false "vegan"; no recipe lines → clears the
 * derivation (null → the published profile reverts to the override overlaid on the empty profile).
 * The two `pending` flags are computed independently, exactly as the two separate reads did. */
export async function recomputeProductDerivations(
  tx: Transaction,
  productId: string,
): Promise<void> {
  const rows = await tx
    .select({ allergens: ingredients.allergens, origin: ingredients.dietaryOrigin })
    .from(recipeLines)
    .innerJoin(ingredients, eq(ingredients.id, recipeLines.ingredientId))
    .where(eq(recipeLines.productId, productId));

  if (rows.length === 0) {
    // Empty recipe: clear BOTH derivations to null, exactly as each separate recompute did.
    await applyRecipeDerivation(tx, productId, null);
    await applyDietDerivation(tx, productId, null);
    return;
  }
  let allergenPending = false;
  let floor: ProductAllergens = {};
  let dietPending = false;
  const set = new Set<DietaryOrigin>();
  for (const row of rows) {
    if (row.allergens === null) allergenPending = true;
    else floor = mergeAllergenMaps(floor, row.allergens);
    if (row.origin === null) dietPending = true;
    else set.add(row.origin as DietaryOrigin);
  }
  const derivation: RecipeDerivation = { allergens: floor, pending: allergenPending };
  await applyRecipeDerivation(tx, productId, derivation);
  await applyDietDerivation(tx, productId, { origins: [...set].sort(), pending: dietPending });
}

/** Replace a product's recipe with exactly `ingredientIds`, then recompute its allergens + diet. */
export async function setProductRecipe(
  tx: Transaction,
  tenantId: TenantId,
  productId: string,
  ingredientIds: string[],
): Promise<void> {
  await tx.delete(recipeLines).where(eq(recipeLines.productId, productId));
  if (ingredientIds.length > 0) {
    await tx.insert(recipeLines).values(
      ingredientIds.map((ingredientId) => ({
        tenantId,
        productId,
        ingredientId,
      })),
    );
  }
  await recomputeProductDerivations(tx, productId);
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
