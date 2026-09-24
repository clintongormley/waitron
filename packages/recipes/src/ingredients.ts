import { eq } from "drizzle-orm";
import { ingredients, now } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  validateAllergens,
  validateOrigin,
  type DietaryOrigin,
  type ProductAllergens,
} from "@waitron/catalogue";
import { INGREDIENT_COLUMNS } from "./columns.js";
import { productsUsingIngredient, recomputeProductDerivations } from "./recipes.js";

/** Ingredient writes share the caller's transaction. Deactivation preserves recipe references. */

export interface Ingredient {
  id: string;
  name: string;
  /** EU-1169 declaration, or null when not yet reviewed (a PENDING ingredient). */
  allergens: ProductAllergens | null;
  /** The dietary-origin category, or null when uncategorised (makes dependent products diet-PENDING). */
  dietaryOrigin: DietaryOrigin | null;
  active: boolean;
}

export interface CreateIngredientInput {
  name: string;
  /** Omitted leaves it null (unreviewed); validated against the EU-14 taxonomy on insert. */
  allergens?: ProductAllergens;
  /** Omitted leaves it null (uncategorised); a supplied value is validated against `DIETARY_ORIGINS`. */
  dietaryOrigin?: DietaryOrigin | null;
}

export interface UpdateIngredientInput {
  name?: string;
  /** `null` clears the declaration back to unreviewed; omitted leaves it unchanged. */
  allergens?: ProductAllergens | null;
  /** `null` uncategorises the ingredient; omitted leaves it unchanged; a value is validated on write. */
  dietaryOrigin?: DietaryOrigin | null;
  active?: boolean;
}

export async function createIngredient(
  tx: Transaction,
  input: CreateIngredientInput,
): Promise<Ingredient> {
  const allergens = input.allergens === undefined ? null : validateAllergens(input.allergens);
  const dietaryOrigin = input.dietaryOrigin == null ? null : validateOrigin(input.dietaryOrigin);
  const [row] = await tx
    .insert(ingredients)
    .values({ name: input.name, allergens, dietaryOrigin })
    .returning(INGREDIENT_COLUMNS);
  return row!;
}

export async function listIngredients(tx: Transaction): Promise<Ingredient[]> {
  return tx
    .select(INGREDIENT_COLUMNS)
    .from(ingredients)
    .orderBy(ingredients.createdAt, ingredients.id);
}

export async function getIngredient(tx: Transaction, id: string): Promise<Ingredient | null> {
  const [row] = await tx.select(INGREDIENT_COLUMNS).from(ingredients).where(eq(ingredients.id, id));
  return row ?? null;
}

export async function updateIngredient(
  tx: Transaction,
  id: string,
  patch: UpdateIngredientInput,
): Promise<void> {
  // The patch keys map 1:1 to `ingredients` columns, so the spread stays fully typed against `.set()`.
  if (patch.allergens != null) validateAllergens(patch.allergens);
  if (patch.dietaryOrigin != null) validateOrigin(patch.dietaryOrigin);
  await tx
    .update(ingredients)
    .set({ ...patch, updatedAt: now() })
    .where(eq(ingredients.id, id));
  // Propagate only when a derivation input moved: the folds read `allergens`/`dietary_origin`, never
  // `name`/`active`, so a rename or an `active` toggle would recompute the identical floor.
  //
  // Fans out O(N) over the products sharing this ingredient — each recompute is its own SELECT-join
  // plus a republish round-trip. A set-based batched rewrite is a deferred, scale-gated optimization.
  if (patch.allergens !== undefined || patch.dietaryOrigin !== undefined) {
    for (const productId of await productsUsingIngredient(tx, id)) {
      await recomputeProductDerivations(tx, productId);
    }
  }
}
