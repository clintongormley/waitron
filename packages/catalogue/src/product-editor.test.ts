import { beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTenant } from "@waitron/db";
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
  const setup = await withTenant(fx.db, tenantId, async (tx) => ({
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
  const saved = await withTenant(fx.db, tenantId, (tx) =>
    saveProductEditor(tx, tenantId, null, catalogueId, input, "en"),
  );
  expect(saved).toEqual({
    ...input,
    id: saved.id,
    variants: input.variants.map((v, i) => ({ ...v, id: saved.variants[i]!.id })),
    stationId: null,
    courseId: null,
  });
  expect(
    await withTenant(fx.db, tenantId, (tx) => readProductEditor(tx, tenantId, saved.id)),
  ).toEqual(saved);
  const updated = await withTenant(fx.db, tenantId, (tx) =>
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
  ).rejects.toMatchObject({ code: "product.variants_min_two" });
  expect(
    await withTenant(fx.db, tenantId, (tx) => listProducts(tx, tenantId, catalogueId)),
  ).toEqual([]);
  const none = await withTenant(fx.db, tenantId, (tx) =>
    saveProductEditor(tx, tenantId, null, catalogueId, { ...input, variants: [] }, "en"),
  );
  expect(none.variants).toEqual([]);
});

it("changes the product's unit on update", async () => {
  const saved = await withTenant(fx.db, tenantId, (tx) =>
    saveProductEditor(tx, tenantId, null, catalogueId, input, "en"),
  );
  const other = await withTenant(fx.db, tenantId, (tx) =>
    createUnit(tx, tenantId, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
  );
  const updated = await withTenant(fx.db, tenantId, (tx) =>
    saveProductEditor(tx, tenantId, saved.id, catalogueId, { ...saved, unitId: other.id }, "en"),
  );
  expect(updated.unitId).toBe(other.id);
});

it("writes direct declarations without reviving or rewriting stale recipe derivation", async () => {
  const saved = await withTenant(fx.db, tenantId, (tx) =>
    saveProductEditor(tx, tenantId, null, catalogueId, input, "en"),
  );
  const staleRecipe = { allergens: { milk: { presence: "contains" } }, source: "old" };
  const staleDiet = { origins: ["dairy"], pending: false };
  await withTenant(fx.db, tenantId, async (tx) => {
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
    withTenant(fx.db, tenantId, (tx) =>
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
  expect(
    await withTenant(fx.db, tenantId, (tx) => listProducts(tx, tenantId, catalogueId)),
  ).toEqual([]);
});

it("refuses another tenant's product and association ids", async () => {
  const saved = await withTenant(fx.db, tenantId, (tx) =>
    saveProductEditor(tx, tenantId, null, catalogueId, input, "en"),
  );
  const other = await seedTenant(fx.db);
  await expect(
    withTenant(fx.db, other, (tx) =>
      saveProductEditor(tx, other, saved.id, catalogueId, input, "en"),
    ),
  ).rejects.toMatchObject({ code: "product.not_found" });
  await expect(
    withTenant(fx.db, other, (tx) => readProductEditor(tx, other, saved.id)),
  ).rejects.toMatchObject({ code: "product.not_found" });
});

it("round-trips real category and modifier associations", async () => {
  const associations = await withTenant(fx.db, tenantId, async (tx) => ({
    category: await createCategory(tx, tenantId, { name: { en: "Drinks" } }, "en"),
    modifier: await createModifier(
      tx,
      tenantId,
      { type: "text", name: { en: "Note" }, available: true },
      "en",
    ),
  }));
  const saved = await withTenant(fx.db, tenantId, (tx) =>
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
    withTenant(fx.db, tenantId, (tx) =>
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
  expect(
    await withTenant(fx.db, tenantId, (tx) => listProducts(tx, tenantId, catalogueId)),
  ).toEqual([]);
});
