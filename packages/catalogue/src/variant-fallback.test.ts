import { beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  kitchenCourses,
  kitchenStations,
  products,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createMenuSection,
  createProduct,
  listAvailableProducts,
  listMenuOffers,
  listProducts,
} from "./operations.js";
import { createExtraList } from "./extras.js";
import { readOfferedModifiers } from "./offered-modifiers.js";
import { readProductEditor } from "./product-editor.js";
import { writeProductModifiers } from "./product-modifiers.js";
import { productCategories } from "./schema/categories.js";
import { menuItems } from "./schema/menu.js";
import { productUnits } from "./schema/units.js";
import { createUnit } from "./units.js";
import {
  effectiveProductColumns,
  INHERITED_KEYS,
  parentJoin,
  parentProducts,
} from "./variant-fallback.js";
import { seedVenue } from "../test/fixtures.js";

/**
 * A variant row is a `products` row with a `parent_id`, and a null in any inherited field reads as
 * its parent's (spec §1.2, §15.2, §15.3). Every variant here is inserted straight into the table,
 * because `setProductVariants` writes only a variant's names, photo and price and each case needs
 * the other inherited fields set too.
 *
 * The parent and the two variants carry DIFFERENT values on every field a case reads, and the
 * parent and Wine 175 each carry three different names (Wine 125 has only its staff name), so a
 * reader that takes the wrong row or the wrong name fails rather than passing on a shared value.
 */
const fx = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS], timeoutMs: 60_000 });
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

const PARENT_ALLERGENS = { sulphites: { presence: "contains" as const } };
const PARENT_DIET_DERIVATION = { origins: ["plant"], pending: false };
const PARENT_RECIPE_DERIVATION = { allergens: PARENT_ALLERGENS, pending: false };
// Wine 175's own value for every inherited field, each different from the parent's, so a read that
// takes the parent's where the variant has its own fails.
const W175_PUBLISHED_ALLERGENS = { milk: { presence: "contains" as const } };
const W175_MANUAL_ALLERGENS = { eggs: { presence: "may_contain" as const } };
const W175_RECIPE_DERIVATION = { allergens: W175_MANUAL_ALLERGENS, pending: true };
const W175_DIET_DERIVATION = { origins: ["dairy"], pending: true };
const W175_DIET_OVERRIDE = { vegetarian: "yes" as const };
const W175_DIET = { vegan: "no" as const, vegetarian: "yes" as const, contains: ["dairy"] };

interface Fixture {
  locationId: string;
  catalogueId: string;
  otherCatalogueId: string;
  wines: string;
  bottles: string;
  glass: string;
  largeGlass: string;
  stationId: string;
  courseId: string;
  ownStationId: string;
  ownCourseId: string;
  parentId: string;
  wine125: string;
  wine175: string;
  menuId: string;
}
let f: Fixture;

beforeEach(async () => {
  const venue = await seedVenue(fx.db);
  f = await run(async (tx) => {
    const catalogue = await createCatalogue(tx, { name: "Bar" });
    const other = await createCatalogue(tx, { name: "Terrace" });
    const wines = await createCategory(tx, { name: { en: "Wines" } });
    const bottles = await createCategory(tx, { name: { en: "Bottles" } });
    const glass = await createUnit(
      tx,
      { name: { en: "glass" }, precision: 0, abbreviation: { en: "gl" } },
      "en",
    );
    const largeGlass = await createUnit(
      tx,
      { name: { en: "large glass" }, precision: 0, abbreviation: { en: "lg" } },
      "en",
    );
    const [station, ownStation] = await tx
      .insert(kitchenStations)
      .values([
        { locationId: venue.locationId, name: "Bar" },
        { locationId: venue.locationId, name: "Cellar" },
      ])
      .returning({ id: kitchenStations.id });
    const [course, ownCourse] = await tx
      .insert(kitchenCourses)
      .values([
        { locationId: venue.locationId, name: "Drinks" },
        { locationId: venue.locationId, name: "Dessert wine" },
      ])
      .returning({ id: kitchenCourses.id });
    const parent = await createProduct(tx, {
      catalogueId: catalogue.id,
      categoryId: wines.id,
      name: "Wine by the glass",
      customerName: { en: "House wine" },
      kitchenName: "WINE",
      description: { en: "A dry white from Rueda" },
      unitId: glass.id,
      unitPrice: "4.00",
      vatClass: "reduced",
      allergens: PARENT_ALLERGENS,
      dietOverride: { vegan: "yes" },
      dietaryDeclarations: ["vegan"],
      image: "parent.jpg",
    });
    await tx
      .update(products)
      .set({
        stationId: station!.id,
        courseId: course!.id,
        dietDerivation: PARENT_DIET_DERIVATION,
        recipeDerivation: PARENT_RECIPE_DERIVATION,
      })
      .where(eq(products.id, parent.id));
    // Every inherited field null — dietary declarations as an EXPLICIT null, which is what makes
    // it inherit (an omitted one takes the column's `[]` default; see the case below) — and no
    // customer or kitchen name of its own.
    const [wine125] = await tx
      .insert(products)
      .values({
        catalogueId: catalogue.id,
        parentId: parent.id,
        name: "Wine 125",
        pricingUnit: null,
        unitPrice: null,
        vatClass: null,
        dietaryDeclarations: null,
      })
      .returning({ id: products.id });
    // Its own value for every inherited field, and its own names, unit row and category row.
    const [wine175] = await tx
      .insert(products)
      .values({
        catalogueId: catalogue.id,
        parentId: parent.id,
        categoryId: bottles.id,
        name: "Wine 175",
        customerName: { en: "Large glass of house wine" },
        kitchenName: "W175",
        description: { en: "A sweet red from Toro" },
        pricingUnit: "weight",
        unitPrice: 550,
        vatClass: "general",
        dietaryDeclarations: ["vegetarian"],
        image: "large.jpg",
        stationId: ownStation!.id,
        courseId: ownCourse!.id,
        allergens: W175_PUBLISHED_ALLERGENS,
        manualAllergens: W175_MANUAL_ALLERGENS,
        recipeDerivation: W175_RECIPE_DERIVATION,
        dietDerivation: W175_DIET_DERIVATION,
        dietOverride: W175_DIET_OVERRIDE,
        diet: W175_DIET,
        variantOrder: 1,
      })
      .returning({ id: products.id });
    await tx.insert(productUnits).values({ productId: wine175!.id, unitId: largeGlass.id });
    await tx.insert(productCategories).values({ productId: wine175!.id, categoryId: bottles.id });
    await assignCatalogueToLocation(tx, venue.locationId, catalogue.id);
    return {
      locationId: venue.locationId,
      catalogueId: catalogue.id,
      otherCatalogueId: other.id,
      wines: wines.id,
      bottles: bottles.id,
      glass: glass.id,
      largeGlass: largeGlass.id,
      stationId: station!.id,
      courseId: course!.id,
      ownStationId: ownStation!.id,
      ownCourseId: ownCourse!.id,
      parentId: parent.id,
      wine125: wine125!.id,
      wine175: wine175!.id,
      menuId: catalogue.id,
    };
  });
});

describe("listProducts lists the parent alone, its variants nested under it", () => {
  it("reads the parent itself unchanged", async () => {
    const all = await run((tx) => listProducts(tx, f.catalogueId));
    expect(all.find((p) => p.id === f.parentId)).toMatchObject({
      name: "Wine by the glass",
      customerName: { en: "House wine" },
      kitchenName: "WINE",
      unitPrice: "4.00",
      vatClass: "reduced",
      categoryIds: [f.wines],
      unitId: f.glass,
    });
  });

  it("nests each variant by its own names and stored price, never listing it on its own", async () => {
    const all = await run((tx) => listProducts(tx, f.catalogueId));
    expect(all.map((p) => p.id)).toEqual([f.parentId]);
    expect(all[0]!.variants).toEqual([
      {
        id: f.wine125,
        name: "Wine 125",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: null,
        available: true,
        active: true,
      },
      {
        id: f.wine175,
        name: "Wine 175",
        customerName: { en: "Large glass of house wine" },
        kitchenName: "W175",
        image: "large.jpg",
        unitPrice: "5.50",
        available: true,
        active: true,
      },
    ]);
  });
});

describe("listMenuOffers reads a variant's blanks from its parent", () => {
  // The parent's own price (4.00) and its price on this menu (4.50) differ, so a variant that
  // inherits its price and is charged 4.00 was priced from the wrong step of the chain.
  it("resolves the effective values of each variant nested under the parent's offer", async () => {
    await run(async (tx) => {
      const section = await createMenuSection(tx, { menuId: f.menuId, name: { en: "Wine" } });
      await tx.insert(menuItems).values({
        menuId: f.menuId,
        productId: f.parentId,
        sectionId: section.id,
        grossPrice: 450,
      });
    });
    const offers = await run((tx) => listMenuOffers(tx, [f.menuId]));
    expect(offers.map((o) => o.productId)).toEqual([f.parentId]);
    const { variants } = offers[0]!;
    expect(variants.map((v) => v.id)).toEqual([f.wine125, f.wine175]);
    expect(variants[0]).toMatchObject({
      name: "Wine 125",
      customerName: null,
      kitchenName: null,
      unitPrice: "4.50",
      menuPrice: null,
      offered: true,
      available: true,
      image: "parent.jpg",
      vatClass: "reduced",
      pricingUnit: "each",
      unit: { id: f.glass },
      category: "Wines",
      allergens: PARENT_ALLERGENS,
      dietOverride: { vegan: "yes" },
      dietDerivation: PARENT_DIET_DERIVATION,
      dietaryDeclarations: ["vegan"],
      courseId: f.courseId,
    });
    expect(variants[1]).toMatchObject({
      name: "Wine 175",
      customerName: { en: "Large glass of house wine" },
      kitchenName: "W175",
      unitPrice: "5.50",
      image: "large.jpg",
      vatClass: "general",
      pricingUnit: "weight",
      unit: { id: f.largeGlass },
      category: "Bottles",
      allergens: W175_PUBLISHED_ALLERGENS,
      diet: W175_DIET,
      dietOverride: W175_DIET_OVERRIDE,
      dietDerivation: W175_DIET_DERIVATION,
      dietaryDeclarations: ["vegetarian"],
      courseId: f.ownCourseId,
    });
  });
});

describe("a variant's reporting category comes from the product whose category rows apply", () => {
  // Having no `product_categories` row is how a variant stores "inherit the parent's categories"
  // (V12), so the reporting category follows the same owner as the list. A variant with rows of its
  // own and no reporting category reads its OWN null, never the parent's category outside its list.
  it("reads its own blank reporting category beside category rows of its own", async () => {
    const wine250 = await run(async (tx) => {
      const [row] = await tx
        .insert(products)
        .values({
          catalogueId: f.catalogueId,
          parentId: f.parentId,
          name: "Wine 250",
          categoryId: null,
          pricingUnit: null,
          unitPrice: null,
          vatClass: null,
          dietaryDeclarations: null,
          variantOrder: 2,
        })
        .returning({ id: products.id });
      await tx.insert(productCategories).values({ productId: row!.id, categoryId: f.bottles });
      const section = await createMenuSection(tx, { menuId: f.menuId, name: { en: "Wine" } });
      await tx.insert(menuItems).values({
        menuId: f.menuId,
        productId: f.parentId,
        sectionId: section.id,
        grossPrice: 700,
      });
      return row!.id;
    });

    const offers = await run((tx) => listMenuOffers(tx, [f.menuId]));
    expect(offers[0]!.variants.find((v) => v.id === wine250)!.category).toBeNull();
  });
});

describe("listAvailableProducts", () => {
  // The plain product list sells an entry under its own frozen names; a variant sold that way
  // would be filed as if it were a product in its own right (Review Focus 4).
  it("lists the parent and neither variant", async () => {
    const { products: listed } = await run((tx) => listAvailableProducts(tx, f.locationId));
    const ids = listed.map((p) => p.id);
    expect(ids).toContain(f.parentId);
    expect(ids).not.toContain(f.wine125);
    expect(ids).not.toContain(f.wine175);
  });
});

describe("readOfferedModifiers", () => {
  it("offers a variant as an extras item at its parent's VAT and price", async () => {
    const dish = await run(async (tx) => {
      const burger = await createProduct(tx, {
        catalogueId: f.catalogueId,
        categoryId: null,
        name: "Burger",
        unitId: null,
        unitPrice: "9.00",
        vatClass: "general",
      });
      const list = await createExtraList(
        tx,
        {
          name: "Drinks staff",
          customerName: { en: "Add a drink" },
          kitchenName: "DRK",
          minPicks: 0,
          maxPicks: 1,
          items: [{ productId: f.wine125 }],
        },
        "en",
      );
      await writeProductModifiers(tx, burger.id, [{ kind: "extras", id: list.id }]);
      return burger.id;
    });
    const offered = await run((tx) =>
      readOfferedModifiers(tx, [{ productId: dish, menuItemId: null }]),
    );
    const [entry] = offered.get(dish)!;
    expect(entry!.kind).toBe("extras");
    expect(entry!.kind === "extras" && entry!.items).toEqual([
      expect.objectContaining({
        productId: f.wine125,
        name: "Wine 125",
        customerName: null,
        kitchenName: null,
        vatClass: "reduced",
        price: "4.00",
        addAllergens: PARENT_ALLERGENS,
      }),
    ]);
  });
});

describe("readProductEditor", () => {
  // The editor shows a variant's OWN values, a blank field blank, and its parent's value for every
  // inherited field beside them (spec §4.4, §9.1). Wine 125 has no unit or category row and so
  // inherits both; Wine 175 has its own.
  const parentValues = () => ({
    description: { en: "A dry white from Rueda" },
    image: "parent.jpg",
    unitPrice: "4.00",
    vatClass: "reduced",
    unitId: f.glass,
    categoryIds: [f.wines],
    primaryCategoryId: f.wines,
    stationId: f.stationId,
    courseId: f.courseId,
    allergens: PARENT_ALLERGENS,
    dietaryDeclarations: ["vegan"],
  });

  it("reads a variant that inherits every field as blank, its parent's values beside them", async () => {
    expect(await run((tx) => readProductEditor(tx, f.wine125))).toMatchObject({
      parentId: f.parentId,
      name: "Wine 125",
      customerName: null,
      kitchenName: null,
      description: null,
      image: null,
      unitPrice: null,
      vatClass: null,
      unitId: null,
      categoryIds: [],
      primaryCategoryId: null,
      stationId: null,
      courseId: null,
      allergens: null,
      dietaryDeclarations: null,
      inherited: parentValues(),
    });
  });

  it("reads a variant's own value for every field it sets, never its parent's", async () => {
    expect(await run((tx) => readProductEditor(tx, f.wine175))).toMatchObject({
      parentId: f.parentId,
      name: "Wine 175",
      customerName: { en: "Large glass of house wine" },
      kitchenName: "W175",
      description: { en: "A sweet red from Toro" },
      image: "large.jpg",
      unitPrice: "5.50",
      vatClass: "general",
      unitId: f.largeGlass,
      categoryIds: [f.bottles],
      primaryCategoryId: f.bottles,
      stationId: f.ownStationId,
      courseId: f.ownCourseId,
      allergens: W175_MANUAL_ALLERGENS,
      dietaryDeclarations: ["vegetarian"],
      inherited: parentValues(),
    });
  });

  it("reads the parent itself with no parent and nothing inherited", async () => {
    await expect(run((tx) => readProductEditor(tx, f.parentId))).resolves.toMatchObject({
      parentId: null,
      inherited: null,
      name: "Wine by the glass",
      unitPrice: "4.00",
      vatClass: "reduced",
    });
  });
});

describe("effectiveProductColumns, entry by entry", () => {
  // Every entry read straight, for the parent and both variants: Wine 125 (every field blank)
  // must read the parent's value and Wine 175 (every field set, each different from the parent's)
  // its own. An entry with its two sides swapped fails one of the two.
  it("reads the parent's value for a blank field and the variant's own for a set one", async () => {
    const raw = await run((tx) =>
      tx
        .select({ id: products.id, ...pickRaw() })
        .from(products)
        .where(inArray(products.id, [f.parentId, f.wine175])),
    );
    const effective = await run((tx) =>
      tx
        .select({ id: products.id, ...effectiveProductColumns })
        .from(products)
        .leftJoin(parentProducts, parentJoin)
        .where(inArray(products.id, [f.wine125, f.wine175])),
    );
    const parentRaw = raw.find((row) => row.id === f.parentId)!;
    const wine175Raw = raw.find((row) => row.id === f.wine175)!;
    const byId = new Map(effective.map((row) => [row.id, row]));
    for (const key of INHERITED_KEYS) {
      // The fixture's own guarantee: a set, DIFFERENT value on each side of every entry.
      expect(parentRaw[key], key).not.toBeNull();
      expect(wine175Raw[key], key).not.toEqual(parentRaw[key]);
      expect(byId.get(f.wine125)![key], key).toEqual(parentRaw[key]);
      expect(byId.get(f.wine175)![key], key).toEqual(wine175Raw[key]);
    }
  });
});

/** Each inherited column's STORED value, keyed like {@link effectiveProductColumns}. */
function pickRaw() {
  return Object.fromEntries(INHERITED_KEYS.map((key) => [key, products[key]])) as {
    [K in (typeof INHERITED_KEYS)[number]]: (typeof products)[K];
  };
}

describe("createProduct", () => {
  it("returns the values of the top-level product it created", async () => {
    const created = await run((tx) =>
      createProduct(tx, {
        catalogueId: f.catalogueId,
        categoryId: f.bottles,
        name: "Cava",
        customerName: { en: "Sparkling" },
        kitchenName: "CAVA",
        unitId: f.largeGlass,
        unitPrice: "6.25",
        vatClass: "general",
        image: "cava.jpg",
      }),
    );
    expect(created).toMatchObject({
      name: "Cava",
      unitPrice: "6.25",
      vatClass: "general",
      image: "cava.jpg",
      unitId: f.largeGlass,
      categoryIds: [f.bottles],
      primaryCategoryId: f.bottles,
    });
  });
});

describe("what the products table refuses", () => {
  it("refuses a variant in a different catalogue from its parent", async () => {
    await expect(
      fx.db.insert(products).values({
        catalogueId: f.otherCatalogueId,
        parentId: f.parentId,
        name: "Stray variant",
      }),
    ).rejects.toMatchObject({
      errcode: FOREIGN_KEY_VIOLATION[0],
      message: "FOREIGN KEY constraint failed",
    });
  });

  // The accepting control for the case above: the same insert in the parent's catalogue.
  it("accepts a variant in its parent's catalogue", async () => {
    await expect(
      fx.db
        .insert(products)
        .values({ catalogueId: f.catalogueId, parentId: f.parentId, name: "Wine 250" }),
    ).resolves.toBeDefined();
  });

  it("refuses a top-level product with no VAT class", async () => {
    await expect(
      fx.db.insert(products).values({
        catalogueId: f.catalogueId,
        name: "No VAT",
        pricingUnit: "each",
        unitPrice: 100,
        vatClass: null,
      }),
    ).rejects.toMatchObject({
      errcode: CHECK_VIOLATION[0],
      message: "CHECK constraint failed: products_top_level_owns_ck",
    });
  });

  it("refuses a top-level product with no price", async () => {
    await expect(
      fx.db.insert(products).values({
        catalogueId: f.catalogueId,
        name: "No price",
        pricingUnit: "each",
        unitPrice: null,
        vatClass: "general",
      }),
    ).rejects.toMatchObject({
      errcode: CHECK_VIOLATION[0],
      message: "CHECK constraint failed: products_top_level_owns_ck",
    });
  });

  // Also pins that `products_vat_class_ck` and `products_pricing_unit_ck` let a NULL through.
  it("accepts a variant with no VAT class, price or pricing unit", async () => {
    await expect(
      fx.db.insert(products).values({
        catalogueId: f.catalogueId,
        parentId: f.parentId,
        name: "Wine 500",
        pricingUnit: null,
        unitPrice: null,
        vatClass: null,
      }),
    ).resolves.toBeDefined();
  });
});

describe("dietary declarations on a variant", () => {
  // Why every variant writer passes `null` explicitly: an omitted value takes the column's `[]`
  // default, which is a value of the variant's own, so it does NOT inherit.
  it("stores the column default when the field is omitted, and reads it as the variant's own", async () => {
    const [row] = await fx.db
      .insert(products)
      .values({ catalogueId: f.catalogueId, parentId: f.parentId, name: "Wine 250" })
      .returning({ id: products.id, dietaryDeclarations: products.dietaryDeclarations });
    expect(row!.dietaryDeclarations).toEqual([]);
    expect(await effectiveDeclarations(row!.id)).toEqual([]);
  });

  it("reads the parent's when the variant stored an explicit null", async () => {
    const [stored] = await fx.db
      .select({ dietaryDeclarations: products.dietaryDeclarations })
      .from(products)
      .where(eq(products.id, f.wine125));
    expect(stored!.dietaryDeclarations).toBeNull();
    expect(await effectiveDeclarations(f.wine125)).toEqual(["vegan"]);
  });

  /** A variant is not a row of `listProducts` (it is nested there by its names alone), so its
   * effective declarations are read through the fallback itself. */
  async function effectiveDeclarations(id: string) {
    const [row] = await run((tx) =>
      tx
        .select({ dietaryDeclarations: effectiveProductColumns.dietaryDeclarations })
        .from(products)
        .leftJoin(parentProducts, parentJoin)
        .where(eq(products.id, id)),
    );
    return row!.dietaryDeclarations;
  }
});

describe("INHERITED_KEYS", () => {
  // Spec §1.2 minus the three names (§15.2), with the price (§15.3) and the photo (V11). Pinned
  // whole, so a key added or dropped is a decision somebody makes here rather than by accident.
  it("inherits exactly the spec's set, and none of the names, flags or identity", () => {
    expect([...INHERITED_KEYS].sort()).toEqual(
      [
        "allergens",
        "categoryId",
        "courseId",
        "description",
        "diet",
        "dietDerivation",
        "dietOverride",
        "dietaryDeclarations",
        "image",
        "manualAllergens",
        "pricingUnit",
        "recipeDerivation",
        "stationId",
        "unitPrice",
        "vatClass",
      ].sort(),
    );
  });
});
