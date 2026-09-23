import { describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, products, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { productCategories } from "./schema/categories.js";
import { productUnits } from "./schema/units.js";
import { menuItemVariantOverrides } from "./schema/variant-overrides.js";
import { racePair } from "../test/fixtures.js";
import { createCatalogue, createProduct, createMenuSection, createMenuItem } from "./operations.js";
import { readProductEditor, saveProductEditor } from "./product-editor.js";
import {
  listMenuVariants,
  listProductVariants,
  setMenuVariants,
  setProductVariants,
  selectMenuVariant,
  type ProductVariant,
  type ProductVariantInput,
} from "./variants.js";
import { staffPresentationName, customerPresentationText } from "./product-presentation.js";
import { createUnit } from "./units.js";
import {
  addProductsToCategory,
  createCategory,
  readProductCategories,
  replaceProductCategories,
} from "./categories.js";

/**
 * Variants against a real database, plus the pure selection core. A variant is a `products` row
 * with a `parent_id` (spec §15); the per-menu settings of one live in
 * `menu_item_variant_overrides`, and a row there exists only while it overrides something (V13).
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const app = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

const wine = (
  name: string,
  unitPrice: string | null,
  extra: Partial<ProductVariantInput> = {},
): ProductVariantInput => ({
  name,
  customerName: null,
  kitchenName: null,
  image: null,
  unitPrice,
  available: true,
  ...extra,
});

async function fixture() {
  await seedTenant(suite.db);
  return app(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Bar" });
    const terrace = await createCatalogue(tx, { name: "Terrace" });
    const glass = await createUnit(
      tx,
      { name: { en: "glass" }, precision: 0, abbreviation: { en: "gl" } },
      "en",
    );
    const parent = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Wine by the glass",
      customerName: { en: "House wine" },
      kitchenName: "WINE",
      description: { en: "A dry white from Rueda" },
      unitId: glass.id,
      unitPrice: "4.00",
      vatClass: "reduced",
    });
    const other = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Cider",
      unitId: glass.id,
      unitPrice: "3.00",
      vatClass: "general",
    });
    const section = await createMenuSection(tx, { menuId: menu.id, name: { en: "Drinks" } });
    const terraceSection = await createMenuSection(tx, {
      menuId: terrace.id,
      name: { en: "Drinks" },
    });
    const offer = await createMenuItem(tx, {
      menuId: menu.id,
      sectionId: section.id,
      productId: parent.id,
      grossPrice: "4.50",
    });
    return {
      catalogueId: menu.id,
      terraceId: terrace.id,
      terraceSectionId: terraceSection.id,
      parentId: parent.id,
      otherId: other.id,
      offerId: offer.id,
    };
  });
}

/** The variant rows of `parentId` as the table stores them, flags as the 0/1 this engine keeps. */
async function storedVariants(parentId: string) {
  const { rows } = await suite.db.execute<Record<string, unknown>>(sql`
    select id, parent_id, catalogue_id, variant_order, active, available, sold_alone, unit_price,
      vat_class, pricing_unit, dietary_declarations, diet, description, category_id, station_id,
      course_id, image, allergens, manual_allergens, recipe_derivation, diet_derivation,
      diet_override
    from products where parent_id = ${parentId} order by variant_order`);
  return rows;
}

/** Every inherited column, as the explicit NULL a new variant stores so it reads its parent's. */
const INHERITING = {
  vat_class: null,
  pricing_unit: null,
  dietary_declarations: null,
  diet: null,
  description: null,
  category_id: null,
  station_id: null,
  course_id: null,
  image: null,
  allergens: null,
  manual_allergens: null,
  recipe_derivation: null,
  diet_derivation: null,
  diet_override: null,
};

describe("setProductVariants stores each variant as a product under its parent", () => {
  it("creates products rows that inherit every field they leave blank, in the order given", async () => {
    const f = await fixture();
    const saved = await app((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null), wine("Wine 175", "5.50")], "en"),
    );
    expect(saved.map(({ name, unitPrice, active }) => ({ name, unitPrice, active }))).toEqual([
      { name: "Wine 125", unitPrice: null, active: true },
      { name: "Wine 175", unitPrice: "5.50", active: true },
    ]);
    const common = {
      parent_id: f.parentId,
      catalogue_id: f.catalogueId,
      active: 1,
      available: 1,
      sold_alone: 1,
      ...INHERITING,
    };
    expect(await storedVariants(f.parentId)).toEqual([
      { ...common, id: saved[0]!.id, variant_order: 0, unit_price: null },
      { ...common, id: saved[1]!.id, variant_order: 1, unit_price: 550 },
    ]);
    // No unit or category row of their own: that is how a variant inherits both (V12).
    const ids = saved.map((variant) => variant.id);
    expect(
      await suite.db.select().from(productUnits).where(inArray(productUnits.productId, ids)),
    ).toEqual([]);
    expect(
      await suite.db
        .select()
        .from(productCategories)
        .where(inArray(productCategories.productId, ids)),
    ).toEqual([]);
    expect(await app((tx) => listProductVariants(tx, f.parentId))).toEqual(saved);

    const reversed = await app((tx) =>
      setProductVariants(tx, f.parentId, [saved[1]!, saved[0]!], "en"),
    );
    expect(reversed.map((variant) => variant.id)).toEqual([saved[1]!.id, saved[0]!.id]);
    expect(
      (await storedVariants(f.parentId)).map(({ id, variant_order }) => ({ id, variant_order })),
    ).toEqual([
      { id: saved[1]!.id, variant_order: 0 },
      { id: saved[0]!.id, variant_order: 1 },
    ]);
  });

  it("stores an Unavailable variant as Active but not Available", async () => {
    const f = await fixture();
    await app((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null, { available: false })], "en"),
    );
    expect(
      (await storedVariants(f.parentId)).map(({ active, available }) => ({ active, available })),
    ).toEqual([{ active: 1, available: 0 }]);
  });

  it("makes a variant left out of a save Inactive, keeping its row and what refers to it", async () => {
    const f = await fixture();
    const [w125, w175] = await app((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null), wine("Wine 175", "5.50")], "en"),
    );
    await app((tx) =>
      setMenuVariants(tx, f.offerId, [{ variantId: w175!.id, price: "6.00", offered: true }]),
    );

    const afterRemoval = await app((tx) => setProductVariants(tx, f.parentId, [w125!], "en"));

    expect(afterRemoval).toEqual([
      { ...w125, active: true },
      { ...w175, active: false },
    ]);
    expect((await storedVariants(f.parentId)).map(({ id, active }) => ({ id, active }))).toEqual([
      { id: w125!.id, active: 1 },
      { id: w175!.id, active: 0 },
    ]);
    expect(
      await suite.db
        .select({ variantId: menuItemVariantOverrides.variantId })
        .from(menuItemVariantOverrides),
    ).toEqual([{ variantId: w175!.id }]);

    const restored = await app((tx) => setProductVariants(tx, f.parentId, [w125!, w175!], "en"));
    expect(restored.map(({ id, active }) => ({ id, active }))).toEqual([
      { id: w125!.id, active: true },
      { id: w175!.id, active: true },
    ]);
  });

  it("refuses an id that is not a variant of this parent", async () => {
    const f = await fixture();
    const [foreign] = await app((tx) =>
      setProductVariants(tx, f.otherId, [wine("Cider pint", "4.00")], "en"),
    );
    await expect(
      app((tx) =>
        setProductVariants(tx, f.parentId, [{ ...wine("Stray", null), id: foreign!.id }], "en"),
      ),
    ).rejects.toMatchObject({
      code: "product.variant_not_found",
      params: { variantId: foreign!.id },
    });
    await expect(
      app((tx) =>
        setProductVariants(tx, f.parentId, [{ ...wine("Stray", null), id: f.otherId }], "en"),
      ),
    ).rejects.toMatchObject({
      code: "product.variant_not_found",
      params: { variantId: f.otherId },
    });
    expect(await app((tx) => listProductVariants(tx, f.parentId))).toEqual([]);
  });

  it("round-trips a variant's three names and image, and stores them on its products row", async () => {
    const f = await fixture();
    await app((tx) =>
      setProductVariants(
        tx,
        f.parentId,
        [
          wine("Wine 175", "5.50", {
            customerName: { en: "Large glass of house wine" },
            kitchenName: "W175",
            image: "large.jpg",
          }),
        ],
        "en",
      ),
    );
    expect(await app((tx) => listProductVariants(tx, f.parentId))).toEqual([
      {
        id: expect.any(String),
        name: "Wine 175",
        customerName: { en: "Large glass of house wine" },
        kitchenName: "W175",
        image: "large.jpg",
        unitPrice: "5.50",
        available: true,
        active: true,
      },
    ]);
    // Read back through the table's own column mapping, which parses the JSON the column stores.
    expect(
      await suite.db
        .select({
          name: products.name,
          customerName: products.customerName,
          kitchenName: products.kitchenName,
          image: products.image,
        })
        .from(products)
        .where(eq(products.parentId, f.parentId)),
    ).toEqual([
      {
        name: "Wine 175",
        customerName: { en: "Large glass of house wine" },
        kitchenName: "W175",
        image: "large.jpg",
      },
    ]);
  });
});

describe("the product editor", () => {
  it("reads Active variants only, so saving the parent back cannot restore a removed one", async () => {
    const f = await fixture();
    // Both priced: the editor's write body still requires a variant price.
    const [w125, w175] = await app((tx) =>
      setProductVariants(
        tx,
        f.parentId,
        [wine("Wine 125", "4.75"), wine("Wine 175", "5.50")],
        "en",
      ),
    );
    await app((tx) => setProductVariants(tx, f.parentId, [w125!], "en"));

    const value = await app((tx) => readProductEditor(tx, f.parentId));
    expect(value.variants.map((variant) => variant.id)).toEqual([w125!.id]);

    await app((tx) => saveProductEditor(tx, f.parentId, f.catalogueId, value, "en"));
    expect((await storedVariants(f.parentId)).map(({ id, active }) => ({ id, active }))).toEqual([
      { id: w125!.id, active: 1 },
      { id: w175!.id, active: 0 },
    ]);
  });
});

describe("a variant's id is not a product's id to the product-by-id functions", () => {
  async function variantOfParent() {
    const f = await fixture();
    const [w125] = await app((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", "4.75")], "en"),
    );
    const category = await app((tx) => createCategory(tx, { name: { en: "Wines" } }, "en"));
    return { ...f, variantId: w125!.id, categoryId: category.id };
  }
  const notFound = (productId: string) => ({ code: "product.not_found", params: { productId } });

  it("reads and saves a product's editor, never a variant's", async () => {
    const f = await variantOfParent();
    await expect(app((tx) => readProductEditor(tx, f.variantId))).rejects.toMatchObject(
      notFound(f.variantId),
    );
    const parent = await app((tx) => readProductEditor(tx, f.parentId));
    await expect(
      app((tx) =>
        saveProductEditor(
          tx,
          f.variantId,
          f.catalogueId,
          { ...parent, vatClass: "general", categoryIds: [], variants: [] },
          "en",
        ),
      ),
    ).rejects.toMatchObject(notFound(f.variantId));
    expect((await storedVariants(f.parentId))[0]).toMatchObject({ vat_class: null });
    await expect(
      app((tx) => saveProductEditor(tx, f.parentId, f.catalogueId, parent, "en")),
    ).resolves.toMatchObject({ id: f.parentId });
  });

  it("gives variants to a product, never to a variant", async () => {
    const f = await variantOfParent();
    await expect(
      app((tx) => setProductVariants(tx, f.variantId, [wine("Grandchild", "1.00")], "en")),
    ).rejects.toMatchObject(notFound(f.variantId));
    expect(await storedVariants(f.variantId)).toEqual([]);
    await expect(
      app((tx) => setProductVariants(tx, f.otherId, [wine("Cider pint", "4.00")], "en")),
    ).resolves.toHaveLength(1);
  });

  it("reads and writes a product's category membership, never a variant's", async () => {
    const f = await variantOfParent();
    const membership = { categoryIds: [f.categoryId], primaryCategoryId: f.categoryId };
    await expect(app((tx) => readProductCategories(tx, f.variantId))).rejects.toMatchObject(
      notFound(f.variantId),
    );
    await expect(
      app((tx) => replaceProductCategories(tx, f.variantId, membership)),
    ).rejects.toMatchObject(notFound(f.variantId));
    await expect(
      app((tx) => addProductsToCategory(tx, f.categoryId, [f.variantId])),
    ).rejects.toMatchObject({ code: "category.membership_invalid" });
    expect(
      await suite.db
        .select()
        .from(productCategories)
        .where(eq(productCategories.productId, f.variantId)),
    ).toEqual([]);
    expect((await storedVariants(f.parentId))[0]).toMatchObject({ category_id: null });

    await app((tx) => addProductsToCategory(tx, f.categoryId, [f.parentId]));
    await expect(app((tx) => readProductCategories(tx, f.parentId))).resolves.toEqual(membership);
    await expect(
      app((tx) => replaceProductCategories(tx, f.parentId, membership)),
    ).resolves.toEqual(membership);
  });
});

describe("createMenuItem", () => {
  it("refuses a variant, which follows its parent onto a menu instead, and accepts the parent", async () => {
    const f = await fixture();
    const [w125] = await app((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null)], "en"),
    );
    await expect(
      app((tx) =>
        createMenuItem(tx, {
          menuId: f.terraceId,
          sectionId: f.terraceSectionId,
          productId: w125!.id,
          grossPrice: "5.00",
        }),
      ),
    ).rejects.toMatchObject({
      code: "menu_item.variant_not_allowed",
      params: { productId: w125!.id },
    });
    await expect(
      app((tx) =>
        createMenuItem(tx, {
          menuId: f.terraceId,
          sectionId: f.terraceSectionId,
          productId: f.parentId,
          grossPrice: "5.00",
        }),
      ),
    ).resolves.toMatchObject({ productId: f.parentId, grossPrice: "5.00" });
  });
});

describe("a variant's per-menu settings", () => {
  it("lists every Active variant of the offer's product with the default settings", async () => {
    // Wine 250 is saved and then removed, so it is Inactive and must not be listed.
    const f = await fixture();
    const [w125, w175] = await app((tx) =>
      setProductVariants(
        tx,
        f.parentId,
        [wine("Wine 125", null), wine("Wine 175", "5.50"), wine("Wine 250", "7.00")],
        "en",
      ),
    );
    await app((tx) => setProductVariants(tx, f.parentId, [w125!, w175!], "en"));
    expect(await app((tx) => listMenuVariants(tx, f.offerId, f.catalogueId))).toEqual([
      { variantId: w125!.id, price: null, offered: true },
      { variantId: w175!.id, price: null, offered: true },
    ]);
  });

  it("stores a row only while it overrides something", async () => {
    const f = await fixture();
    const [w125, w175] = await app((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null), wine("Wine 175", "5.50")], "en"),
    );
    const stored = () =>
      suite.db
        .select({
          variantId: menuItemVariantOverrides.variantId,
          price: menuItemVariantOverrides.price,
          offered: menuItemVariantOverrides.offered,
        })
        .from(menuItemVariantOverrides);

    const priced = await app((tx) =>
      setMenuVariants(tx, f.offerId, [
        { variantId: w125!.id, price: null, offered: true },
        { variantId: w175!.id, price: "6.00", offered: true },
      ]),
    );
    expect(priced).toEqual([
      { variantId: w125!.id, price: null, offered: true },
      { variantId: w175!.id, price: "6.00", offered: true },
    ]);
    expect(await stored()).toEqual([{ variantId: w175!.id, price: 600, offered: true }]);

    await app((tx) =>
      setMenuVariants(tx, f.offerId, [{ variantId: w175!.id, price: null, offered: false }]),
    );
    expect(await stored()).toEqual([{ variantId: w175!.id, price: null, offered: false }]);

    await app((tx) =>
      setMenuVariants(tx, f.offerId, [{ variantId: w175!.id, price: null, offered: true }]),
    );
    expect(await stored()).toEqual([]);
  });

  it("treats an override of 0.00 as a price", async () => {
    const f = await fixture();
    const [w125] = await app((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", "5.00")], "en"),
    );
    expect(
      await app((tx) =>
        setMenuVariants(tx, f.offerId, [{ variantId: w125!.id, price: "0.00", offered: true }]),
      ),
    ).toEqual([{ variantId: w125!.id, price: "0.00", offered: true }]);
  });

  it.each([
    [{ price: "-1.00", offered: true }, "price"],
    [{ price: "1.001", offered: true }, "price"],
    [{ price: 4, offered: true }, "price"],
    [{ price: null, offered: "yes" }, "offered"],
  ])("refuses a malformed setting %j, naming %s, and writes nothing", async (setting, field) => {
    const f = await fixture();
    const [w125, w175] = await app((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null), wine("Wine 175", "5.50")], "en"),
    );
    await expect(
      app((tx) =>
        setMenuVariants(tx, f.offerId, [
          { variantId: w125!.id, price: "6.00", offered: true },
          { variantId: w175!.id, ...(setting as { price: string | null; offered: boolean }) },
        ]),
      ),
    ).rejects.toMatchObject({ code: "product.variant_invalid", params: { field } });
    expect(await suite.db.select().from(menuItemVariantOverrides)).toEqual([]);
  });

  it("refuses an Inactive variant, a variant of another product and a repeated one", async () => {
    const f = await fixture();
    const [w125, w175] = await app((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null), wine("Wine 175", "5.50")], "en"),
    );
    const [foreign] = await app((tx) =>
      setProductVariants(tx, f.otherId, [wine("Cider pint", "4.00")], "en"),
    );
    await app((tx) => setProductVariants(tx, f.parentId, [w125!], "en"));
    for (const variantId of [w175!.id, foreign!.id]) {
      await expect(
        app((tx) => setMenuVariants(tx, f.offerId, [{ variantId, price: "6.00", offered: true }])),
      ).rejects.toMatchObject({ code: "product.variant_not_found", params: { variantId } });
    }
    await expect(
      app((tx) =>
        setMenuVariants(tx, f.offerId, [
          { variantId: w125!.id, price: "6.00", offered: true },
          { variantId: w125!.id, price: null, offered: false },
        ]),
      ),
    ).rejects.toMatchObject({ code: "product.variant_invalid", params: { field: "variantId" } });
    expect(await suite.db.select().from(menuItemVariantOverrides)).toEqual([]);
  });

  it("leaves an Inactive variant's override alone when the Active ones are saved", async () => {
    const f = await fixture();
    const [w125, w175] = await app((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null), wine("Wine 175", "5.50")], "en"),
    );
    await app((tx) =>
      setMenuVariants(tx, f.offerId, [{ variantId: w175!.id, price: "6.00", offered: true }]),
    );
    await app((tx) => setProductVariants(tx, f.parentId, [w125!], "en"));
    await app((tx) =>
      setMenuVariants(tx, f.offerId, [{ variantId: w125!.id, price: null, offered: true }]),
    );
    expect(
      await suite.db
        .select({ variantId: menuItemVariantOverrides.variantId })
        .from(menuItemVariantOverrides),
    ).toEqual([{ variantId: w175!.id }]);
  });

  it("refuses an offer on another menu", async () => {
    const f = await fixture();
    await expect(app((tx) => listMenuVariants(tx, f.offerId, f.terraceId))).rejects.toMatchObject({
      code: "menu_item.not_found",
      params: { menuItemId: f.offerId },
    });
    await expect(
      app((tx) => setMenuVariants(tx, f.offerId, [], f.terraceId)),
    ).rejects.toMatchObject({ code: "menu_item.not_found", params: { menuItemId: f.offerId } });
  });
});

it("a variant removed while its override is being written ends Inactive, the override kept", async () => {
  const f = await fixture();
  const [w125] = await app((tx) =>
    setProductVariants(tx, f.parentId, [wine("Wine 125", null)], "en"),
  );

  // One write transaction runs on the venue file at a time, so the removal runs second and sees
  // the committed override; `racePair` (`test/fixtures.ts`) carries the measurement that it does
  // not start early. Removing is always allowed now (spec §15.6), so both succeed.
  const [overriding, removing] = await racePair(
    suite.db,
    (tx) => setMenuVariants(tx, f.offerId, [{ variantId: w125!.id, price: "4.00", offered: true }]),
    (tx) => setProductVariants(tx, f.parentId, [], "en"),
  );

  expect(overriding.status).toBe("fulfilled");
  expect(removing.status).toBe("fulfilled");
  expect(await app((tx) => listProductVariants(tx, f.parentId))).toEqual([
    { ...w125, active: false },
  ]);
  expect(
    await suite.db
      .select({ variantId: menuItemVariantOverrides.variantId })
      .from(menuItemVariantOverrides),
  ).toEqual([{ variantId: w125!.id }]);
});

// selectMenuVariant is the pure core of menu-variant resolution — no DB. It returns the six name
// pieces (product staff/customer/kitchen and variant staff/customer/kitchen) separately, in the
// exact shape product-presentation.ts consumes, so the display join and fallback are never
// re-implemented here.
describe("selectMenuVariant returns the six product and variant name pieces", () => {
  const large: ProductVariant = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Large",
    customerName: { en: "Large cup" },
    kitchenName: "LG",
    image: null,
    unitPrice: "3.00",
    available: true,
    active: true,
  };
  const offer = {
    productId: "22222222-2222-2222-2222-222222222222",
    name: "Coffee",
    customerName: { en: "Fresh Coffee" },
    kitchenName: "BAR COFFEE",
    unitPrice: "8.00",
    variants: [{ id: large.id, unitPrice: "3.50", available: true }],
  };

  it("carries the product's names and the chosen variant's own three names", () => {
    const selected = selectMenuVariant(offer, [large], large.id);
    expect(selected).toEqual({
      variantId: large.id,
      name: "Coffee",
      customerName: { en: "Fresh Coffee" },
      kitchenName: "BAR COFFEE",
      variantName: "Large",
      variantCustomerName: { en: "Large cup" },
      variantKitchenName: "LG",
      unitPrice: "3.50",
    });
    // The selection is a ProductPresentation superset, so T4's resolvers own the join/fallback.
    expect(staffPresentationName(selected)).toBe("Coffee · Large");
    expect(customerPresentationText(selected, "en")).toEqual({
      product: { en: "Fresh Coffee" },
      variant: { en: "Large cup" },
    });
  });

  it("leaves all three variant name pieces null when no variant is chosen", () => {
    const selected = selectMenuVariant({ ...offer, variants: [] }, [], null);
    expect(selected).toEqual({
      variantId: null,
      name: "Coffee",
      customerName: { en: "Fresh Coffee" },
      kitchenName: "BAR COFFEE",
      variantName: null,
      variantCustomerName: null,
      variantKitchenName: null,
      unitPrice: "8.00",
    });
    expect(staffPresentationName(selected)).toBe("Coffee");
  });

  // V1: a product whose variants were all removed sells as itself.
  it("sells a product whose every variant is Inactive as itself", () => {
    const removed = { ...large, active: false };
    expect(selectMenuVariant({ ...offer, variants: [] }, [removed], null)).toMatchObject({
      variantId: null,
      unitPrice: "8.00",
    });
    expect(() => selectMenuVariant(offer, [large], null)).toThrow(
      expect.objectContaining({ code: "product.variant_required" }),
    );
  });
});
