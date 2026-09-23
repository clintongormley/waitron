import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
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
import { INHERITED_KEYS, inheritFromParent } from "./variant-fallback.js";
import { seedVenue } from "../test/fixtures.js";

/**
 * A variant row is a `products` row with a `parent_id`, and a null in any inherited field reads as
 * its parent's (spec §1.2, §15.2, §15.3). No write path creates one yet, so every variant here is
 * inserted straight into the table.
 *
 * The parent and the two variants carry DIFFERENT values on every field a case reads, and each
 * product's three names are three different texts, so a reader that takes the wrong row or the
 * wrong name fails rather than passing on a shared value.
 */
const fx = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS], timeoutMs: 60_000 });
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

const PARENT_ALLERGENS = { sulphites: { presence: "contains" as const } };
const PARENT_DIET_DERIVATION = { origins: ["plant"], pending: false };

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
    const [station] = await tx
      .insert(kitchenStations)
      .values({ locationId: venue.locationId, name: "Bar" })
      .returning({ id: kitchenStations.id });
    const [course] = await tx
      .insert(kitchenCourses)
      .values({ locationId: venue.locationId, name: "Drinks" })
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
      .set({ stationId: station!.id, courseId: course!.id, dietDerivation: PARENT_DIET_DERIVATION })
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
    // Its own price, VAT, image, names, unit and category; everything else inherited.
    const [wine175] = await tx
      .insert(products)
      .values({
        catalogueId: catalogue.id,
        parentId: parent.id,
        categoryId: bottles.id,
        name: "Wine 175",
        customerName: { en: "Large glass of house wine" },
        kitchenName: "W175",
        pricingUnit: null,
        unitPrice: 550,
        vatClass: "general",
        dietaryDeclarations: null,
        image: "large.jpg",
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
      parentId: parent.id,
      wine125: wine125!.id,
      wine175: wine175!.id,
      menuId: catalogue.id,
    };
  });
});

describe("listProducts reads a variant's blanks from its parent", () => {
  it("fills every inherited field of a variant that sets none, and never its names", async () => {
    const all = await run((tx) => listProducts(tx, f.catalogueId));
    const wine = all.find((p) => p.id === f.wine125)!;
    expect(wine).toMatchObject({
      name: "Wine 125",
      customerName: null,
      kitchenName: null,
      unitPrice: "4.00",
      vatClass: "reduced",
      pricingUnit: "each",
      description: { en: "A dry white from Rueda" },
      categoryId: f.wines,
      primaryCategoryId: f.wines,
      categoryIds: [f.wines],
      unitId: f.glass,
      image: "parent.jpg",
      allergens: PARENT_ALLERGENS,
      manualAllergens: PARENT_ALLERGENS,
      dietOverride: { vegan: "yes" },
      dietaryDeclarations: ["vegan"],
    });
    expect(wine.unit.id).toBe(f.glass);
  });

  it("keeps every value a variant sets itself", async () => {
    const all = await run((tx) => listProducts(tx, f.catalogueId));
    const wine = all.find((p) => p.id === f.wine175)!;
    expect(wine).toMatchObject({
      name: "Wine 175",
      customerName: { en: "Large glass of house wine" },
      kitchenName: "W175",
      unitPrice: "5.50",
      vatClass: "general",
      image: "large.jpg",
      categoryId: f.bottles,
      categoryIds: [f.bottles],
      unitId: f.largeGlass,
      description: { en: "A dry white from Rueda" },
    });
  });

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
});

describe("listMenuOffers reads a variant's blanks from its parent", () => {
  it("resolves the effective values on an offer row naming a variant", async () => {
    await run(async (tx) => {
      const section = await createMenuSection(tx, { menuId: f.menuId, name: { en: "Wine" } });
      await tx.insert(menuItems).values([
        { menuId: f.menuId, productId: f.wine125, sectionId: section.id, grossPrice: 450 },
        { menuId: f.menuId, productId: f.wine175, sectionId: section.id, grossPrice: 600 },
      ]);
    });
    const offers = await run((tx) => listMenuOffers(tx, [f.menuId]));
    expect(offers.find((o) => o.productId === f.wine125)).toMatchObject({
      name: "Wine 125",
      customerName: null,
      kitchenName: null,
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
    expect(offers.find((o) => o.productId === f.wine175)).toMatchObject({
      name: "Wine 175",
      customerName: { en: "Large glass of house wine" },
      kitchenName: "W175",
      vatClass: "general",
      unit: { id: f.largeGlass },
      category: "Bottles",
      courseId: f.courseId,
    });
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
  it("shows a variant's inherited values and its own names", async () => {
    const value = await run((tx) => readProductEditor(tx, f.wine125));
    expect(value).toMatchObject({
      name: "Wine 125",
      customerName: null,
      kitchenName: null,
      unitPrice: "4.00",
      vatClass: "reduced",
      description: { en: "A dry white from Rueda" },
      image: "parent.jpg",
      allergens: PARENT_ALLERGENS,
      dietaryDeclarations: ["vegan"],
      stationId: f.stationId,
      courseId: f.courseId,
      unitId: f.glass,
      categoryIds: [f.wines],
      primaryCategoryId: f.wines,
    });
  });
});

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
    ).rejects.toMatchObject({ errcode: 787, message: "FOREIGN KEY constraint failed" });
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
      errcode: 275,
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
      errcode: 275,
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
    const all = await run((tx) => listProducts(tx, f.catalogueId));
    expect(all.find((p) => p.id === row!.id)!.dietaryDeclarations).toEqual([]);
  });

  it("reads the parent's when the variant stored an explicit null", async () => {
    const [stored] = await fx.db
      .select({ dietaryDeclarations: products.dietaryDeclarations })
      .from(products)
      .where(eq(products.id, f.wine125));
    expect(stored!.dietaryDeclarations).toBeNull();
    const all = await run((tx) => listProducts(tx, f.catalogueId));
    expect(all.find((p) => p.id === f.wine125)!.dietaryDeclarations).toEqual(["vegan"]);
  });
});

describe("inheritFromParent", () => {
  const parent: Record<string, unknown> = {
    name: "Wine by the glass",
    customerName: { en: "House wine" },
    kitchenName: "WINE",
    active: true,
    vatClass: "reduced",
    unitPrice: "4.00",
    image: "parent.jpg",
    description: { en: "A dry white" },
  };

  it("takes the parent's value for a null inherited key and keeps a set one", () => {
    const variant: Record<string, unknown> = {
      name: "Wine 175",
      customerName: null,
      kitchenName: null,
      active: false,
      vatClass: "general",
      unitPrice: null,
      image: null,
      description: null,
    };
    expect(inheritFromParent(variant, parent)).toEqual({
      name: "Wine 175",
      customerName: null,
      kitchenName: null,
      active: false,
      vatClass: "general",
      unitPrice: "4.00",
      image: "parent.jpg",
      description: { en: "A dry white" },
    });
  });

  it("never takes a name or the active flag from the parent, even when the variant's is null", () => {
    const variant: Record<string, unknown> = {
      name: null,
      customerName: null,
      kitchenName: null,
      active: null,
    };
    expect(inheritFromParent(variant, parent)).toEqual(variant);
  });

  it("returns a top-level product unchanged", () => {
    expect(inheritFromParent(parent, null)).toEqual(parent);
  });

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
