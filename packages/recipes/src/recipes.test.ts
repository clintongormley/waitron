import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, products, withTenant } from "@waitron/db";
import { eq } from "drizzle-orm";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
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
