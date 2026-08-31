import { eq, sql } from "drizzle-orm";
import { ingredients } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { validateAllergens, type ProductAllergens } from "@waitron/catalogue";
import { CURRENT_TENANT, INGREDIENT_COLUMNS } from "./columns.js";
import {
  productsUsingIngredient,
  recomputeProductAllergens,
  recomputeProductDiet,
} from "./recipes.js";

/**
 * Ingredient operations — CRUD over the `ingredients` table (raw materials / prep items).
 *
 * Every function takes a `(tx, …)` and runs under the CALLER's tenant context: the caller opens the
 * transaction with `withTenant` (and `asAppUser` in the running POS), so writes adopt that tenant
 * through `current_tenant_id()` and reads are filtered to it by the tenant-isolation policy. Nothing
 * here takes a `tenantId` argument — the GUC the caller already set is the single source of it, which
 * also satisfies the table's `WITH CHECK (tenant_id = current_tenant_id())`. Mirrors the
 * `packages/catalogue` operations for the identical reasons.
 *
 * Deactivation is `active = false`, never DELETE: an ingredient may sit behind `recipe_lines`, and
 * the app role holds no DELETE grant on `ingredients` anyway (SELECT/INSERT/UPDATE only). All SQL is
 * built with Drizzle query builders — no string concatenation.
 */

export interface Ingredient {
  id: string;
  name: string;
  /** EU-1169 declaration, or null when not yet reviewed (a PENDING ingredient). */
  allergens: ProductAllergens | null;
  active: boolean;
}

export interface CreateIngredientInput {
  name: string;
  /** Omitted leaves it null (unreviewed); validated against the EU-14 taxonomy on insert. */
  allergens?: ProductAllergens;
}

export interface UpdateIngredientInput {
  name?: string;
  /** `null` clears the declaration back to unreviewed; omitted leaves it unchanged. */
  allergens?: ProductAllergens | null;
  active?: boolean;
}

export async function createIngredient(
  tx: Transaction,
  input: CreateIngredientInput,
): Promise<Ingredient> {
  // Validate before the write: an unreviewed ingredient stores null, a supplied map is checked
  // against the EU-14 taxonomy and rejected (throws `allergen.invalid_code`/`allergen.invalid_presence`)
  // before any row is inserted.
  const allergens = input.allergens === undefined ? null : validateAllergens(input.allergens);
  const [row] = await tx
    .insert(ingredients)
    .values({ tenantId: CURRENT_TENANT, name: input.name, allergens })
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
  // A supplied map is validated before the write; `null` (clear) and `undefined` (leave unchanged)
  // both skip validation. The patch keys map 1:1 to `ingredients` columns, so the spread stays fully
  // typed against `.set()`.
  if (patch.allergens != null) validateAllergens(patch.allergens);
  await tx
    .update(ingredients)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(ingredients.id, id));
  // Propagate only when the allergen declaration actually moved: a rename or an `active` toggle
  // leaves the ingredient's allergens unchanged, so re-deriving dependent products would recompute
  // the identical floor (the fold reads `allergens`, never `name`/`active`) — idempotent, and pure
  // wasted queries. Mirrors updateProduct's "republish only when `allergens` was in the patch" guard.
  // The diet twin is recomputed in the SAME loop: this `UpdateIngredientInput` cannot yet touch
  // `dietary_origin`, so on an allergen-only change the origin set is unchanged and the diet recompute
  // is idempotent — kept beside its allergen twin so the two roll-ups never drift apart. When origin
  // authoring lands (a later task adds `dietaryOrigin` to the patch) it MUST widen this guard so an
  // origin-only edit fans out the diet recompute too — else a product's diet would go stale.
  // Fans out O(N) over the products sharing this ingredient — each recompute is its own SELECT-join
  // plus a republish round-trip. A set-based batched rewrite (one join query → a JS fold → one batched
  // `UPDATE … FROM (VALUES …)`) is a deferred, scale-gated optimization, matching the repo's #76/#87
  // scale-gated-deferral precedent; not worth the complexity at deli scale today.
  if (patch.allergens !== undefined) {
    for (const productId of await productsUsingIngredient(tx, id)) {
      await recomputeProductAllergens(tx, productId);
      await recomputeProductDiet(tx, productId);
    }
  }
}
