import { beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { TenantId } from "@waitron/shared";
import { createCatalogue, listProducts } from "./operations.js";
import { readProductEditor, saveProductEditor, type ProductEditorInput } from "./product-editor.js";
import { createUnit } from "./units.js";
import { createCategory } from "./categories.js";
import { createModifier } from "./modifiers.js";
import { useCatalogueDb } from "../test/fixtures.js";

const fx = useCatalogueDb();
let tenantId: TenantId;
let catalogueId: string;
let input: ProductEditorInput;
beforeEach(async () => {
  tenantId = await seedTenant(fx.db);
  const setup = await withTransaction(fx.db, async (tx) => ({
    catalogue: await createCatalogue(tx, tenantId, { name: "Menu" }),
    unit: await createUnit(
      tx,
      tenantId,
      { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
      "en",
    ),
  }));
  catalogueId = setup.catalogue.id;
  input = {
    name: "Coffee",
    customerName: { en: "Coffee", es: "Café" },
    description: { en: "Freshly roasted" },
    kitchenName: "BAR COFFEE",
    unitId: setup.unit.id,
    unitPrice: "9.00",
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
    modifierIds: [],
    allergens: null,
    dietaryDeclarations: ["vegan"],
  };
});

it("reads a product with no unit as unitId null", async () => {
  const saved = await withTenant(fx.db, tenantId, (tx) =>
    saveProductEditor(tx, tenantId, null, catalogueId, input, "en"),
  );
  await withTenant(fx.db, tenantId, (tx) =>
    tx.execute(
      sql`delete from product_units where tenant_id = ${tenantId} and product_id = ${saved.id}`,
    ),
  );
  const value = await withTenant(fx.db, tenantId, (tx) =>
    readProductEditor(tx, tenantId, saved.id),
  );
  expect(value.unitId).toBeNull();
});

it("saves and reads the canonical editor shape with independent content and variants", async () => {
  const saved = await withTransaction(fx.db, (tx) =>
    saveProductEditor(tx, tenantId, null, catalogueId, input, "en"),
  );
  expect(saved).toEqual({
    ...input,
    id: saved.id,
    variants: input.variants.map((v, i) => ({ ...v, id: saved.variants[i]!.id })),
    stationId: null,
    courseId: null,
  });
  expect(await withTransaction(fx.db, (tx) => readProductEditor(tx, tenantId, saved.id))).toEqual(
    saved,
  );
  const updated = await withTransaction(fx.db, (tx) =>
    saveProductEditor(
      tx,
      tenantId,
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

it("refuses a save with exactly one variant but allows none or two", async () => {
  await expect(
    withTenant(fx.db, tenantId, (tx) =>
      saveProductEditor(
        tx,
        tenantId,
        null,
        catalogueId,
        { ...input, variants: [input.variants[0]!] },
        "en",
      ),
    ),
  ).rejects.toMatchObject({ code: "product.variant_count_invalid", params: { minimum: 2 } });
  expect(
    await withTenant(fx.db, tenantId, (tx) => listProducts(tx, tenantId, catalogueId)),
  ).toEqual([]);
  const none = await withTenant(fx.db, tenantId, (tx) =>
    saveProductEditor(tx, tenantId, null, catalogueId, { ...input, variants: [] }, "en"),
  );
  expect(none.variants).toEqual([]);
});

it("changes the product's unit on update", async () => {
  const saved = await withTransaction(fx.db, (tx) =>
    saveProductEditor(tx, tenantId, null, catalogueId, input, "en"),
  );
  const other = await withTransaction(fx.db, (tx) =>
    createUnit(tx, tenantId, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
  );
  const updated = await withTransaction(fx.db, (tx) =>
    saveProductEditor(tx, tenantId, saved.id, catalogueId, { ...saved, unitId: other.id }, "en"),
  );
  expect(updated.unitId).toBe(other.id);
});

it("writes direct declarations without reviving or rewriting stale recipe derivation", async () => {
  const saved = await withTransaction(fx.db, (tx) =>
    saveProductEditor(tx, tenantId, null, catalogueId, input, "en"),
  );
  const staleRecipe = { allergens: { milk: { presence: "contains" } }, source: "old" };
  const staleDiet = { origins: ["dairy"], pending: false };
  await withTransaction(fx.db, async (tx) => {
    await tx.execute(sql`update products set
      recipe_derivation = ${JSON.stringify(staleRecipe)}::jsonb,
      diet_derivation = ${JSON.stringify(staleDiet)}::jsonb
      where tenant_id = ${tenantId} and id = ${saved.id}`);
    await saveProductEditor(
      tx,
      tenantId,
      saved.id,
      catalogueId,
      { ...input, dietaryDeclarations: ["halal", "kosher"] },
      "en",
    );
  });
  const rows = await fx.db.execute<{
    recipe_derivation: unknown;
    diet_derivation: unknown;
    dietary_declarations: string[];
  }>(sql`select recipe_derivation, diet_derivation, dietary_declarations from products
    where tenant_id = ${tenantId} and id = ${saved.id}`);
  expect(rows.rows[0]).toEqual({
    recipe_derivation: staleRecipe,
    diet_derivation: staleDiet,
    dietary_declarations: ["halal", "kosher"],
  });
});

it("rolls back product and variants when a supporting association fails", async () => {
  await expect(
    withTransaction(fx.db, (tx) =>
      saveProductEditor(
        tx,
        tenantId,
        null,
        catalogueId,
        { ...input, modifierIds: [crypto.randomUUID()] },
        "en",
      ),
    ),
  ).rejects.toMatchObject({ code: "modifier.invalid" });
  expect(await withTransaction(fx.db, (tx) => listProducts(tx, tenantId, catalogueId))).toEqual([]);
});

it("refuses another tenant's product and association ids", async () => {
  const saved = await withTransaction(fx.db, (tx) =>
    saveProductEditor(tx, tenantId, null, catalogueId, input, "en"),
  );
  const other = await seedTenant(fx.db);
  await expect(
    withTransaction(fx.db, (tx) =>
      saveProductEditor(tx, other, saved.id, catalogueId, input, "en"),
    ),
  ).rejects.toMatchObject({ code: "product.not_found" });
  await expect(
    withTransaction(fx.db, (tx) => readProductEditor(tx, other, saved.id)),
  ).rejects.toMatchObject({ code: "product.not_found" });
});

it("round-trips real category and modifier associations", async () => {
  const associations = await withTransaction(fx.db, async (tx) => ({
    category: await createCategory(tx, tenantId, { name: { en: "Drinks" } }, "en"),
    modifier: await createModifier(
      tx,
      tenantId,
      { type: "text", name: { en: "Note" }, available: true },
      "en",
    ),
  }));
  const saved = await withTransaction(fx.db, (tx) =>
    saveProductEditor(
      tx,
      tenantId,
      null,
      catalogueId,
      {
        ...input,
        categoryIds: [associations.category.id],
        primaryCategoryId: associations.category.id,
        modifierIds: [associations.modifier.id],
      },
      "en",
    ),
  );
  expect(saved.categoryIds).toEqual([associations.category.id]);
  expect(saved.primaryCategoryId).toBe(associations.category.id);
  expect(saved.modifierIds).toEqual([associations.modifier.id]);
});

it.each([
  ["unitId", "not-an-id"],
  ["categoryIds", ["not-an-id"]],
  ["modifierIds", null],
  ["variants", null],
  ["name", null],
  ["primaryCategoryId", crypto.randomUUID()],
  ["image", 42],
] as const)("rejects malformed %s before writing", async (field, value) => {
  await expect(
    withTransaction(fx.db, (tx) =>
      saveProductEditor(
        tx,
        tenantId,
        null,
        catalogueId,
        { ...input, [field]: value } as ProductEditorInput,
        "en",
      ),
    ),
  ).rejects.toMatchObject({ code: "product.invalid", params: { field } });
  expect(await withTransaction(fx.db, (tx) => listProducts(tx, tenantId, catalogueId))).toEqual([]);
});

/**
 * The refusals reachable from the product editor that name something OTHER than a field. The
 * dashboard puts a refusal's message beside the input it belongs to, and it can only do that from
 * what the refusal actually carries — so these shapes are pinned here, at the end that produces
 * them, rather than assumed at the end that reads them.
 */
async function refusal(value: unknown): Promise<{ code: string; params: unknown }> {
  const error = await withTenant(fx.db, tenantId, (tx) =>
    saveProductEditor(tx, tenantId, null, catalogueId, value, "en").then(
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
