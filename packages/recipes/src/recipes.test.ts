import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, ingredients, products, withTenant } from "@waitron/db";
import { eq } from "drizzle-orm";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
import type { DietaryOrigin } from "@waitron/catalogue";
import { createIngredient, updateIngredient } from "./ingredients.js";
import { getProductRecipe, setProductRecipe } from "./recipes.js";
import { seedProduct, seedVenue } from "../test/fixtures.js";

const fx = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

async function publishedAllergens(tenantId: TenantId, productId: string) {
  return withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const [row] = await tx
      .select({ a: products.allergens })
      .from(products)
      .where(eq(products.id, productId));
    return row!.a;
  });
}

describe("recipe composition and allergen derivation", () => {
  let tenantId: TenantId;
  let productId: string;
  beforeEach(async () => {
    ({ tenantId } = await seedVenue(fx.db));
    productId = await seedProduct(fx.db, tenantId);
  });

  it("derives a product's allergens from its ingredients (the alioli scenario)", async () => {
    const published = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const alioli = await createIngredient(tx, {
        name: "alioli",
        allergens: { eggs: { presence: "contains" } },
      });
      const bread = await createIngredient(tx, {
        name: "bread",
        allergens: { gluten: { presence: "contains" } },
      });
      await setProductRecipe(tx, productId, [alioli.id, bread.id]);
      const [row] = await tx
        .select({ a: products.allergens })
        .from(products)
        .where(eq(products.id, productId));
      return row!.a;
    });
    expect(published).toEqual({ eggs: { presence: "contains" }, gluten: { presence: "contains" } });
  });

  it("keeps a product PENDING (null) when an ingredient is unreviewed", async () => {
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const mystery = await createIngredient(tx, { name: "mystery" }); // allergens null → PENDING
      await setProductRecipe(tx, productId, [mystery.id]);
    });
    expect(await publishedAllergens(tenantId, productId)).toBeNull();
  });

  it("propagates an ingredient's allergen change to every product using it", async () => {
    const before = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const alioli = await createIngredient(tx, { name: "alioli" }); // unreviewed
      await setProductRecipe(tx, productId, [alioli.id]);
      const [r] = await tx
        .select({ a: products.allergens })
        .from(products)
        .where(eq(products.id, productId));
      // tag alioli AFTER it is already in the recipe:
      await updateIngredient(tx, alioli.id, { allergens: { eggs: { presence: "contains" } } });
      return r!.a;
    });
    expect(before).toBeNull(); // was PENDING before the ingredient was tagged
    expect(await publishedAllergens(tenantId, productId)).toEqual({
      eggs: { presence: "contains" },
    });
  });

  it("clearing the recipe drops back to the manual overlay", async () => {
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const egg = await createIngredient(tx, {
        name: "egg",
        allergens: { eggs: { presence: "contains" } },
      });
      await setProductRecipe(tx, productId, [egg.id]);
      await setProductRecipe(tx, productId, []); // clear
    });
    // seedProduct created the product with no manual allergens → PENDING again.
    expect(await publishedAllergens(tenantId, productId)).toBeNull();
  });

  // The diet roll-up mirrors the allergen roll-up: PGlite is enough here — the fold only reads
  // `ingredients.dietary_origin` rows and writes `products.diet_derivation`/`diet`, no privilege or
  // concurrency behaviour, which is proven on real Postgres for RLS in the .rls suites.
  it("recomputeProductDerivations (diet): an uncategorised ingredient makes the product diet-pending", async () => {
    const row = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      // one plant ingredient (categorised) + one NULL-origin ingredient (uncategorised)
      const spinach = await createIngredient(tx, { name: "spinach" });
      await tx
        .update(ingredients)
        .set({ dietaryOrigin: "plant" satisfies DietaryOrigin })
        .where(eq(ingredients.id, spinach.id));
      const mystery = await createIngredient(tx, { name: "mystery" }); // dietary_origin null
      await setProductRecipe(tx, productId, [spinach.id, mystery.id]);
      const [r] = await tx
        .select({ diet: products.diet, deriv: products.dietDerivation })
        .from(products)
        .where(eq(products.id, productId));
      return r!;
    });
    expect(row.deriv).toEqual({ origins: ["plant"], pending: true });
    expect(row.diet).toMatchObject({ vegan: "unknown", vegetarian: "unknown" });
  });

  // Task 8/simplify merged the allergen and diet roll-ups into one fold over one recipe read
  // (`recomputeProductDerivations`). Pin that the two `pending` flags it writes stay independent:
  // an ingredient can be allergen-REVIEWED (allergens: {}) while its origin is still uncategorised
  // (dietaryOrigin omitted → null), and that must publish allergen-pending false / diet-pending true
  // — not let one column's "reviewed" state bleed into the other's.
  it("recomputeProductDerivations: allergen-pending and diet-pending are independent", async () => {
    const row = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const reviewed = await createIngredient(tx, {
        name: "reviewed-uncategorised",
        allergens: {},
      });
      await setProductRecipe(tx, productId, [reviewed.id]);
      const [r] = await tx
        .select({ recipeDeriv: products.recipeDerivation, dietDeriv: products.dietDerivation })
        .from(products)
        .where(eq(products.id, productId));
      return r!;
    });
    expect(row.recipeDeriv).toEqual({ allergens: {}, pending: false });
    expect(row.dietDeriv).toEqual({ origins: [], pending: true });
  });

  it("recomputeProductDerivations (diet): all-plant reviewed → vegan", async () => {
    const row = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const spinach = await createIngredient(tx, { name: "spinach" });
      await tx
        .update(ingredients)
        .set({ dietaryOrigin: "plant" satisfies DietaryOrigin })
        .where(eq(ingredients.id, spinach.id));
      await setProductRecipe(tx, productId, [spinach.id]);
      const [r] = await tx
        .select({ diet: products.diet })
        .from(products)
        .where(eq(products.id, productId));
      return r!;
    });
    expect(row.diet).toMatchObject({ vegan: "yes", vegetarian: "yes", contains: [] });
  });

  it("recomputeProductDerivations (diet): a multi-origin recipe stores origins SORTED (via the fold, not just applyDietDerivation)", async () => {
    const row = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      // Insert in an order that is NOT already sorted (meat before dairy) so a missing sort shows.
      const beef = await createIngredient(tx, { name: "beef" });
      await tx
        .update(ingredients)
        .set({ dietaryOrigin: "meat" satisfies DietaryOrigin })
        .where(eq(ingredients.id, beef.id));
      const milk = await createIngredient(tx, { name: "milk" });
      await tx
        .update(ingredients)
        .set({ dietaryOrigin: "dairy" satisfies DietaryOrigin })
        .where(eq(ingredients.id, milk.id));
      await setProductRecipe(tx, productId, [beef.id, milk.id]);
      const [r] = await tx
        .select({ deriv: products.dietDerivation })
        .from(products)
        .where(eq(products.id, productId));
      return r!.deriv;
    });
    expect(row).toEqual({ origins: ["dairy", "meat"], pending: false });
  });

  it("recomputeProductDerivations (diet): clearing the recipe resets the derivation to null", async () => {
    const cleared = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const beef = await createIngredient(tx, { name: "beef" });
      await tx
        .update(ingredients)
        .set({ dietaryOrigin: "meat" satisfies DietaryOrigin })
        .where(eq(ingredients.id, beef.id));
      await setProductRecipe(tx, productId, [beef.id]);
      await setProductRecipe(tx, productId, []); // clear
      const [r] = await tx
        .select({ deriv: products.dietDerivation })
        .from(products)
        .where(eq(products.id, productId));
      return r!.deriv;
    });
    expect(cleared).toBeNull();
  });

  it("propagates an ingredient allergen change and re-derives the product diet", async () => {
    const diet = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const spinach = await createIngredient(tx, { name: "spinach" });
      await tx
        .update(ingredients)
        .set({ dietaryOrigin: "plant" satisfies DietaryOrigin })
        .where(eq(ingredients.id, spinach.id));
      await setProductRecipe(tx, productId, [spinach.id]);
      // An allergen edit fans out over the products using this ingredient; the diet twin recomputes
      // alongside the allergen roll-up in the same loop (idempotent here — the origin is unchanged).
      await updateIngredient(tx, spinach.id, { allergens: {} });
      const [r] = await tx
        .select({ diet: products.diet })
        .from(products)
        .where(eq(products.id, productId));
      return r!.diet;
    });
    expect(diet).toMatchObject({ vegan: "yes", vegetarian: "yes" });
  });

  // THE gate test (Task 8a): an ORIGIN-ONLY ingredient edit — no allergen change — must fan out and
  // re-derive the product's diet. Proves the widened fan-out guard: with the guard still gated on
  // `patch.allergens !== undefined` alone this fails (the product stays vegan); widened to fire on
  // `patch.dietaryOrigin !== undefined` too it passes.
  it("propagates an ORIGIN-ONLY ingredient edit and re-derives the product diet", async () => {
    const diet = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const tofu = await createIngredient(tx, { name: "tofu", dietaryOrigin: "plant" });
      await setProductRecipe(tx, productId, [tofu.id]);
      // Origin-only edit: no `allergens` key in the patch at all.
      await updateIngredient(tx, tofu.id, { dietaryOrigin: "meat" });
      const [r] = await tx
        .select({ diet: products.diet })
        .from(products)
        .where(eq(products.id, productId));
      return r!.diet;
    });
    expect(diet).toMatchObject({ vegan: "no", vegetarian: "no", contains: ["meat"] });
  });

  it("getProductRecipe returns the ingredient list", async () => {
    const recipe = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const a = await createIngredient(tx, { name: "a", allergens: {} });
      const b = await createIngredient(tx, { name: "b", allergens: {} });
      await setProductRecipe(tx, productId, [a.id, b.id]);
      return getProductRecipe(tx, productId);
    });
    expect(recipe.map((i) => i.name).sort()).toEqual(["a", "b"]);
  });
});
