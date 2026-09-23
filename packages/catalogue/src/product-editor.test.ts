import { beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { products, withTransaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { createCatalogue, listProducts } from "./operations.js";
import { readProductEditor, saveProductEditor, type ProductEditorInput } from "./product-editor.js";
import { createUnit } from "./units.js";
import { createCategory } from "./categories.js";
import { createExtraList } from "./extras.js";
import { createOptionList } from "./options.js";
import { useCatalogueDb } from "../test/fixtures.js";

const fx = useCatalogueDb();
let catalogueId: string;
let input: ProductEditorInput;
beforeEach(async () => {
  await seedTenant(fx.db);
  const setup = await withTransaction(fx.db, async (tx) => ({
    catalogue: await createCatalogue(tx, { name: "Menu" }),
    unit: await createUnit(
      tx,
      { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
      "en",
    ),
  }));
  catalogueId = setup.catalogue.id;
  input = {
    name: "Coffee",
    customerName: { en: "Coffee", es: "Café" },
    // A non-default value so the canonical save/read round-trip proves sold_alone is actually persisted.
    soldAlone: false,
    description: { en: "Freshly roasted" },
    kitchenName: "BAR COFFEE",
    unitId: setup.unit.id,
    unitPrice: "9.00",
    active: true,
    available: false,
    vatClass: "reduced",
    image: null,
    variants: [
      {
        name: "Small",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "2.00",
        available: true,
      },
      {
        name: "Large",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "3.00",
        available: true,
      },
    ],
    categoryIds: [],
    primaryCategoryId: null,
    modifiers: [],
    allergens: null,
    dietaryDeclarations: ["vegan"],
  };
});

it("reads a product with no unit as unitId null", async () => {
  const saved = await withTransaction(fx.db, (tx) =>
    saveProductEditor(tx, null, catalogueId, input, "en"),
  );
  // `execute` is synchronous on this engine and hands back rows rather than a promise of them
  // (`packages/store/src/node-sqlite-adapter.ts`), so the value is wrapped for a caller whose
  // parameter is typed as a promise.
  await withTransaction(fx.db, (tx) =>
    Promise.resolve(tx.execute(sql`delete from product_units where product_id = ${saved.id}`)),
  );
  const value = await withTransaction(fx.db, (tx) => readProductEditor(tx, saved.id));
  expect(value.unitId).toBeNull();
});

it("saves and reads the canonical editor shape with independent content and variants", async () => {
  const saved = await withTransaction(fx.db, (tx) =>
    saveProductEditor(tx, null, catalogueId, input, "en"),
  );
  expect(saved).toEqual({
    ...input,
    id: saved.id,
    variants: input.variants.map((v, i) => ({ ...v, id: saved.variants[i]!.id, active: true })),
    stationId: null,
    courseId: null,
  });
  expect(await withTransaction(fx.db, (tx) => readProductEditor(tx, saved.id))).toEqual(saved);
  const updated = await withTransaction(fx.db, (tx) =>
    saveProductEditor(
      tx,
      saved.id,
      catalogueId,
      {
        ...saved,
        description: null,
        kitchenName: " ",
        available: true,
        allergens: {},
        dietaryDeclarations: [],
      },
      "en",
    ),
  );
  expect(updated).toEqual({
    ...saved,
    description: null,
    kitchenName: null,
    available: true,
    allergens: {},
    dietaryDeclarations: [],
  });
});

it("saves a product with exactly one variant, or none", async () => {
  // Spec §15.1: one variant is allowed; there is no "Regular" variant to make up a second.
  const one = await withTransaction(fx.db, (tx) =>
    saveProductEditor(tx, null, catalogueId, { ...input, variants: [input.variants[0]!] }, "en"),
  );
  expect(one.variants).toEqual([{ ...input.variants[0]!, id: expect.any(String), active: true }]);
  expect(
    (await withTransaction(fx.db, (tx) => listProducts(tx, catalogueId))).map((p) => p.id),
  ).toEqual([one.id]);
  const none = await withTransaction(fx.db, (tx) =>
    saveProductEditor(tx, null, catalogueId, { ...input, variants: [] }, "en"),
  );
  expect(none.variants).toEqual([]);
});

it("changes the product's unit on update", async () => {
  const saved = await withTransaction(fx.db, (tx) =>
    saveProductEditor(tx, null, catalogueId, input, "en"),
  );
  const other = await withTransaction(fx.db, (tx) =>
    createUnit(tx, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
  );
  const updated = await withTransaction(fx.db, (tx) =>
    saveProductEditor(tx, saved.id, catalogueId, { ...saved, unitId: other.id }, "en"),
  );
  expect(updated.unitId).toBe(other.id);
});

it("writes direct declarations without reviving or rewriting stale recipe derivation", async () => {
  const saved = await withTransaction(fx.db, (tx) =>
    saveProductEditor(tx, null, catalogueId, input, "en"),
  );
  const staleRecipe = { allergens: { milk: { presence: "contains" } }, source: "old" };
  const staleDiet = { origins: ["dairy"], pending: false };
  await withTransaction(fx.db, async (tx) => {
    // Through the table on both sides: a `json()` column stores JSON TEXT, so the write needs the
    // column's own mapping in place of the `::jsonb` casts, and the read needs it to hand back a
    // parsed value rather than the stored string.
    await tx
      .update(products)
      .set({
        recipeDerivation: staleRecipe as never,
        dietDerivation: staleDiet as never,
      })
      .where(eq(products.id, saved.id));
    await saveProductEditor(
      tx,
      saved.id,
      catalogueId,
      { ...input, dietaryDeclarations: ["halal", "kosher"] },
      "en",
    );
  });
  const rows = await fx.db
    .select({
      recipe_derivation: products.recipeDerivation,
      diet_derivation: products.dietDerivation,
      dietary_declarations: products.dietaryDeclarations,
    })
    .from(products)
    .where(eq(products.id, saved.id));
  expect(rows[0]).toEqual({
    recipe_derivation: staleRecipe,
    diet_derivation: staleDiet,
    dietary_declarations: ["halal", "kosher"],
  });
});

it("rolls back product and variants when a supporting association fails", async () => {
  // An attachment naming no stored list is the failure this reaches for. It used to name an
  // option group and come back `modifier.invalid`; the product body now carries `modifiers`, and
  // the refusal is `assertRefsExist`'s (product-modifiers.ts) `product.invalid`. What the test is
  // actually about — the product and its variants roll back with it — is unchanged.
  await expect(
    withTransaction(fx.db, (tx) =>
      saveProductEditor(
        tx,
        null,
        catalogueId,
        { ...input, modifiers: [{ kind: "extras", id: crypto.randomUUID() }] },
        "en",
      ),
    ),
  ).rejects.toMatchObject({ code: "product.invalid", params: { field: "modifiers.0.id" } });
  expect(await withTransaction(fx.db, (tx) => listProducts(tx, catalogueId))).toEqual([]);
});

it("round-trips real category, extras and options associations in the order they were sent", async () => {
  const associations = await withTransaction(fx.db, async (tx) => {
    const topping = await saveProductEditor(
      tx,
      null,
      catalogueId,
      { ...input, name: "Bacon", customerName: null, variants: [] },
      "en",
    );
    return {
      category: await createCategory(tx, { name: { en: "Drinks" } }, "en"),
      sauces: await createExtraList(
        tx,
        { name: "Sauces", items: [{ productId: topping.id }] },
        "en",
      ),
      doneness: await createOptionList(tx, { name: "Doneness", labels: [{ name: "Rare" }] }, "en"),
    };
  });
  // An options list BEFORE an extras list, so the read-back proves the stored order is the body's
  // and not the two tables' own.
  const sent = [
    { kind: "options" as const, id: associations.doneness.id },
    { kind: "extras" as const, id: associations.sauces.id },
  ];
  const saved = await withTransaction(fx.db, (tx) =>
    saveProductEditor(
      tx,
      null,
      catalogueId,
      {
        ...input,
        categoryIds: [associations.category.id],
        primaryCategoryId: associations.category.id,
        modifiers: sent,
      },
      "en",
    ),
  );
  expect(saved.categoryIds).toEqual([associations.category.id]);
  expect(saved.primaryCategoryId).toBe(associations.category.id);
  expect(saved.modifiers).toEqual(sent);
  // And the same order comes back from a fresh read, not just from the save's own return value.
  const reread = await withTransaction(fx.db, (tx) => readProductEditor(tx, saved.id));
  expect(reread.modifiers).toEqual(sent);
  // A later save replaces the whole list, in the new order.
  const reordered = await withTransaction(fx.db, (tx) =>
    saveProductEditor(
      tx,
      saved.id,
      catalogueId,
      {
        ...input,
        categoryIds: [associations.category.id],
        primaryCategoryId: associations.category.id,
        modifiers: [sent[1]!],
      },
      "en",
    ),
  );
  expect(reordered.modifiers).toEqual([sent[1]]);
});

it.each([
  ["unitId", "not-an-id"],
  ["categoryIds", ["not-an-id"]],
  ["modifiers", null],
  ["variants", null],
  ["name", null],
  ["primaryCategoryId", crypto.randomUUID()],
  ["image", 42],
] as const)("rejects malformed %s before writing", async (field, value) => {
  await expect(
    withTransaction(fx.db, (tx) =>
      saveProductEditor(
        tx,
        null,
        catalogueId,
        { ...input, [field]: value } as ProductEditorInput,
        "en",
      ),
    ),
  ).rejects.toMatchObject({ code: "product.invalid", params: { field } });
  expect(await withTransaction(fx.db, (tx) => listProducts(tx, catalogueId))).toEqual([]);
});

/**
 * The refusals reachable from the product editor that name something OTHER than a field. The
 * dashboard puts a refusal's message beside the input it belongs to, and it can only do that from
 * what the refusal actually carries — so these shapes are pinned here, at the end that produces
 * them, rather than assumed at the end that reads them.
 */
async function refusal(value: unknown): Promise<{ code: string; params: unknown }> {
  const error = await withTransaction(fx.db, (tx) =>
    saveProductEditor(tx, null, catalogueId, value, "en").then(
      () => null,
      (error: unknown) => error as { code: string; params: unknown },
    ),
  );
  if (error === null) throw new Error("the save was accepted");
  return { code: error.code, params: error.params };
}

it("names the missing language, and nothing else, when a customer name skips the default", async () => {
  expect(await refusal({ ...input, customerName: { es: "Café" } })).toEqual({
    code: "content.translation_required",
    params: { language: "en" },
  });
  // A VARIANT's customer name is checked the same way, and its refusal is indistinguishable from the
  // product's: the language is all either one carries.
  expect(
    await refusal({
      ...input,
      variants: input.variants.map((variant, index) =>
        index === 1 ? { ...variant, customerName: { es: "Grande" } } : variant,
      ),
    }),
  ).toEqual({ code: "content.translation_required", params: { language: "en" } });
});

it.each([
  [{ allergens: { peanut: { presence: "contains" } } }, "allergen.invalid_code"],
  [{ allergens: { milk: { presence: "traces" } } }, "allergen.invalid_presence"],
  [{ dietaryDeclarations: ["carnivore"] }, "diet.declaration_invalid"],
])("refuses nutrition input without naming any field (%#)", async (patch, code) => {
  const { code: thrown, params } = await refusal({ ...input, ...patch });
  expect(thrown).toBe(code);
  // Nothing here says "allergens" or "dietary", so a refusal of either cannot reach a field on the
  // editor's Nutrition section.
  expect(Object.keys(params as Record<string, unknown>)).not.toContain("field");
});
