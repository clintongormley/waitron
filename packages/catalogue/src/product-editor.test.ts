import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { kitchenCourses, kitchenStations, locations, products, withTransaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  applyRecipeDerivation,
  createCatalogue,
  listProducts,
  updateProduct,
} from "./operations.js";
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
        active: true,
      },
      {
        name: "Large",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "3.00",
        available: true,
        active: true,
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
    parentId: null,
    inherited: null,
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

it("saves a variant listed with a blank price as blank, and reads it back blank", async () => {
  const saved = await withTransaction(fx.db, (tx) =>
    saveProductEditor(
      tx,
      null,
      catalogueId,
      { ...input, variants: [{ ...input.variants[0]!, unitPrice: null }, input.variants[1]!] },
      "en",
    ),
  );
  expect(saved.variants.map((variant) => variant.unitPrice)).toEqual([null, "3.00"]);
  const again = await withTransaction(fx.db, (tx) =>
    saveProductEditor(tx, saved.id, catalogueId, saved, "en"),
  );
  expect(again.variants.map((variant) => variant.unitPrice)).toEqual([null, "3.00"]);
});

it("reports a malformed create body before an unknown catalogue", async () => {
  await expect(
    withTransaction(fx.db, (tx) =>
      saveProductEditor(tx, null, crypto.randomUUID(), { ...input, name: null }, "en"),
    ),
  ).rejects.toMatchObject({ code: "product.invalid", params: { field: "name" } });
  await expect(
    withTransaction(fx.db, (tx) => saveProductEditor(tx, null, crypto.randomUUID(), input, "en")),
  ).rejects.toMatchObject({ code: "catalogue.not_found" });
});

it("saves a product with exactly one variant, or none", async () => {
  // Spec §15.1: one variant is allowed.
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

describe("a removed variant in the parent's editor", () => {
  const save = (productId: string | null, body: unknown) =>
    withTransaction(fx.db, (tx) => saveProductEditor(tx, productId, catalogueId, body, "en"));
  const read = (productId: string) =>
    withTransaction(fx.db, (tx) => readProductEditor(tx, productId));
  const flags = (value: { variants: { name: string; active: boolean }[] }) =>
    value.variants.map(({ name, active }) => ({ name, active }));

  it("reads back with active false, and saving the read value back keeps it Inactive", async () => {
    const saved = await save(null, input);
    // Large is left out of the body, which is how a variant is removed.
    await save(saved.id, { ...saved, variants: [saved.variants[0]!] });
    const value = await read(saved.id);
    expect(flags(value)).toEqual([
      { name: "Small", active: true },
      { name: "Large", active: false },
    ]);
    await save(saved.id, value);
    expect(flags(await read(saved.id))).toEqual([
      { name: "Small", active: true },
      { name: "Large", active: false },
    ]);
  });

  it("is made Inactive when sent active false, and Active again when sent active true", async () => {
    const saved = await save(null, input);
    const [small, large] = saved.variants;
    await save(saved.id, { ...saved, variants: [small!, { ...large!, active: false }] });
    expect(flags(await read(saved.id))).toEqual([
      { name: "Small", active: true },
      { name: "Large", active: false },
    ]);
    await save(saved.id, { ...saved, variants: [small!, { ...large!, active: true }] });
    expect(flags(await read(saved.id))).toEqual([
      { name: "Small", active: true },
      { name: "Large", active: true },
    ]);
  });

  it("refuses a body whose variant leaves out active, naming that variant's field", async () => {
    const noActive: Record<string, unknown> = { ...input.variants[1]! };
    delete noActive.active;
    await expect(
      save(null, { ...input, variants: [input.variants[0]!, noActive] }),
    ).rejects.toMatchObject({ code: "product.invalid", params: { field: "variants.1.active" } });
  });

  it("does not block the save on an Inactive variant's missing default language, where an Active one does", async () => {
    // Customer names only in Spanish: neither resolves in the default language, English.
    const spanishOnly = { customerName: { es: "Grande" } };
    const saved = await save(null, input);
    const [small, large] = saved.variants;
    const inactive = await save(saved.id, {
      ...saved,
      variants: [small!, { ...large!, ...spanishOnly, active: false }],
    });
    expect(inactive.variants[1]).toMatchObject({ ...spanishOnly, active: false });
    await expect(
      save(saved.id, { ...saved, variants: [small!, { ...large!, ...spanishOnly, active: true }] }),
    ).rejects.toMatchObject({
      code: "content.translation_required",
      params: { language: "en" },
    });
  });

  // Removing a variant through its OWN page (the products list's Remove) is never refused for a
  // customer name lacking the default language, exactly as its product's save allows; making it
  // Active again is still checked.
  it("saves a variant's own page Inactive without the default language, and refuses it Active", async () => {
    const spanishOnly = { customerName: { es: "Grande" } };
    const saved = await save(null, input);
    const [small, large] = saved.variants;
    await save(saved.id, {
      ...saved,
      variants: [small!, { ...large!, ...spanishOnly, active: false }],
    });
    const own = await read(large!.id!);
    const removed = await save(large!.id!, { ...own, active: false });
    expect(removed).toMatchObject({ ...spanishOnly, active: false });
    await expect(save(large!.id!, { ...own, active: true })).rejects.toMatchObject({
      code: "content.translation_required",
      params: { language: "en" },
    });
    expect(await read(large!.id!)).toMatchObject({ active: false });
  });
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
    // column's own mapping, and the read needs it to hand back a parsed value rather than the
    // stored string.
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
  // An attachment naming no stored list is the failure this reaches for: the product and its
  // variants roll back with it.
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

describe("a variant's own page", () => {
  // The parent and its variant carry DIFFERENT values on every field a case reads, and three
  // different names each, so a read or write that takes the wrong row fails.
  let parentId: string;
  let variantId: string;
  let categories: { parent: string; own: string };
  let kgUnitId: string;
  let routing: { stationId: string; courseId: string };
  beforeEach(async () => {
    const setup = await withTransaction(fx.db, async (tx) => {
      const [location] = await tx
        .insert(locations)
        .values({ name: "Main", invoiceLocales: ["en-GB"], operationDescription: "Test op" })
        .returning({ id: locations.id });
      const [station] = await tx
        .insert(kitchenStations)
        .values({ locationId: location!.id, name: "Bar" })
        .returning({ id: kitchenStations.id });
      const [course] = await tx
        .insert(kitchenCourses)
        .values({ locationId: location!.id, name: "Drinks" })
        .returning({ id: kitchenCourses.id });
      const parentCategory = await createCategory(tx, { name: { en: "Coffee" } }, "en");
      const ownCategory = await createCategory(tx, { name: { en: "Espresso" } }, "en");
      const kg = await createUnit(
        tx,
        { name: { en: "kg" }, precision: 3, abbreviation: { en: "kg" } },
        "en",
      );
      await tx.execute(sql`update units set hardware_unit = 'kg' where id = ${kg.id}`);
      const parent = await saveProductEditor(
        tx,
        null,
        catalogueId,
        {
          ...input,
          customerName: { en: "A cup of coffee" },
          image: "coffee.webp",
          active: false,
          unitId: kg.id,
          categoryIds: [parentCategory.id],
          primaryCategoryId: parentCategory.id,
          allergens: { milk: { presence: "contains" } },
          variants: [
            {
              name: "Small",
              customerName: { en: "Small coffee" },
              kitchenName: "SM",
              image: null,
              unitPrice: "2.00",
              available: true,
              active: true,
            },
          ],
        },
        "en",
      );
      await tx
        .update(products)
        .set({ stationId: station!.id, courseId: course!.id })
        .where(eq(products.id, parent.id));
      return {
        parent,
        parentCategory: parentCategory.id,
        ownCategory: ownCategory.id,
        kg: kg.id,
        routing: { stationId: station!.id, courseId: course!.id },
      };
    });
    routing = setup.routing;
    parentId = setup.parent.id;
    variantId = setup.parent.variants[0]!.id;
    categories = { parent: setup.parentCategory, own: setup.ownCategory };
    kgUnitId = setup.kg;
  });

  const read = (id: string) => withTransaction(fx.db, (tx) => readProductEditor(tx, id));
  const save = (id: string, body: unknown) =>
    withTransaction(fx.db, (tx) => saveProductEditor(tx, id, catalogueId, body, "en"));
  const storedRow = async (id: string) =>
    (
      await fx.db
        .select({
          unitPrice: products.unitPrice,
          vatClass: products.vatClass,
          pricingUnit: products.pricingUnit,
          categoryId: products.categoryId,
          manualAllergens: products.manualAllergens,
          dietaryDeclarations: products.dietaryDeclarations,
        })
        .from(products)
        .where(eq(products.id, id))
    )[0];

  it("reads a variant's own names and its blanks as blanks, with its parent's values beside them", async () => {
    expect(await read(variantId)).toEqual({
      id: variantId,
      parentId,
      name: "Small",
      customerName: { en: "Small coffee" },
      kitchenName: "SM",
      soldAlone: true,
      active: true,
      available: true,
      description: null,
      image: null,
      unitId: null,
      unitPrice: "2.00",
      vatClass: null,
      categoryIds: [],
      primaryCategoryId: null,
      allergens: null,
      dietaryDeclarations: null,
      stationId: null,
      courseId: null,
      modifiers: [],
      variants: [],
      inherited: {
        description: { en: "Freshly roasted" },
        image: "coffee.webp",
        unitPrice: "9.00",
        vatClass: "reduced",
        unitId: kgUnitId,
        categoryIds: [categories.parent],
        primaryCategoryId: categories.parent,
        stationId: routing.stationId,
        courseId: routing.courseId,
        allergens: { milk: { presence: "contains" } },
        dietaryDeclarations: ["vegan"],
      },
    });
    const parent = await read(parentId);
    expect(parent.parentId).toBeNull();
    expect(parent.inherited).toBeNull();
  });

  it("offers the parent's PUBLISHED allergens as inherited, never only its manual overlay", async () => {
    const eggs = { eggs: { presence: "contains" as const } };
    await withTransaction(fx.db, (tx) =>
      applyRecipeDerivation(tx, parentId, { allergens: eggs, pending: false }),
    );
    const union = await read(variantId);
    expect(union.inherited?.allergens).toEqual({ milk: { presence: "contains" }, ...eggs });
    expect(union.allergens).toBeNull();

    await withTransaction(fx.db, (tx) => updateProduct(tx, parentId, { allergens: null }));
    const recipeOnly = await read(variantId);
    expect(recipeOnly.inherited?.allergens).toEqual(eggs);
    expect(recipeOnly.allergens).toBeNull();
  });

  it("keeps a blank blank when the read value is saved back unchanged", async () => {
    const value = await read(variantId);
    expect(await save(variantId, value)).toEqual(value);
    expect(await storedRow(variantId)).toEqual({
      unitPrice: 200,
      vatClass: null,
      pricingUnit: null,
      categoryId: null,
      manualAllergens: null,
      dietaryDeclarations: null,
    });
  });

  it("overrides an inherited field with a value, and a blank returns it to inheriting", async () => {
    const value = await read(variantId);
    const overridden = await save(variantId, {
      ...value,
      unitPrice: "2.50",
      vatClass: "general",
      unitId: input.unitId,
      categoryIds: [categories.own],
      primaryCategoryId: categories.own,
      allergens: { eggs: { presence: "may_contain" } },
      dietaryDeclarations: ["halal"],
    });
    expect(overridden).toMatchObject({
      unitPrice: "2.50",
      vatClass: "general",
      unitId: input.unitId,
      categoryIds: [categories.own],
      primaryCategoryId: categories.own,
      allergens: { eggs: { presence: "may_contain" } },
      dietaryDeclarations: ["halal"],
      inherited: value.inherited,
    });
    expect(await storedRow(variantId)).toMatchObject({ pricingUnit: "each" });
    const cleared = await save(variantId, value);
    expect(cleared).toEqual(value);
    expect(await storedRow(variantId)).toEqual({
      unitPrice: 200,
      vatClass: null,
      pricingUnit: null,
      categoryId: null,
      manualAllergens: null,
      dietaryDeclarations: null,
    });
    // A blank price follows the parent's, and the parent's own list shows it blank.
    const blankPrice = await save(variantId, { ...value, unitPrice: null });
    expect(blankPrice.unitPrice).toBeNull();
    expect((await read(parentId)).variants[0]!.unitPrice).toBeNull();
  });

  it("leaves the parent, its variants list and its attached lists as they were", async () => {
    const before = await read(parentId);
    await save(variantId, { ...(await read(variantId)), vatClass: "zero", active: false });
    const after = await read(parentId);
    expect(after).toEqual({ ...before, variants: [{ ...before.variants[0]!, active: false }] });
  });

  it.each([
    ["a different parent", () => crypto.randomUUID()],
    ["no parent", () => null],
  ])("refuses a variant's body naming %s", async (_label, parent) => {
    await expect(
      save(variantId, { ...inheritingBody(), parentId: parent() }),
    ).rejects.toMatchObject({ code: "product.invalid", params: { field: "parentId" } });
  });

  it("accepts a variant's body naming its own parent", async () => {
    await expect(
      save(variantId, { ...inheritingBody(), parentId: parentId.toUpperCase() }),
    ).resolves.toMatchObject({ parentId });
  });

  it("refuses a parent named on a product with none, on an update and on a create", async () => {
    await expect(save(parentId, { ...input, parentId })).rejects.toMatchObject({
      code: "product.invalid",
      params: { field: "parentId" },
    });
    await expect(
      withTransaction(fx.db, (tx) =>
        saveProductEditor(tx, null, catalogueId, { ...input, parentId }, "en"),
      ),
    ).rejects.toMatchObject({ code: "product.invalid", params: { field: "parentId" } });
  });

  it.each(["vatClass", "unitPrice"] as const)(
    "refuses a blank %s on a product with no parent",
    async (field) => {
      await expect(save(parentId, { ...input, [field]: null })).rejects.toMatchObject({
        code: "product.invalid",
        params: { field },
      });
    },
  );

  it("refuses variants or attached lists on a variant", async () => {
    await expect(
      save(variantId, { ...inheritingBody(), variants: input.variants }),
    ).rejects.toMatchObject({ code: "product.invalid", params: { field: "variants" } });
    const list = await withTransaction(fx.db, (tx) =>
      createOptionList(tx, { name: "Milk", labels: [{ name: "Oat" }] }, "en"),
    );
    await expect(
      save(variantId, { ...inheritingBody(), modifiers: [{ kind: "options", id: list.id }] }),
    ).rejects.toMatchObject({ code: "product.invalid", params: { field: "modifiers" } });
  });

  /** A variant body that inherits every field. */
  function inheritingBody() {
    return {
      ...input,
      name: "Small",
      customerName: null,
      kitchenName: null,
      description: null,
      unitId: null,
      unitPrice: null,
      vatClass: null,
      variants: [],
      allergens: null,
      dietaryDeclarations: null,
    };
  }
});

describe("a product an extras list offers", () => {
  const save = (productId: string | null, body: unknown) =>
    withTransaction(fx.db, (tx) => saveProductEditor(tx, productId, catalogueId, body, "en"));
  const read = (productId: string) =>
    withTransaction(fx.db, (tx) => readProductEditor(tx, productId));
  const small = () => ({ ...input.variants[0]!, active: false });
  const large = () => ({ ...input.variants[1]!, active: true });

  let coffeeId: string;
  let offering: { id: string; name: string }[];
  beforeEach(async () => {
    const coffee = await save(null, { ...input, variants: [] });
    const tea = await save(null, { ...input, name: "Tea", customerName: null, variants: [] });
    coffeeId = coffee.id;
    // Created in the reverse of name order, beside a list that offers only another product, so
    // the refusal's list has to be the offering lists by name.
    offering = await withTransaction(fx.db, async (tx) => {
      const toppings = await createExtraList(
        tx,
        { name: "Toppings", items: [{ productId: tea.id }, { productId: coffee.id }] },
        "en",
      );
      await createExtraList(tx, { name: "Sides", items: [{ productId: tea.id }] }, "en");
      const addOns = await createExtraList(
        tx,
        { name: "Add-ons", items: [{ productId: coffee.id }] },
        "en",
      );
      return [
        { id: addOns.id, name: "Add-ons" },
        { id: toppings.id, name: "Toppings" },
      ];
    });
  });

  it("refuses a parent's save that adds an Active variant, naming every list that offers it", async () => {
    const saved = await read(coffeeId);

    await expect(save(coffeeId, { ...saved, variants: [small(), large()] })).rejects.toMatchObject({
      code: "product.offered_as_extra",
      params: { field: "variants.1.active", extraLists: offering },
    });
    expect((await read(coffeeId)).variants).toEqual([]);
  });

  it("refuses a parent's save that makes an Inactive variant Active again", async () => {
    const withInactive = await save(coffeeId, { ...(await read(coffeeId)), variants: [small()] });

    await expect(
      save(coffeeId, {
        ...withInactive,
        variants: [{ ...withInactive.variants[0]!, active: true }],
      }),
    ).rejects.toMatchObject({
      code: "product.offered_as_extra",
      params: { field: "variants.0.active", extraLists: offering },
    });
    expect((await read(coffeeId)).variants.map((variant) => variant.active)).toEqual([false]);
  });

  it("refuses a variant's own save that makes it Active", async () => {
    const withInactive = await save(coffeeId, { ...(await read(coffeeId)), variants: [small()] });
    const variantId = withInactive.variants[0]!.id;
    const own = await read(variantId);

    await expect(save(variantId, { ...own, active: true })).rejects.toMatchObject({
      code: "product.offered_as_extra",
      params: { field: "active", extraLists: offering },
    });
    expect(await read(variantId)).toMatchObject({ active: false });
  });

  it("saves variants that all stay Inactive, from the parent and from the variant's own page", async () => {
    const saved = await save(coffeeId, {
      ...(await read(coffeeId)),
      variants: [small(), { ...large(), active: false }],
    });
    expect(saved.variants.map((variant) => variant.active)).toEqual([false, false]);

    const variantId = saved.variants[0]!.id;
    const own = await read(variantId);
    expect(await save(variantId, { ...own, name: "Small cup", active: false })).toMatchObject({
      name: "Small cup",
      active: false,
    });
    // The offered product itself is saved Active: only a VARIANT's own save is checked.
    expect(await save(coffeeId, { ...(await read(coffeeId)), active: true })).toMatchObject({
      active: true,
    });
  });

  it("adds, re-activates and restores variants of a product no list offers", async () => {
    const juice = await save(null, { ...input, name: "Juice", customerName: null, variants: [] });

    const added = await save(juice.id, { ...juice, variants: [small(), large()] });
    expect(added.variants.map((variant) => variant.active)).toEqual([false, true]);
    const reactivated = await save(juice.id, {
      ...added,
      variants: [{ ...added.variants[0]!, active: true }, added.variants[1]!],
    });
    expect(reactivated.variants.map((variant) => variant.active)).toEqual([true, true]);

    const variantId = reactivated.variants[0]!.id;
    await save(variantId, { ...(await read(variantId)), active: false });
    expect(await save(variantId, { ...(await read(variantId)), active: true })).toMatchObject({
      active: true,
    });
  });
});
