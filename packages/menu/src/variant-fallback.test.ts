import { beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  kitchenCourses,
  products,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignMenuToVenue,
  addProductToMenu,
  createMenu,
  createCategory,
  createProduct,
  listAvailableProducts,
  listMenuOffers,
  listProducts,
} from "./operations.js";
import { createExtraList } from "./extras.js";
import { readOfferedModifiers } from "./offered-modifiers.js";
import { readProductEditor } from "./product-editor.js";
import { writeProductModifiers } from "./product-modifiers.js";
import { createUnit, EACH_UNIT } from "./units.js";
import { selectMenuVariant } from "./variants.js";
import { setTakeawayVatRate } from "./takeaway-vat-rates.js";
import {
  effectiveProductColumns,
  INHERITED_KEYS,
  parentJoin,
  parentProducts,
} from "./variant-fallback.js";
import { plantStoredUnit, seedVenueWithSeries } from "../test/fixtures.js";
import { libraryImageName, seedLibraryImages } from "../test/library-images.js";

/**
 * A variant row is a `products` row with a `parent_id`, and a null in any inherited field reads as
 * its parent's. Every variant here is inserted straight into the table,
 * because `setProductVariants` writes only a variant's names, photo and price and each case needs
 * the other inherited fields set too.
 *
 * The parent and the two variants carry DIFFERENT values on every field a case reads, and the
 * parent and 175 ml each carry three different names (125 ml has only its staff name), so a
 * reader that takes the wrong row or the wrong name fails rather than passing on a shared value.
 */
const fx = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
beforeEach(() => seedLibraryImages(fx.db, "cava.jpg", "large.jpg", "parent.jpg"));
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

const PARENT_ALLERGENS = { sulphites: {} };
// 175 ml's own value for every inherited field, each different from the parent's, so a read that
// takes the parent's where the variant has its own fails.
const W175_PUBLISHED_ALLERGENS = { milk: {} };
const W175_DIET_OVERRIDE = { vegetarian: "yes" as const };
const W175_DIET = { vegan: "unknown" as const, vegetarian: "yes" as const, contains: [] };

interface Fixture {
  menuId: string;
  otherMenuId: string;
  wines: string;
  bottles: string;
  glass: string;
  largeGlass: string;
  courseId: string;
  ownCourseId: string;
  parentId: string;
  wine125: string;
  wine175: string;
}
let f: Fixture;

beforeEach(async () => {
  await seedVenueWithSeries(fx.db);
  f = await run(async (tx) => {
    const menu = await createMenu(tx, { name: "Bar" });
    const other = await createMenu(tx, { name: "Terrace" });
    const wines = await createCategory(tx, { name: "Wines" });
    const bottles = await createCategory(tx, { name: "Bottles" });
    const glass = await createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "glass" },
        precision: 0,
        abbreviation: { en: "gl" },
      },
      "en",
    );
    const largeGlass = await createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "large glass" },
        precision: 0,
        abbreviation: { en: "lg" },
      },
      "en",
    );
    const [course, ownCourse] = await tx
      .insert(kitchenCourses)
      .values([{ name: "Drinks" }, { name: "Dessert wine" }])
      .returning({ id: kitchenCourses.id });
    const parent = await createProduct(tx, {
      categoryId: wines.id,
      name: "Wine by the glass",
      customerName: { en: "House wine" },
      kitchenName: "WINE",
      description: { en: "A dry white from Rueda" },
      unitId: glass.id,
      unitPrice: "4.00",
      vatClass: "reduced",
      takeawayVatRate: "21.00",
      allergens: PARENT_ALLERGENS,
      dietOverride: { vegan: "yes" },
      dietaryDeclarations: ["vegan"],
      image: libraryImageName("parent.jpg"),
    });
    await tx
      .update(products)
      .set({
        courseId: course!.id,
        color: "#256bb1",
      })
      .where(eq(products.id, parent.id));
    // Every inherited field null — dietary declarations as an EXPLICIT null, which is what makes
    // it inherit (an omitted one takes the column's `[]` default; see the case below) — and no
    // customer or kitchen name of its own.
    const [wine125] = await tx
      .insert(products)
      .values({
        parentId: parent.id,
        name: "125 ml",

        unitPrice: null,
        vatClass: null,
        dietaryDeclarations: null,
      })
      .returning({ id: products.id });
    const [wine175] = await tx
      .insert(products)
      .values({
        parentId: parent.id,
        categoryId: bottles.id,
        name: "175 ml",
        customerName: { en: "Large glass of house wine" },
        kitchenName: "W175",
        description: { en: "A sweet red from Toro" },

        unitPrice: 550,
        vatClass: "general",
        dietaryDeclarations: ["vegetarian"],
        image: libraryImageName("large.jpg"),
        courseId: ownCourse!.id,
        allergens: W175_PUBLISHED_ALLERGENS,
        dietOverride: W175_DIET_OVERRIDE,
        color: "#b12525",
        variantOrder: 1,
      })
      .returning({ id: products.id });
    await tx.update(products).set({ unitId: largeGlass.id }).where(eq(products.id, wine175!.id));
    await setTakeawayVatRate(tx, wine175!.id, "0.00");
    await assignMenuToVenue(tx, menu.id);
    return {
      menuId: menu.id,
      otherMenuId: other.id,
      wines: wines.id,
      bottles: bottles.id,
      glass: glass.id,
      largeGlass: largeGlass.id,
      courseId: course!.id,
      ownCourseId: ownCourse!.id,
      parentId: parent.id,
      wine125: wine125!.id,
      wine175: wine175!.id,
    };
  });
});

describe("listProducts lists the parent alone, its variants nested under it", () => {
  it("reads the parent itself unchanged", async () => {
    const all = await run((tx) => listProducts(tx));
    expect(all.find((p) => p.id === f.parentId)).toMatchObject({
      name: "Wine by the glass",
      customerName: { en: "House wine" },
      kitchenName: "WINE",
      unitPrice: "4.00",
      vatClass: "reduced",
      categoryId: f.wines,
      unitId: f.glass,
    });
  });

  it("nests each variant by its own names and stored price, never listing it on its own", async () => {
    const all = await run((tx) => listProducts(tx));
    expect(all.map((p) => p.id)).toEqual([f.parentId]);
    expect(all[0]!.variants).toEqual([
      {
        id: f.wine125,
        name: "125 ml",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: null,
        available: true,
        active: true,
        allergensInherited: true,
        courseId: null,
        effective: {
          unitPrice: "4.00",
          vatClass: "reduced",
          takeawayVatRate: "21.00",
          primaryCategoryId: f.wines,
          allergens: { sulphites: {} },
          courseId: f.courseId,
        },
      },
      {
        id: f.wine175,
        name: "175 ml",
        customerName: { en: "Large glass of house wine" },
        kitchenName: "W175",
        image: libraryImageName("large.jpg"),
        unitPrice: "5.50",
        available: true,
        active: true,
        allergensInherited: false,
        courseId: f.ownCourseId,
        effective: {
          unitPrice: "5.50",
          vatClass: "general",
          takeawayVatRate: "0.00",
          primaryCategoryId: f.wines,
          allergens: { milk: {} },
          courseId: f.ownCourseId,
        },
      },
    ]);
  });

  it("lists the remaining variant with its effective values after deleting another", async () => {
    await fx.db.update(products).set({ active: false }).where(eq(products.id, f.wine125));
    const [parent] = await run((tx) => listProducts(tx));
    expect(
      parent!.variants.map(({ id, active, effective }) => ({ id, active, effective })),
    ).toEqual([
      {
        id: f.wine175,
        active: true,
        effective: {
          unitPrice: "5.50",
          vatClass: "general",
          takeawayVatRate: "0.00",
          primaryCategoryId: f.wines,
          allergens: { milk: {} },
          courseId: f.ownCourseId,
        },
      },
    ]);
  });

  it("names the product's course, and each variant's own course and the course it is fired in", async () => {
    const [parent] = await run((tx) => listProducts(tx));
    expect(parent!.courseId).toBe(f.courseId);
    expect(
      parent!.variants.map(({ id, courseId, effective }) => ({
        id,
        courseId,
        effectiveCourseId: effective.courseId,
      })),
    ).toEqual([
      { id: f.wine125, courseId: null, effectiveCourseId: f.courseId },
      { id: f.wine175, courseId: f.ownCourseId, effectiveCourseId: f.ownCourseId },
    ]);
  });

  it("reads every product's variants in as many queries for three products as for one", async () => {
    const selects = async () => {
      let count = 0;
      await run((tx) => {
        const counting = new Proxy(tx, {
          get(target, key, receiver) {
            if (key === "select") count += 1;
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
        return listProducts(counting);
      });
      return count;
    };
    const one = await selects();
    await run(async (tx) => {
      for (const name of ["Cider", "Beer"]) {
        const parent = await createProduct(tx, {
          categoryId: null,
          name,
          unitId: null,
          unitPrice: "3.00",
          vatClass: "general",
        });
        await tx.insert(products).values({ parentId: parent.id, name: `${name} pint` });
      }
    });
    const listed = await run((tx) => listProducts(tx));
    expect(Object.fromEntries(listed.map(({ name, variants }) => [name, variants.length]))).toEqual(
      { "Wine by the glass": 2, Cider: 1, Beer: 1 },
    );
    expect(await selects()).toBe(one);
  });
});

describe("listMenuOffers reads a variant's blanks from its parent", () => {
  // The parent's own price (4.00) and its price on this menu (4.50) differ, so a variant that
  // inherits its price and is charged 4.00 was priced from the wrong step of the chain.
  it("resolves the effective values of each variant nested under the parent's offer", async () => {
    await run(async (tx) => {
      await addProductToMenu(tx, {
        menuId: f.menuId,
        productId: f.parentId,
        grossPrice: "4.50",
      });
    });
    const offers = await run((tx) => listMenuOffers(tx, [f.menuId]));
    expect(offers.map((o) => o.productId)).toEqual([f.parentId]);
    const { variants } = offers[0]!;
    expect(variants.map((v) => v.id)).toEqual([f.wine125, f.wine175]);
    expect(variants[0]).toMatchObject({
      name: "125 ml",
      customerName: null,
      kitchenName: null,
      unitPrice: "4.50",
      menuPrice: null,
      available: true,
      image: libraryImageName("parent.jpg"),
      vatClass: "reduced",
      pricingUnit: "each",
      unit: { id: f.glass },
      category: "Wines",
      allergens: PARENT_ALLERGENS,
      dietOverride: { vegan: "yes" },
      dietaryDeclarations: ["vegan"],
      courseId: f.courseId,
    });
    expect(variants[1]).toMatchObject({
      name: "175 ml",
      customerName: { en: "Large glass of house wine" },
      kitchenName: "W175",
      unitPrice: "5.50",
      image: libraryImageName("large.jpg"),
      vatClass: "general",
      pricingUnit: "each",
      unit: { id: f.glass },
      category: "Wines",
      allergens: W175_PUBLISHED_ALLERGENS,
      diet: W175_DIET,
      dietOverride: W175_DIET_OVERRIDE,
      dietaryDeclarations: ["vegetarian"],
      courseId: f.ownCourseId,
    });
  });
});

describe("a variant's main category is always its parent's", () => {
  it("reads its parent's category for a variant with none stored, and for one holding its own", async () => {
    const wine250 = await run(async (tx) => {
      const [row] = await tx
        .insert(products)
        .values({
          parentId: f.parentId,
          name: "250 ml",
          categoryId: null,

          unitPrice: null,
          vatClass: null,
          dietaryDeclarations: null,
          variantOrder: 2,
        })
        .returning({ id: products.id });
      await addProductToMenu(tx, {
        menuId: f.menuId,
        productId: f.parentId,
        grossPrice: "7.00",
      });
      return row!.id;
    });

    const offers = await run((tx) => listMenuOffers(tx, [f.menuId]));
    const variants = offers[0]!.variants;
    expect(variants.find((v) => v.id === wine250)!.category).toBe("Wines");
    expect(variants.find((v) => v.id === f.wine175)!.category).toBe("Wines");
  });
});

describe("a variant's unit is always its product's", () => {
  it("reads Each for a variant whose product has no unit, whatever unit the variant stores", async () => {
    const { parentId, variantId } = await run(async (tx) => {
      const parent = await createProduct(tx, {
        categoryId: null,
        name: "Cider",
        unitId: null,
        unitPrice: "3.00",
        vatClass: "general",
      });
      const [variant] = await tx
        .insert(products)
        .values({ parentId: parent.id, name: "Cider pint" })
        .returning({ id: products.id });
      await plantStoredUnit(tx, variant!.id, f.largeGlass);
      await addProductToMenu(tx, { menuId: f.menuId, productId: parent.id, grossPrice: null });
      return { parentId: parent.id, variantId: variant!.id };
    });
    const offers = await run((tx) => listMenuOffers(tx, [f.menuId]));
    const cider = offers.find((o) => o.productId === parentId)!;
    expect(cider.variants.map((v) => v.id)).toEqual([variantId]);
    expect(cider.variants[0]).toMatchObject({ pricingUnit: "each", unit: EACH_UNIT });
  });
});

describe("listAvailableProducts", () => {
  // A variant listed here would read as a product in its own right.
  it("lists the parent and neither variant", async () => {
    const { products: listed } = await run((tx) => listAvailableProducts(tx));
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
          items: [{ productId: f.wine125, portion: "1" }],
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
        name: "Wine by the glass (125 ml)",
        customerName: { en: "House wine (125 ml)" },
        kitchenName: "WINE (125 ml)",
        vatClass: "reduced",
        price: "4.00",
        addAllergens: PARENT_ALLERGENS,
      }),
    ]);
  });
});

describe("readProductEditor", () => {
  // The editor shows a variant's OWN values, a blank field blank, and its parent's value for every
  // inherited field beside them. Neither reads a category or unit of its own: 175 ml's stored
  // ones are never shown.
  const parentValues = () => ({
    description: { en: "A dry white from Rueda" },
    image: libraryImageName("parent.jpg"),
    unitPrice: "4.00",
    vatClass: "reduced",
    unitId: f.glass,
    primaryCategoryId: f.wines,
    courseId: f.courseId,
    allergens: PARENT_ALLERGENS,
    dietaryDeclarations: ["vegan"],
  });

  it("reads a variant that inherits every field as blank, its parent's values beside them", async () => {
    expect(await run((tx) => readProductEditor(tx, f.wine125))).toMatchObject({
      parentId: f.parentId,
      name: "125 ml",
      customerName: null,
      kitchenName: null,
      description: null,
      image: null,
      unitPrice: null,
      vatClass: null,
      unitId: null,
      primaryCategoryId: null,
      courseId: null,
      allergens: null,
      dietaryDeclarations: null,
      inherited: parentValues(),
    });
  });

  it("reads a variant's own value for every field it sets, never its parent's, and no category or unit of its own", async () => {
    expect(await run((tx) => readProductEditor(tx, f.wine175))).toMatchObject({
      parentId: f.parentId,
      name: "175 ml",
      customerName: { en: "Large glass of house wine" },
      kitchenName: "W175",
      description: { en: "A sweet red from Toro" },
      image: libraryImageName("large.jpg"),
      unitPrice: "5.50",
      vatClass: "general",
      unitId: null,
      primaryCategoryId: null,
      courseId: f.ownCourseId,
      allergens: W175_PUBLISHED_ALLERGENS,
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
  // Every entry read straight, for the parent and both variants: 125 ml has every field blank and
  // 175 ml every field set, each different from the parent's. An entry with its two sides swapped
  // fails one of the two.
  it("reads the parent's value for a blank field and the variant's own for a set one, except the category and colour, always the parent's", async () => {
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
      const parentsAlways = key === "categoryId" || key === "color";
      const own = parentsAlways ? parentRaw[key] : wine175Raw[key];
      expect(byId.get(f.wine175)![key], key).toEqual(own);
    }
  });
});

/** Each inherited column's STORED value, keyed like {@link effectiveProductColumns}. A copy's
 * takeaway class is read from the served-class column. */
function pickRaw() {
  const source = (key: (typeof INHERITED_KEYS)[number]) =>
    key === "takeawayVatClass" ? "vatClass" : key;
  return Object.fromEntries(INHERITED_KEYS.map((key) => [key, products[source(key)]])) as {
    [K in (typeof INHERITED_KEYS)[number]]: (typeof products)[K];
  };
}

describe("createProduct", () => {
  it("returns the values of the top-level product it created", async () => {
    const created = await run((tx) =>
      createProduct(tx, {
        categoryId: f.bottles,
        name: "Cava",
        customerName: { en: "Sparkling" },
        kitchenName: "CAVA",
        unitId: f.largeGlass,
        unitPrice: "6.25",
        vatClass: "general",
        image: libraryImageName("cava.jpg"),
      }),
    );
    expect(created).toMatchObject({
      name: "Cava",
      unitPrice: "6.25",
      vatClass: "general",
      image: libraryImageName("cava.jpg"),
      unitId: f.largeGlass,
      categoryId: f.bottles,
      primaryCategoryId: f.bottles,
    });
  });
});

describe("what the products table refuses", () => {
  it("refuses a variant whose parent does not exist", async () => {
    await expect(
      fx.db.insert(products).values({
        parentId: crypto.randomUUID(),
        name: "Stray variant",
      }),
    ).rejects.toMatchObject({
      errcode: FOREIGN_KEY_VIOLATION[0],
      message: "FOREIGN KEY constraint failed",
    });
  });

  it("accepts a variant under an existing parent without a menu", async () => {
    await expect(
      fx.db.insert(products).values({ parentId: f.parentId, name: "250 ml" }),
    ).resolves.toBeDefined();
  });

  it("refuses a top-level product with no VAT class", async () => {
    await expect(
      fx.db.insert(products).values({
        name: "No VAT",

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
        name: "No price",

        unitPrice: null,
        vatClass: "general",
      }),
    ).rejects.toMatchObject({
      errcode: CHECK_VIOLATION[0],
      message: "CHECK constraint failed: products_top_level_owns_ck",
    });
  });

  it("accepts a variant with no VAT class or price", async () => {
    await expect(
      fx.db.insert(products).values({
        parentId: f.parentId,
        name: "Wine 500",

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
      .values({ parentId: f.parentId, name: "250 ml" })
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

  /** A variant is not a row of `listProducts`, and the variant nested there carries no dietary
   * declarations, so its effective ones are read through the fallback itself. */
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

describe("a copy's takeaway VAT class", () => {
  // The served class, its own else its parent's: a product line taken away files at its product's
  // takeaway rate, so the label a copy carries is the served one, whatever the column holds.
  it("is its own main class, else the parent's, never the stored takeaway class", async () => {
    const ids = await run(async (tx) => {
      const cola = await createProduct(tx, {
        categoryId: f.bottles,
        name: "Cola",
        unitId: null,
        unitPrice: "1.80",
        vatClass: "reduced",
      });
      await tx
        .update(products)
        .set({ takeawayVatClass: "general" })
        .where(eq(products.id, cola.id));
      const variant = (name: string, order: number, own: Partial<typeof products.$inferInsert>) =>
        tx
          .insert(products)
          .values({
            parentId: cola.id,
            name,
            unitPrice: null,
            vatClass: null,
            dietaryDeclarations: null,
            variantOrder: order,
            ...own,
          })
          .returning({ id: products.id })
          .then(([row]) => row!.id);
      await addProductToMenu(tx, { menuId: f.menuId, productId: cola.id, grossPrice: null });
      return {
        cola: cola.id,
        plain: await variant("Can", 0, {}),
        ownMain: await variant("Bottle", 1, { vatClass: "super_reduced" }),
        ownTakeaway: await variant("Jug", 2, { takeawayVatClass: "zero" }),
      };
    });
    const offers = await run((tx) => listMenuOffers(tx, [f.menuId]));
    const cola = offers.find((o) => o.productId === ids.cola)!;
    expect(cola.takeawayVatClass).toBe("reduced");
    const takeaway = (id: string) => cola.variants.find((v) => v.id === id)!.takeawayVatClass;
    expect(takeaway(ids.plain)).toBe("reduced");
    expect(takeaway(ids.ownMain)).toBe("super_reduced");
    expect(takeaway(ids.ownTakeaway)).toBe("reduced");
    expect(selectMenuVariant(cola, ids.ownMain)).toMatchObject({
      vatClass: "super_reduced",
      takeawayVatClass: "super_reduced",
    });
  });
});

describe("INHERITED_KEYS", () => {
  // Every key below is read from the parent when a variant leaves it blank (the takeaway class is
  // the served one); the three names never are.
  // Pinned whole, so a key added or dropped is a decision somebody makes here rather than by accident.
  it("inherits exactly this set, and none of the names, flags or identity", () => {
    expect([...INHERITED_KEYS].sort()).toEqual(
      [
        "allergens",
        "categoryId",
        "color",
        "courseId",
        "description",
        "dietOverride",
        "dietaryDeclarations",
        "image",
        "unitPrice",
        "vatClass",
        "takeawayVatClass",
      ].sort(),
    );
  });
});
