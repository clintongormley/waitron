import { eq, sql } from "drizzle-orm";
import { ingredients } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TenantId } from "@waitron/shared";
import {
  validateAllergens,
  validateOrigin,
  type DietaryOrigin,
  type ProductAllergens,
} from "@waitron/catalogue";
import { INGREDIENT_COLUMNS } from "./columns.js";
import { productsUsingIngredient, recomputeProductDerivations } from "./recipes.js";

/** Ingredient writes share the caller's transaction. Deactivation preserves recipe references.
 * All SQL is built with Drizzle query builders — no string concatenation. */

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
  tenantId: TenantId,
  input: CreateIngredientInput,
): Promise<Ingredient> {
  // Validate before the write: an unreviewed ingredient stores null, a supplied map is checked
  // against the EU-14 taxonomy and rejected (throws `allergen.invalid_code`/`allergen.invalid_presence`)
  // before any row is inserted.
  const allergens = input.allergens === undefined ? null : validateAllergens(input.allergens);
  // A supplied origin is validated against `DIETARY_ORIGINS` (throws `diet.invalid_origin`); omitted
  // and `null` both store null (uncategorised), which makes dependent products publish diet-PENDING.
  const dietaryOrigin = input.dietaryOrigin == null ? null : validateOrigin(input.dietaryOrigin);
  const [row] = await tx
    .insert(ingredients)
    .values({ tenantId, name: input.name, allergens, dietaryOrigin })
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
  // A supplied allergen map / origin is validated before the write; `null` (clear) and `undefined`
  // (leave unchanged) both skip validation. `validateOrigin` throws `diet.invalid_origin` on a value
  // outside `DIETARY_ORIGINS`; `null` is a legal uncategorise. The patch keys map 1:1 to `ingredients`
  // columns, so the spread stays fully typed against `.set()`.
  if (patch.allergens != null) validateAllergens(patch.allergens);
  if (patch.dietaryOrigin != null) validateOrigin(patch.dietaryOrigin);
  await tx
    .update(ingredients)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(ingredients.id, id));
  // Propagate only when a derivation input actually moved: a rename or an `active` toggle leaves both
  // the ingredient's allergens AND its dietary origin unchanged, so re-deriving dependent products
  // would recompute the identical floor (the folds read `allergens`/`dietary_origin`, never
  // `name`/`active`) — idempotent, and pure wasted queries. Mirrors updateProduct's "republish only
  // when the relevant field was in the patch" guard.
  //
  // The gate fires when EITHER the allergen declaration OR the dietary origin was in the patch, and
  // both roll-ups run from the SAME recipe read (`recomputeProductDerivations`) so they never drift
  // apart. An origin-only edit (no `allergens` key) must still re-derive the diet, or a product's diet
  // goes stale — the gap the earlier allergen-only guard left, closed here (see recipes.test.ts's
  // origin-only fan-out test, proven by deletion). Recomputing both on either change is a cheap,
  // always-correct idempotency.
  //
  // Fans out O(N) over the products sharing this ingredient — each recompute is its own SELECT-join
  // plus a republish round-trip. A set-based batched rewrite (one join query → a JS fold → one batched
  // `UPDATE … FROM (VALUES …)`) is a deferred, scale-gated optimization, matching the repo's #76/#87
  // scale-gated-deferral precedent; not worth the complexity at deli scale today.
  if (patch.allergens !== undefined || patch.dietaryOrigin !== undefined) {
    for (const productId of await productsUsingIngredient(tx, id)) {
      await recomputeProductDerivations(tx, productId);
    }
  }
}
