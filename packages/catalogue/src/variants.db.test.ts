import { describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, products, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { productLabels } from "./schema/labels.js";
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
  type VariantWrite,
} from "./variants.js";
import { staffPresentationName, customerPresentationText } from "./product-presentation.js";
import { createUnit, EACH_UNIT } from "./units.js";
import { addProductsToCategory, createCategory, setMainReportingCategory } from "./categories.js";
import { createLabel, readProductLabels, setProductLabels } from "./labels.js";

/**
 * Variants against a real database, plus the pure selection core. A variant is a `products` row
 * with a `parent_id` (spec §15); the per-menu settings of one live in
 * `menu_item_variant_overrides`, and a row there exists only while it overrides something.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const app = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

/** Leaves `active` out, as a caller in code may: a new variant is then created Active. */
const wine = (
  name: string,
  unitPrice: string | null,
  extra: Partial<VariantWrite> = {},
): VariantWrite => ({
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
    // No unit or label row of their own: that is how a variant inherits both.
    const ids = saved.map((variant) => variant.id);
    expect(
      await suite.db.select().from(productUnits).where(inArray(productUnits.productId, ids)),
    ).toEqual([]);
    expect(
      await suite.db.select().from(productLabels).where(inArray(productLabels.productId, ids)),
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

  it("writes each sent variant's active as sent, in the order sent, the left-out ones after", async () => {
    const f = await fixture();
    const [w125, w175, w250] = await app((tx) =>
      setProductVariants(
        tx,
        f.parentId,
        [wine("Wine 125", null), wine("Wine 175", "5.50"), wine("Wine 250", "7.00")],
        "en",
      ),
    );
    await app((tx) => setProductVariants(tx, f.parentId, [w125!, w250!], "en"));
    const flags = async () =>
      (await storedVariants(f.parentId)).map(({ id, variant_order, active }) => ({
        id,
        variant_order,
        active,
      }));

    // Wine 175 was removed; sent back Inactive it stays Inactive, at the place it was sent.
    const saved = await app((tx) =>
      setProductVariants(tx, f.parentId, [{ ...w175!, active: false }, w125!], "en"),
    );
    expect(await flags()).toEqual([
      { id: w175!.id, variant_order: 0, active: 0 },
      { id: w125!.id, variant_order: 1, active: 1 },
      { id: w250!.id, variant_order: 2, active: 0 },
    ]);
    expect(saved.map(({ id, active }) => ({ id, active }))).toEqual([
      { id: w175!.id, active: false },
      { id: w125!.id, active: true },
      { id: w250!.id, active: false },
    ]);

    await app((tx) =>
      setProductVariants(
        tx,
        f.parentId,
        [{ ...w250!, active: false }, { ...w175!, active: true }, w125!],
        "en",
      ),
    );
    expect(await flags()).toEqual([
      { id: w250!.id, variant_order: 0, active: 0 },
      { id: w175!.id, variant_order: 1, active: 1 },
      { id: w125!.id, variant_order: 2, active: 1 },
    ]);
  });

  it("creates a new variant sent Inactive as Inactive", async () => {
    const f = await fixture();
    await app((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null, { active: false })], "en"),
    );
    expect(
      (await storedVariants(f.parentId)).map(({ active, available }) => ({ active, available })),
    ).toEqual([{ active: 0, available: 1 }]);
  });

  // Only an absent `active` is defaulted: an explicit null is refused like any other non-boolean.
  it.each([["yes"], [null]])("refuses an active of %j, writing nothing", async (active) => {
    const f = await fixture();
    await expect(
      app((tx) =>
        setProductVariants(
          tx,
          f.parentId,
          [wine("Wine 125", null, { active: active as unknown as boolean })],
          "en",
        ),
      ),
    ).rejects.toMatchObject({ code: "product.variant_invalid", params: { field: "active" } });
    expect(await storedVariants(f.parentId)).toEqual([]);
  });

  // A re-save that leaves `active` out must not restore a removed variant without saying so.
  it("keeps a variant sent by id with no active as it already is, Active or Inactive", async () => {
    const f = await fixture();
    const saved = await app((tx) =>
      setProductVariants(
        tx,
        f.parentId,
        [wine("Wine 125", null, { active: false }), wine("Wine 175", "5.50")],
        "en",
      ),
    );
    const withoutActive = saved.map((variant) => {
      const sent: VariantWrite = { ...variant };
      delete sent.active;
      return sent;
    });
    await app((tx) => setProductVariants(tx, f.parentId, withoutActive, "en"));
    expect((await storedVariants(f.parentId)).map(({ active }) => active)).toEqual([0, 1]);
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
  it("reads a removed variant as Inactive, so saving the parent back cannot restore it", async () => {
    const f = await fixture();
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
    expect(value.variants.map(({ id, active }) => ({ id, active }))).toEqual([
      { id: w125!.id, active: true },
      { id: w175!.id, active: false },
    ]);

    await app((tx) => saveProductEditor(tx, f.parentId, f.catalogueId, value, "en"));
    expect((await storedVariants(f.parentId)).map(({ id, active }) => ({ id, active }))).toEqual([
      { id: w125!.id, active: 1 },
      { id: w175!.id, active: 0 },
    ]);
  });
});

describe("a variant's id is not a product's id to the product-by-id functions but its own page", () => {
  async function variantOfParent() {
    const f = await fixture();
    const [w125] = await app((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", "4.75")], "en"),
    );
    const category = await app((tx) => createCategory(tx, { name: { en: "Wines" } }, "en"));
    return { ...f, variantId: w125!.id, categoryId: category.id };
  }
  const notFound = (productId: string) => ({ code: "product.not_found", params: { productId } });

  // The editor is the one exception: it is a variant's own page too (spec §4.4).
  it("reads and saves a variant's own editor, and never takes a product's body for it", async () => {
    const f = await variantOfParent();
    const value = await app((tx) => readProductEditor(tx, f.variantId));
    expect(value).toMatchObject({ id: f.variantId, parentId: f.parentId, vatClass: null });
    const parent = await app((tx) => readProductEditor(tx, f.parentId));
    // The parent's body names no parent, so it is refused on the variant, writing nothing.
    await expect(
      app((tx) =>
        saveProductEditor(
          tx,
          f.variantId,
          f.catalogueId,
          { ...parent, vatClass: "general", variants: [] },
          "en",
        ),
      ),
    ).rejects.toMatchObject({ code: "product.invalid", params: { field: "parentId" } });
    expect((await storedVariants(f.parentId))[0]).toMatchObject({ vat_class: null });
    await expect(
      app((tx) =>
        saveProductEditor(tx, f.variantId, f.catalogueId, { ...value, vatClass: "general" }, "en"),
      ),
    ).resolves.toMatchObject({ id: f.variantId, vatClass: "general" });
    expect((await storedVariants(f.parentId))[0]).toMatchObject({ vat_class: "general" });
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

  it("sets a product's main category and labels, never a variant's own through their routes", async () => {
    const f = await variantOfParent();
    const label = await app((tx) => createLabel(tx, "Wine"));
    await expect(
      app((tx) => setMainReportingCategory(tx, f.variantId, f.categoryId)),
    ).rejects.toMatchObject(notFound(f.variantId));
    await expect(
      app((tx) => addProductsToCategory(tx, f.categoryId, [f.variantId])),
    ).rejects.toMatchObject({ code: "category.membership_invalid" });
    await expect(app((tx) => setProductLabels(tx, f.variantId, [label.id]))).rejects.toMatchObject({
      code: "product.variant_invalid",
      params: { field: "labelIds" },
    });
    expect(
      await suite.db.select().from(productLabels).where(eq(productLabels.productId, f.variantId)),
    ).toEqual([]);
    expect((await storedVariants(f.parentId))[0]).toMatchObject({ category_id: null });

    await app((tx) => addProductsToCategory(tx, f.categoryId, [f.parentId]));
    await app((tx) => setProductLabels(tx, f.parentId, [label.id]));
    await expect(
      app((tx) => setMainReportingCategory(tx, f.parentId, f.categoryId)),
    ).resolves.toEqual({ primaryCategoryId: f.categoryId });
    // The variant still stores neither, and reads its parent's labels.
    expect((await storedVariants(f.parentId))[0]).toMatchObject({ category_id: null });
    expect(await app((tx) => readProductLabels(tx, f.variantId))).toEqual([label.id]);
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
  // not start early. Removing is always allowed (spec §15.6), so both succeed.
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

// selectMenuVariant is the pure core of menu-variant resolution — no DB. It decides from the offer
// alone: an offer listing any variant must name one, and the chosen one must be listed as
// sellable here now. It returns the six name pieces in the shape product-presentation.ts consumes,
// and the chosen row's product id and EFFECTIVE selling values, so the order path prices and routes
// the line from them.
const glass = { ...EACH_UNIT, id: "66666666-6666-4666-8666-666666666666" };
const bottle = { ...EACH_UNIT, id: "77777777-7777-4777-8777-777777777777" };

describe("selectMenuVariant resolves the chosen product and its parent's names", () => {
  const large = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Large",
    customerName: { en: "Large cup" },
    kitchenName: "LG",
    unitPrice: "3.50",
    available: true,
    unit: bottle,
    vatClass: "reduced" as const,
    category: "Hot drinks",
    courseId: "88888888-8888-4888-8888-888888888888",
  };
  const offer = {
    productId: "22222222-2222-2222-2222-222222222222",
    name: "Coffee",
    customerName: { en: "Fresh Coffee" },
    kitchenName: "BAR COFFEE",
    unitPrice: "8.00",
    unit: glass,
    vatClass: "general" as const,
    category: "Drinks",
    courseId: null,
    variants: [large],
  };

  it("carries the parent's names, the chosen variant's own three names, and the variant's effective values", () => {
    const selected = selectMenuVariant(offer, large.id);
    expect(selected).toEqual({
      productId: large.id,
      name: "Coffee",
      customerName: { en: "Fresh Coffee" },
      kitchenName: "BAR COFFEE",
      variantName: "Large",
      variantCustomerName: { en: "Large cup" },
      variantKitchenName: "LG",
      unitPrice: "3.50",
      unit: bottle,
      vatClass: "reduced",
      category: "Hot drinks",
      courseId: large.courseId,
    });
    // The selection is a ProductPresentation superset, so the resolvers there own the naming.
    expect(staffPresentationName(selected)).toBe("Large");
    expect(customerPresentationText(selected, "en")).toEqual({
      product: { en: "Fresh Coffee" },
      variant: { en: "Large cup" },
    });
  });

  it("sells the offer's own product, with its own values, when it lists no variant", () => {
    const selected = selectMenuVariant({ ...offer, variants: [] }, null);
    expect(selected).toEqual({
      productId: offer.productId,
      name: "Coffee",
      customerName: { en: "Fresh Coffee" },
      kitchenName: "BAR COFFEE",
      variantName: null,
      variantCustomerName: null,
      variantKitchenName: null,
      unitPrice: "8.00",
      unit: glass,
      vatClass: "general",
      category: "Drinks",
      courseId: null,
    });
    expect(staffPresentationName(selected)).toBe("Coffee");
  });

  // An offer lists only Active variants, so a product whose variants were all removed lists
  // none and sells as itself; one listing any, even an unavailable one, must name one.
  it("requires a variant whenever the offer lists one, available or not", () => {
    for (const variants of [[large], [{ ...large, available: false }]]) {
      expect(() => selectMenuVariant({ ...offer, variants }, null)).toThrow(
        expect.objectContaining({
          code: "product.variant_required",
          params: { productId: offer.productId },
        }),
      );
    }
  });
});

describe("selectMenuVariant refuses a variant it may not sell", () => {
  const small = {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Small",
    customerName: null,
    kitchenName: null,
    unitPrice: "2.50",
    available: true,
    unit: glass,
    vatClass: "general" as const,
    category: null,
    courseId: null,
  };
  const offer = {
    productId: "44444444-4444-4444-8444-444444444444",
    name: "Coffee",
    customerName: null,
    kitchenName: null,
    unitPrice: "8.00",
    unit: glass,
    vatClass: "general" as const,
    category: null,
    courseId: null,
    variants: [small],
  };
  const refused = expect.objectContaining({
    code: "product.variant_unavailable",
    params: { variantId: small.id },
  });

  // `available` on an offer's variant is Active, Available AND offered on this menu.
  it("refuses a variant the offer lists as not sellable here now", () => {
    expect(() =>
      selectMenuVariant({ ...offer, variants: [{ ...small, available: false }] }, small.id),
    ).toThrow(refused);
  });

  // An Inactive variant, or another product's, is never listed under this offer.
  it("refuses a variant the offer does not list", () => {
    const other = { ...small, id: "55555555-5555-4555-8555-555555555555" };
    expect(() => selectMenuVariant({ ...offer, variants: [other] }, small.id)).toThrow(refused);
  });
});
