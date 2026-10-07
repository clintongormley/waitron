import type { DocumentMember, MenuChange, MenuChangeBody } from "./menu-document-types.js";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { products, withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { decimal } from "@waitron/shared";
import { plantStoredCategory, seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";
import {
  menusFixture,
  NO_ICE,
  offerOf,
  product,
  section,
  WITH_ICE,
} from "../test/menus-fixture.js";
import {
  applyLiveFields,
  buildMenuDocument,
  diffMenuDocuments,
  documentImages,
  menuDocumentHash,
  readDishFacts,
  type MenuDocument,
} from "./menu-document.js";
import { BATCH_SIZE } from "./batches.js";
import * as vatRates from "./vat-rates.js";
import { createCategory, updateCategory } from "./categories.js";
import {
  createCatalogue,
  createProduct,
  deactivateCatalogue,
  deactivateProduct,
  updateMenuDetails,
  updateMenuItem,
  updateProduct,
} from "./operations.js";
import {
  addMember,
  createSectionIn,
  moveMember,
  removeMember,
  updateSection,
  deleteSection,
} from "./sections.js";
import { setIncludeFolder } from "./include-folder.js";
import { readMenuStructure, type MenuStructureNode } from "./menu-structure.js";
import type { IncludeFolderInput } from "./section-types.js";
import { setMenuVariants, setProductVariants } from "./variants.js";
import { writeProductModifiers } from "./product-modifiers.js";
import { createUnit, EACH_UNIT, updateUnit } from "./units.js";
import { extraListItems } from "./schema/extras.js";
import { createExtraList } from "./extras.js";
import { menuDetails } from "./schema/menu.js";
import { HOME_DISPLAY_DEFAULTS, shownMembers } from "./device-home.js";
import { addShortcut, setHomeDisplay } from "./menu-home.js";
import { optionLabels, optionLists } from "./schema/options.js";
import { sectionMembers, sections } from "./schema/sections.js";

const fx = useCatalogueDb();

afterEach(() => vi.restoreAllMocks());
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
const build = async (menuId: string) => (await app((tx) => buildMenuDocument(tx, menuId))).document;

/** The same value with every object's keys in reverse order, all the way down. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .reverse()
      .map((key) => [key, reversedKeys((value as Record<string, unknown>)[key])]),
  );
}

async function memberOf(listId: string, ref: { productId?: string; sectionId?: string }) {
  const rows = await fx.db
    .select({ id: sectionMembers.id })
    .from(sectionMembers)
    .where(
      and(
        eq(sectionMembers.sectionId, listId),
        ref.productId === undefined
          ? eq(sectionMembers.childSectionId, ref.sectionId!)
          : eq(sectionMembers.productId, ref.productId),
      ),
    );
  return rows[0]!.id;
}

async function homeSection(menuId: string): Promise<string> {
  const [row] = await fx.db
    .select({ id: menuDetails.homeSectionId })
    .from(menuDetails)
    .where(eq(menuDetails.menuId, menuId));
  return row!.id;
}

let tilePosition = 0;
async function addTile(homeSectionId: string, ref: { productId?: string; sectionId?: string }) {
  await fx.db.insert(sectionMembers).values({
    sectionId: homeSectionId,
    position: tilePosition++,
    productId: ref.productId ?? null,
    childSectionId: ref.sectionId ?? null,
  });
}

describe("buildMenuDocument", () => {
  it("holds the structure with display content, one offer per product, and the Device Home Page", async () => {
    const f = await menusFixture(fx.db);
    const document = await build(f.lunch);
    const lemonade = await app((tx) => offerOf(tx, f.lunch, f.lemonade));
    const lager = await app((tx) => offerOf(tx, f.lunch, f.lager));
    const soup = await app((tx) => offerOf(tx, f.lunch, f.soup));
    expect(document).toMatchObject({
      format: 3,
      menuId: f.lunch,
      menuName: "Lunch Menu",
      home: {
        shortcuts: [],
        handheld: HOME_DISPLAY_DEFAULTS.handheld,
        till: HOME_DISPLAY_DEFAULTS.till,
      },
    });
    expect(document.root).toEqual({
      members: [
        {
          kind: "section",
          sectionId: f.drinks,
          internalName: "Drinks",
          includedMenu: { id: f.drinksMenu, name: "Drinks" },
          names: { en: "Something to drink" },
          image: null,
          color: null,
          members: [
            { kind: "product", menuItemId: lemonade, productId: f.lemonade },
            {
              kind: "section",
              sectionId: f.beer,
              internalName: "Beer",
              names: { en: "On tap" },
              image: null,
              color: null,
              members: [{ kind: "product", menuItemId: lager, productId: f.lager }],
            },
          ],
        },
        { kind: "product", menuItemId: soup, productId: f.soup },
      ],
    });
    expect(Object.keys(document.offers).sort()).toEqual([lemonade, lager, soup].sort());
    const offer = document.offers[lemonade]!;
    expect(offer).toMatchObject({
      productId: f.lemonade,
      name: "Lemonade",
      customerName: { en: "Lemonade for guests" },
      kitchenName: "LEMONADE",
      description: { en: "All about Lemonade" },
      image: "lemonade.jpg",
      grossPrice: "2.80",
      unitPrice: "2.80",
      placements: [[f.drinks]],
      allergens: {},
    });
    expect(offer.variants).toHaveLength(1);
    expect(offer.variants[0]).toMatchObject({
      id: f.large,
      name: "Large",
      customerName: { en: "A big glass" },
      kitchenName: "LRG",
      image: "large.jpg",
      unitPrice: "3.50",
    });
  });

  it("leaves out every live field and every field that is not menu content", async () => {
    const f = await menusFixture(fx.db);
    const document = await build(f.lunch);
    const offer = document.offers[await app((tx) => offerOf(tx, f.lunch, f.lemonade))]!;
    for (const field of ["available", "courseId", "category"])
      expect(Object.keys(offer)).not.toContain(field);
    for (const field of ["available", "courseId", "category"])
      expect(Object.keys(offer.variants[0]!)).not.toContain(field);
    const [extras, options] = offer.offeredModifiers;
    if (extras?.kind !== "extras" || options?.kind !== "options") throw new Error("lists");
    expect(Object.keys(extras.items[0]!)).not.toContain("available");
    for (const label of options.labels) expect(Object.keys(label)).not.toContain("available");
  });

  it("freezes the VAT class, and no rate, of the dish, each variant and each extras item", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await updateProduct(tx, f.large, { vatClass: "general" });
      await updateProduct(tx, f.extraLemon, { vatClass: "super_reduced" });
    });
    const document = await build(f.lunch);
    const offer = document.offers[await app((tx) => offerOf(tx, f.lunch, f.lemonade))]!;
    expect(offer).toMatchObject({ vatClass: "reduced" });
    expect(offer.variants[0]).toMatchObject({ vatClass: "general" });
    const extras = offer.offeredModifiers[0]!;
    expect(extras.kind === "extras" && extras.items[0]).toMatchObject({
      vatClass: "super_reduced",
    });
    expect(JSON.stringify(document)).not.toMatch(/vatRate/);
  });

  it("holds an extras item and an option label whatever their availability", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await tx.update(optionLabels).set({ available: false }).where(eq(optionLabels.id, WITH_ICE));
      await updateProduct(tx, f.extraLemon, { available: false });
    });
    for (const menuId of [f.lunch, f.dinner]) {
      const document = await build(menuId);
      const offer = document.offers[await app((tx) => offerOf(tx, menuId, f.lemonade))]!;
      expect(offer.offeredModifiers).toMatchObject([
        {
          kind: "extras",
          id: f.extrasList,
          name: "Extras",
          items: [{ productId: f.extraLemon, name: "Extra lemon", price: "0.40" }],
        },
        {
          kind: "options",
          id: f.iceList,
          defaultLabelId: expect.any(String),
          labels: [{ name: "No ice" }, { id: WITH_ICE, name: "With ice" }],
        },
      ]);
    }
  });

  it("omits a product taken out of the menu's structure, and one that is deleted", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await removeMember(tx, f.lunchRoot, await memberOf(f.lunchRoot, { productId: f.soup }));
      await updateProduct(tx, f.lager, { active: false });
    });
    const document = await build(f.lunch);
    expect(Object.values(document.offers).map((offer) => offer.name)).toEqual(["Lemonade"]);
    expect(JSON.stringify(document.root)).not.toContain(f.soup);
    expect(JSON.stringify(document.root)).not.toContain(f.lager);
  });

  it("leaves out an extras item whose product is deleted", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => deactivateProduct(tx, f.extraLemon));
    const document = await build(f.lunch);
    const offer = document.offers[await app((tx) => offerOf(tx, f.lunch, f.lemonade))]!;
    expect(offer.offeredModifiers[0]).toMatchObject({
      kind: "extras",
      id: f.extrasList,
      items: [],
    });
  });

  it("stops at a cycle a direct write left in the sections", async () => {
    const f = await menusFixture(fx.db);
    await fx.db
      .insert(sectionMembers)
      .values({ sectionId: f.beer, position: 5, childSectionId: f.drinks });
    const document = await build(f.lunch);
    const drinks = document.root.members[0]!;
    const beer = drinks.kind === "section" ? drinks.members[1]! : undefined;
    expect(beer?.kind === "section" && beer.members).toEqual([
      {
        kind: "product",
        menuItemId: await app((tx) => offerOf(tx, f.lunch, f.lager)),
        productId: f.lager,
      },
    ]);
  });

  it("refuses a menu that does not exist", async () => {
    await menusFixture(fx.db);
    await expect(
      app((tx) => buildMenuDocument(tx, "00000000-0000-4000-8000-000000000000")),
    ).rejects.toMatchObject({ code: "catalogue.not_found" });
  });

  it("keeps an empty slot for a shortcut whose target is not on the menu, and reports it", async () => {
    const f = await menusFixture(fx.db);
    const home = await homeSection(f.lunch);
    await addTile(home, { productId: f.lemonade });
    await addTile(home, { productId: f.burger });
    await addTile(home, { sectionId: f.beer });
    await addTile(home, { sectionId: f.mains });
    const { document, omittedShortcuts } = await app((tx) => buildMenuDocument(tx, f.lunch));
    expect(document.home.shortcuts).toEqual([
      { kind: "product", productId: f.lemonade },
      { kind: "empty" },
      { kind: "section", sectionId: f.beer },
      { kind: "empty" },
    ]);
    expect(omittedShortcuts).toEqual([{ ref: product(f.burger) }, { ref: section(f.mains) }]);
  });
});

describe("each offer's colour", () => {
  const offersOf = (document: MenuDocument, productId: string) =>
    Object.values(document.offers).filter((offer) => offer.productId === productId);
  const offerFor = async (menuId: string, productId: string) => {
    const [offer, ...more] = offersOf(await build(menuId), productId);
    expect(more).toEqual([]);
    return offer!;
  };

  it("gives each offer its product's effective colour", async () => {
    const f = await menusFixture(fx.db);
    expect(await offerFor(f.lunch, f.lemonade)).toHaveProperty("color", null);
    await app((tx) => updateCategory(tx, f.softDrinks, { color: "#256bb1" }));
    expect(await offerFor(f.lunch, f.lemonade)).toHaveProperty("color", "#256bb1");
    await app((tx) => updateProduct(tx, f.lemonade, { color: "#b12525" }));
    const lemonade = await offerFor(f.lunch, f.lemonade);
    expect(lemonade).toHaveProperty("color", "#b12525");
    expect(lemonade.variants[0]).not.toHaveProperty("color");
    await app(async (tx) => {
      await updateCategory(tx, f.coldDrinks, { parentId: f.softDrinks });
      const soups = await createCategory(tx, { name: "Soups", parentId: f.coldDrinks });
      await updateProduct(tx, f.soup, { categoryId: soups.id });
    });
    expect(await offerFor(f.lunch, f.soup)).toHaveProperty("color", "#256bb1");
  });

  it("keeps a section's colour on the section only", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await updateMenuDetails(tx, f.drinksMenu, { color: "#b12525" });
      await updateProduct(tx, f.lemonade, { color: "#25b125" });
    });
    const document = await build(f.lunch);
    expect(document.root.members[0]).toMatchObject({ sectionId: f.drinks, color: "#b12525" });
    expect(offersOf(document, f.lemonade)).toMatchObject([{ color: "#25b125" }]);
    expect(offersOf(document, f.lager)).toMatchObject([{ color: null }]);
  });

  it("gives a product placed twice the same colour on every menu", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await addMember(tx, f.lunchRoot, product(f.lemonade));
      await updateCategory(tx, f.softDrinks, { color: "#256bb1" });
    });
    expect(await offerFor(f.lunch, f.lemonade)).toHaveProperty("color", "#256bb1");
    expect(await offerFor(f.dinner, f.lemonade)).toHaveProperty("color", "#256bb1");
  });
});

describe("readDishFacts", () => {
  let productId: string;
  let variantId: string;
  beforeEach(async () => {
    await seedTenant(fx.db);
    await seedLegacySellingUnits(fx.db);
    ({ productId, variantId } = await app(async (tx) => {
      const menu = await createCatalogue(tx, { name: "Menu" });
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Wine",
        pricingUnit: "each",
        unitPrice: "4",
        vatClass: "general",
      });
      const [variant] = await setProductVariants(
        tx,
        product.id,
        [
          {
            name: "Glass",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: null,
            available: true,
          },
        ],
        "en",
      );
      return { productId: product.id, variantId: variant!.id };
    }));
  });

  it("reads each product's effective colour, a variant's as its parent's whatever its row holds", async () => {
    const drinks = await app((tx) => createCategory(tx, { name: "Drinks", color: "#256bb1" }));
    await app((tx) => updateProduct(tx, productId, { categoryId: drinks.id }));
    await fx.db.update(products).set({ color: "#b12525" }).where(eq(products.id, variantId));
    const unknown = crypto.randomUUID();
    const effectiveColors = async (tx: Transaction, ids: string[]) =>
      new Map([...(await readDishFacts(tx, ids))].map(([id, facts]) => [id, facts.color]));
    expect(await app((tx) => effectiveColors(tx, [productId, variantId, unknown]))).toEqual(
      new Map([
        [productId, "#256bb1"],
        [variantId, "#256bb1"],
      ]),
    );
    expect(await app((tx) => effectiveColors(tx, []))).toEqual(new Map());
  });

  it("reads the category tree once and the products once per batch, with no separate colour read", async () => {
    const ids = [
      productId,
      variantId,
      ...Array.from({ length: BATCH_SIZE - 1 }, () => crypto.randomUUID()),
    ];
    await app(async (tx) => {
      const reads = vi.spyOn(tx, "select");
      try {
        await readDishFacts(tx, ids);
        expect(reads).toHaveBeenCalledTimes(3);
      } finally {
        reads.mockRestore();
      }
    });
  });
});

describe("menuDocumentHash", () => {
  it("hashes the same working state identically, whatever order the keys arrive in", async () => {
    const f = await menusFixture(fx.db);
    const first = await build(f.lunch);
    const second = await build(f.lunch);
    expect(menuDocumentHash(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(menuDocumentHash(second)).toBe(menuDocumentHash(first));
    const shuffled = JSON.parse(JSON.stringify(reversedKeys(first))) as MenuDocument;
    expect(JSON.stringify(shuffled)).not.toBe(JSON.stringify(first));
    expect(menuDocumentHash(shuffled)).toBe(menuDocumentHash(first));
    expect(menuDocumentHash({ ...first, menuName: "Brunch" })).not.toBe(menuDocumentHash(first));
    // A key holding `undefined` does not survive storage as JSON, so it cannot count.
    expect(menuDocumentHash({ ...first, stray: undefined } as MenuDocument)).toBe(
      menuDocumentHash(first),
    );
  });

  // Review Focus 1, the document half. Dinner sets no price of its own for Lemonade, so a change to
  // the product's price reaches its document.
  const unchanged: [
    string,
    (tx: Transaction, f: Awaited<ReturnType<typeof menusFixture>>) => Promise<unknown>,
  ][] = [
    ["the dish's availability", (tx, f) => updateProduct(tx, f.lemonade, { available: false })],
    ["the variant's availability", (tx, f) => updateProduct(tx, f.large, { available: false })],
    ["the extra's availability", (tx, f) => updateProduct(tx, f.extraLemon, { available: false })],
    [
      "an option label's availability",
      (tx) =>
        tx.update(optionLabels).set({ available: false }).where(eq(optionLabels.id, WITH_ICE)),
    ],
    [
      "the dish's course",
      (tx, f) => tx.update(products).set({ courseId: f.course }).where(eq(products.id, f.lemonade)),
    ],
    [
      "the variant's course",
      (tx, f) => tx.update(products).set({ courseId: f.course }).where(eq(products.id, f.large)),
    ],
    [
      "the dish's reporting category",
      (tx, f) => updateProduct(tx, f.lemonade, { categoryId: f.coldDrinks }),
    ],
    [
      // `updateProduct` refuses a variant's main category; the column is written directly.
      "the variant's reporting category",
      (tx, f) =>
        tx.update(products).set({ categoryId: f.coldDrinks }).where(eq(products.id, f.large)),
    ],
    // Being offered as an extra does not read the setting, so an extras item does not carry it.
    [
      "the extra's ordering",
      (tx, f) => updateProduct(tx, f.extraLemon, { ordering: "not_sold_separately" }),
    ],
  ];

  it.each(unchanged)("does not move when %s changes", async (_, change) => {
    const f = await menusFixture(fx.db);
    const before = menuDocumentHash(await build(f.dinner));
    await app((tx) => change(tx, f));
    expect(menuDocumentHash(await build(f.dinner))).toBe(before);
  });

  const moved: [
    string,
    (tx: Transaction, f: Awaited<ReturnType<typeof menusFixture>>) => Promise<unknown>,
  ][] = [
    ["the dish's VAT class", (tx, f) => updateProduct(tx, f.lemonade, { vatClass: "general" })],
    ["the variant's VAT class", (tx, f) => updateProduct(tx, f.large, { vatClass: "general" })],
    ["the extra's VAT class", (tx, f) => updateProduct(tx, f.extraLemon, { vatClass: "general" })],
    ["the dish's name", (tx, f) => updateProduct(tx, f.lemonade, { name: "Still lemonade" })],
    ["the dish's price", (tx, f) => updateProduct(tx, f.lemonade, { unitPrice: "3.20" })],
    ["the dish's image", (tx, f) => updateProduct(tx, f.lemonade, { image: "other.jpg" })],
    [
      "the dish's ordering",
      (tx, f) => updateProduct(tx, f.lemonade, { ordering: "not_sold_separately" }),
    ],
    [
      "the dish's ordering to staff only",
      (tx, f) => updateProduct(tx, f.lemonade, { ordering: "staff_only" }),
    ],
    [
      "the dish's allergens",
      (tx, f) =>
        updateProduct(tx, f.lemonade, { allergens: { sulphites: { presence: "contains" } } }),
    ],
    [
      "the dish's diet",
      (tx, f) => updateProduct(tx, f.lemonade, { dietOverride: { vegan: "yes" } }),
    ],
    ["the variant's name", (tx, f) => updateProduct(tx, f.large, { name: "Huge" })],
    ["the variant's price", (tx, f) => updateProduct(tx, f.large, { unitPrice: "3.90" })],
    ["the variant's image", (tx, f) => updateProduct(tx, f.large, { image: "huge.jpg" })],
    [
      "the variant's allergens",
      (tx, f) => updateProduct(tx, f.large, { allergens: { sulphites: { presence: "contains" } } }),
    ],
    [
      "the variant's diet",
      (tx, f) => updateProduct(tx, f.large, { dietOverride: { vegan: "no" } }),
    ],
    [
      "the variant's menu price",
      async (tx, f) =>
        setMenuVariants(tx, await offerOf(tx, f.dinner, f.lemonade), [
          { variantId: f.large, price: "4.20" },
        ]),
    ],
    ["the extra's name", (tx, f) => updateProduct(tx, f.extraLemon, { name: "Lemon wedge" })],
    ["the extra's image", (tx, f) => updateProduct(tx, f.extraLemon, { image: "lemon.jpg" })],
    ["the extra's deletion", (tx, f) => deactivateProduct(tx, f.extraLemon)],
    [
      "the extra's price",
      (tx, f) =>
        tx
          .update(extraListItems)
          .set({ price: 45 })
          .where(eq(extraListItems.productId, f.extraLemon)),
    ],
    [
      "the extra's allergens",
      (tx, f) =>
        updateProduct(tx, f.extraLemon, { allergens: { sulphites: { presence: "contains" } } }),
    ],
    [
      "the extra's diet",
      (tx, f) => updateProduct(tx, f.extraLemon, { dietaryDeclarations: ["vegan"] }),
    ],
  ];

  it.each(moved)("moves when %s changes", async (_, change) => {
    const f = await menusFixture(fx.db);
    const before = menuDocumentHash(await build(f.dinner));
    await app((tx) => change(tx, f));
    expect(menuDocumentHash(await build(f.dinner))).not.toBe(before);
  });

  it("stays when the rate of a class the menu uses changes", async () => {
    const f = await menusFixture(fx.db);
    const before = menuDocumentHash(await build(f.dinner));
    vi.spyOn(vatRates, "vatRateOn").mockImplementation((vatClass) =>
      decimal(vatClass === "reduced" ? "11.00" : "21.00"),
    );
    expect(menuDocumentHash(await build(f.dinner))).toBe(before);
  });
});

describe("applyLiveFields", () => {
  it("puts availability, course and category back from the current rows, and not VAT", async () => {
    const f = await menusFixture(fx.db);
    const lunch = await build(f.lunch);
    const dinner = await build(f.dinner);
    await app(async (tx) => {
      await updateProduct(tx, f.lemonade, {
        available: false,
        vatClass: "general",
        categoryId: f.coldDrinks,
      });
      await tx.update(products).set({ courseId: f.course }).where(eq(products.id, f.lemonade));
      await updateProduct(tx, f.soup, { categoryId: null });
      await updateProduct(tx, f.large, { available: false });
      await updateProduct(tx, f.lager, { active: false });
      await updateProduct(tx, f.extraLemon, { available: false });
      await tx.update(optionLabels).set({ available: false }).where(eq(optionLabels.id, WITH_ICE));
    });
    const live = await app((tx) => applyLiveFields(tx, [lunch, dinner]));
    const lunchOffers = live.get(f.lunch)!;
    expect(lunchOffers.map((offer) => [offer.name, offer.available])).toEqual([
      ["Lemonade", false],
      ["Lager", false],
      ["Soup", true],
    ]);
    expect(lunchOffers[2]!.category).toBeNull();
    const lemonade = lunchOffers[0]!;
    expect(lemonade).toMatchObject({
      vatClass: "reduced",
      courseId: f.course,
      category: "Cold drinks",
      unitPrice: "2.80",
      menuName: "Lunch Menu",
      image: "lemonade.jpg",
    });
    expect(lemonade.variants[0]).toMatchObject({
      id: f.large,
      available: false,
      vatClass: "reduced",
      courseId: f.course,
      category: "Cold drinks",
    });
    const [extras, options] = lemonade.offeredModifiers;
    if (extras?.kind !== "extras" || options?.kind !== "options") throw new Error("lists");
    expect(extras.items).toMatchObject([
      { productId: f.extraLemon, available: false, vatClass: "reduced" },
    ]);
    const dinnerExtras = live.get(f.dinner)!.find((offer) => offer.productId === f.lemonade)!
      .offeredModifiers[0]!;
    expect(dinnerExtras.kind === "extras" && dinnerExtras.items[0]!.available).toBe(false);
    expect(options.labels.map((label) => [label.name, label.available])).toEqual([
      ["No ice", true],
      ["With ice", false],
    ]);
  });

  it("puts back a variant's category as its product's, whatever category the variant stores", async () => {
    const f = await menusFixture(fx.db);
    const lunch = await build(f.lunch);
    await plantStoredCategory(fx.db, f.large, f.coldDrinks);
    const live = await app((tx) => applyLiveFields(tx, [lunch]));
    const lemonade = live.get(f.lunch)!.find((offer) => offer.productId === f.lemonade)!;
    expect(lemonade.category).toBe("Soft drinks");
    expect(lemonade.variants[0]).toMatchObject({ id: f.large, category: "Soft drinks" });
  });

  it("serves the VAT class the version froze, whatever each product's class is now", async () => {
    const f = await menusFixture(fx.db);
    const document = await build(f.lunch);
    await app(async (tx) => {
      await updateProduct(tx, f.lemonade, { vatClass: "general" });
      await updateProduct(tx, f.large, { vatClass: "zero" });
      await updateProduct(tx, f.extraLemon, { vatClass: "general" });
    });
    const [lemonade] = (await app((tx) => applyLiveFields(tx, [document]))).get(f.lunch)!;
    expect(lemonade).toMatchObject({ vatClass: "reduced" });
    expect(lemonade!.variants[0]).toMatchObject({ vatClass: "reduced" });
    const extras = lemonade!.offeredModifiers[0]!;
    expect(extras.kind === "extras" && extras.items[0]).toMatchObject({ vatClass: "reduced" });
  });

  it("offers a label unavailable when the document was built once it is available again", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) =>
      tx.update(optionLabels).set({ available: false }).where(eq(optionLabels.id, WITH_ICE)),
    );
    const document = await build(f.lunch);
    await app((tx) =>
      tx.update(optionLabels).set({ available: true }).where(eq(optionLabels.id, WITH_ICE)),
    );
    const [lemonade] = (await app((tx) => applyLiveFields(tx, [document]))).get(f.lunch)!;
    const options = lemonade!.offeredModifiers[1]!;
    expect(options.kind === "options" && options.labels.map((label) => label.available)).toEqual([
      true,
      true,
    ]);
  });

  describe("the default label served", () => {
    const CRUSHED_ICE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    /**
     * The published list is No ice, With ice, Crushed ice, in that order; after publishing, Crushed
     * ice is moved first in the list's current order, which the served default must not follow.
     */
    const servedOptions = async (
      unavailable: readonly string[],
      publishedDefault: string | null = NO_ICE,
    ) => {
      const f = await menusFixture(fx.db);
      await app(async (tx) => {
        await tx
          .insert(optionLabels)
          .values({ id: CRUSHED_ICE, listId: f.iceList, name: "Crushed ice", sort: 2 });
        await tx
          .update(optionLists)
          .set({ defaultLabelId: publishedDefault })
          .where(eq(optionLists.id, f.iceList));
      });
      const document = await build(f.lunch);
      const offer = document.offers[await app((tx) => offerOf(tx, f.lunch, f.lemonade))]!;
      const published = offer.offeredModifiers[1]!;
      expect(published.kind === "options" && published.defaultLabelId).toBe(publishedDefault);
      await app((tx) =>
        tx.update(optionLabels).set({ sort: -1 }).where(eq(optionLabels.id, CRUSHED_ICE)),
      );
      if (unavailable.length > 0)
        await app((tx) =>
          tx
            .update(optionLabels)
            .set({ available: false })
            .where(inArray(optionLabels.id, [...unavailable])),
        );
      const [lemonade] = (await app((tx) => applyLiveFields(tx, [document]))).get(f.lunch)!;
      const options = lemonade!.offeredModifiers[1]!;
      if (options.kind !== "options") throw new Error("options");
      expect(options.labels.map((label) => label.id)).toEqual([NO_ICE, WITH_ICE, CRUSHED_ICE]);
      return options;
    };
    const servedDefault = async (
      unavailable: readonly string[],
      publishedDefault: string | null = NO_ICE,
    ) => (await servedOptions(unavailable, publishedDefault)).defaultLabelId;

    it("is the published default while it is available", async () => {
      expect(await servedDefault([WITH_ICE])).toBe(NO_ICE);
    });

    it("is the first available label in the published order while the published default is unavailable", async () => {
      expect(await servedDefault([NO_ICE])).toBe(WITH_ICE);
    });

    it("skips every unavailable label, not only the published default", async () => {
      expect(await servedDefault([NO_ICE, WITH_ICE])).toBe(CRUSHED_ICE);
    });

    it("is null while every label is unavailable", async () => {
      expect(await servedDefault([NO_ICE, WITH_ICE, CRUSHED_ICE])).toBeNull();
    });

    it("is the first available label while the published version names no default", async () => {
      expect(await servedDefault([NO_ICE], null)).toBe(WITH_ICE);
    });

    it.each([NO_ICE, null])(
      "carries the published default %s beside the fallback it serves while that default is unavailable",
      async (publishedDefault) => {
        const options = await servedOptions([NO_ICE], publishedDefault);
        expect(options.defaultLabelId).toBe(WITH_ICE);
        expect(options.publishedDefaultLabelId).toBe(publishedDefault);
      },
    );
  });

  it("leaves out an offer, a variant or an extra whose product row is gone", async () => {
    const f = await menusFixture(fx.db);
    const document = await build(f.dinner);
    await app(async (tx) => {
      await tx.delete(extraListItems).where(eq(extraListItems.productId, f.extraLemon));
      await tx.delete(products).where(eq(products.id, f.extraLemon));
    });
    const lemonadeOffer = await app((tx) => offerOf(tx, f.dinner, f.lemonade));
    const lagerOffer = await app((tx) => offerOf(tx, f.dinner, f.lager));
    const missing = "00000000-0000-4000-8000-000000000000";
    const lemonade = document.offers[lemonadeOffer]!;
    const edited: MenuDocument = {
      ...document,
      offers: {
        ...document.offers,
        [lemonadeOffer]: { ...lemonade, variants: [{ ...lemonade.variants[0]!, id: missing }] },
        [lagerOffer]: { ...document.offers[lagerOffer]!, productId: missing },
      },
    };
    const offers = (await app((tx) => applyLiveFields(tx, [edited]))).get(f.dinner)!;
    expect(offers.map((offer) => offer.name)).toEqual(["Lemonade", "Burger"]);
    expect(offers[0]!.variants).toEqual([]);
    const extras = offers[0]!.offeredModifiers[0]!;
    expect(extras.kind === "extras" && extras.items).toEqual([]);
  });

  it("answers an empty map for no documents", async () => {
    expect(await app((tx) => applyLiveFields(tx, []))).toEqual(new Map());
  });
});

describe("diffMenuDocuments", () => {
  it("lists everything as added against no live version", async () => {
    const f = await menusFixture(fx.db);
    const changes = diffMenuDocuments(null, await build(f.lunch));
    expect(changeBodies(changes)).toEqual([
      {
        kind: "section_added",
        sectionId: f.drinks,
        parentSectionIds: [],
        name: "Drinks",
        under: [],
        source: "this_menu",
      },
      {
        kind: "section_added",
        sectionId: f.beer,
        parentSectionIds: [f.drinks],
        name: "Beer",
        under: ["Drinks"],
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Drinks" },
      },
      {
        kind: "product_added",
        productId: f.lemonade,
        name: "Lemonade",
        under: ["Drinks"],
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Drinks" },
      },
      {
        kind: "product_added",
        productId: f.lager,
        name: "Lager",
        under: ["Drinks", "Beer"],
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Drinks" },
      },
      { kind: "product_added", productId: f.soup, name: "Soup", under: [], source: "this_menu" },
    ]);
  });

  it("finds nothing between a document and itself", async () => {
    const f = await menusFixture(fx.db);
    const document = await build(f.lunch);
    expect(diffMenuDocuments(document, document)).toEqual([]);
  });

  it("names a reorder of the top level as this menu's change", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.lunch);
    await app(async (tx) =>
      moveMember(tx, f.lunchRoot, await memberOf(f.lunchRoot, { productId: f.soup }), 0),
    );
    expect(changeBodies(diffMenuDocuments(live, await build(f.lunch)))).toEqual([
      { kind: "order_changed", listSectionId: null, list: [], source: "this_menu" },
    ]);
  });

  it("names a reorder inside a section as that section's change", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.lunch);
    await app(async (tx) =>
      moveMember(tx, f.drinks, await memberOf(f.drinks, { sectionId: f.beer }), 0),
    );
    expect(changeBodies(diffMenuDocuments(live, await build(f.lunch)))).toEqual([
      {
        kind: "order_changed",
        listSectionId: f.drinks,
        list: ["Drinks"],
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Drinks" },
      },
    ]);
  });

  it("names a product that moved, and one removed", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.lunch);
    await app(async (tx) => {
      await removeMember(tx, f.lunchRoot, await memberOf(f.lunchRoot, { productId: f.soup }));
      await addMember(tx, f.drinks, product(f.soup));
      await removeMember(tx, f.beer, await memberOf(f.beer, { productId: f.lager }));
    });
    expect(changeBodies(diffMenuDocuments(live, await build(f.lunch)))).toEqual([
      {
        kind: "product_removed",
        productId: f.lager,
        name: "Lager",
        under: ["Drinks", "Beer"],
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Drinks" },
      },
      {
        kind: "product_moved",
        productId: f.soup,
        name: "Soup",
        from: [[]],
        to: [["Drinks"]],
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Drinks" },
      },
    ]);
  });

  it("names a section removed and its products", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.lunch);
    await app(async (tx) => deleteSection(tx, f.beer));
    expect(changeBodies(diffMenuDocuments(live, await build(f.lunch)))).toEqual([
      {
        kind: "section_removed",
        sectionId: f.beer,
        parentSectionIds: [f.drinks],
        name: "Beer",
        under: ["Drinks"],
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Drinks" },
      },
      {
        kind: "product_removed",
        productId: f.lager,
        name: "Lager",
        under: ["Drinks", "Beer"],
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Drinks" },
      },
    ]);
  });

  it("names a section's changed details", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.lunch);
    await app(async (tx) => {
      await updateMenuDetails(tx, f.drinksMenu, { name: "Soft drinks", color: "#112233" });
      await tx.update(sections).set({ image: "drinks.jpg" }).where(eq(sections.id, f.drinks));
      await updateSection(tx, f.beer, { names: { en: "Cold beers" } });
    });
    expect(changeBodies(diffMenuDocuments(live, await build(f.lunch)))).toEqual([
      {
        kind: "section_changed",
        sectionId: f.drinks,
        name: "Soft drinks",
        fields: ["names", "image", "color"],
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Soft drinks" },
      },
      {
        kind: "section_changed",
        sectionId: f.beer,
        name: "Beer",
        fields: ["names"],
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Soft drinks" },
      },
    ]);
  });

  it("names this menu's price, and the product's own price, apart", async () => {
    const f = await menusFixture(fx.db);
    const lunch = await build(f.lunch);
    const dinner = await build(f.dinner);
    await app(async (tx) => {
      await updateMenuItem(tx, f.lunch, await offerOf(tx, f.lunch, f.lemonade), {
        grossPrice: "2.60",
      });
      await updateProduct(tx, f.lemonade, { unitPrice: "3.20" });
    });
    expect(changeBodies(diffMenuDocuments(lunch, await build(f.lunch)))).toEqual([
      {
        kind: "price_changed",
        productId: f.lemonade,
        name: "Lemonade",
        from: "2.80",
        to: "2.60",
        source: "this_menu",
      },
    ]);
    expect(changeBodies(diffMenuDocuments(dinner, await build(f.dinner)))).toEqual([
      {
        kind: "price_changed",
        productId: f.lemonade,
        name: "Lemonade",
        from: "3.00",
        to: "3.20",
        source: "shared_product",
      },
    ]);
  });

  it("names a variant price that follows this menu's price as this menu's change", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.large, { unitPrice: null }));
    const live = await build(f.lunch);
    await app(async (tx) =>
      updateMenuItem(tx, f.lunch, await offerOf(tx, f.lunch, f.lemonade), { grossPrice: "2.60" }),
    );
    expect(changeBodies(diffMenuDocuments(live, await build(f.lunch)))).toEqual([
      {
        kind: "price_changed",
        productId: f.lemonade,
        name: "Lemonade",
        from: "2.80",
        to: "2.60",
        source: "this_menu",
      },
      {
        kind: "product_changed",
        productId: f.lemonade,
        name: "Lemonade",
        fields: ["variants"],
        source: "this_menu",
      },
    ]);
  });

  it("names a product and a section placed a second time", async () => {
    const f = await menusFixture(fx.db);
    f.beer = await app(async (tx) => {
      await deleteSection(tx, f.beer);
      const included = await (
        await import("../test/included-menu.js")
      ).createIncludedMenu(tx, { internalName: "Beer", names: { en: "On tap" } });
      await addMember(tx, included.id, product(f.lager));
      await addMember(tx, f.drinks, section(included.id));
      return included.id;
    });
    const live = await build(f.lunch);
    await app(async (tx) => {
      await addMember(tx, f.lunchRoot, section(f.beer));
      await addMember(tx, f.lunchRoot, product(f.lemonade));
    });
    const [beerRow] = await fx.db
      .select({ menuId: sections.ownerMenuId })
      .from(sections)
      .where(eq(sections.id, f.beer));
    expect(changeBodies(diffMenuDocuments(live, await build(f.lunch)))).toEqual([
      {
        kind: "section_added",
        sectionId: f.beer,
        parentSectionIds: [],
        name: "Beer",
        under: [],
        source: "this_menu",
      },
      {
        kind: "product_moved",
        productId: f.lemonade,
        name: "Lemonade",
        from: [["Drinks"]],
        to: [["Drinks"], []],
        source: "this_menu",
      },
      {
        kind: "product_moved",
        productId: f.lager,
        name: "Lager",
        from: [["Drinks", "Beer"]],
        to: [["Drinks", "Beer"], ["Beer"]],
        source: "included_menu",
        includedMenu: { id: beerRow!.menuId!, name: "Beer" },
      },
    ]);
  });

  it("names a change to an extra that is also a dish once, as the dish's", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await writeProductModifiers(tx, f.soup, [{ kind: "extras", id: f.extrasList }]);

      await addMember(tx, f.lunchRoot, product(f.extraLemon));
    });
    const live = await build(f.lunch);
    await app(async (tx) => {
      await updateProduct(tx, f.extraLemon, { allergens: { sulphites: { presence: "contains" } } });
      await tx.insert(extraListItems).values({ listId: f.extrasList, productId: f.lager, sort: 1 });
    });
    expect(changeBodies(diffMenuDocuments(live, await build(f.lunch)))).toEqual([
      {
        kind: "product_changed",
        productId: f.lemonade,
        name: "Lemonade",
        fields: ["extras"],
        source: "shared_product",
      },
      {
        kind: "product_changed",
        productId: f.soup,
        name: "Soup",
        fields: ["extras"],
        source: "shared_product",
      },
      {
        kind: "product_changed",
        productId: f.extraLemon,
        name: "Extra lemon",
        fields: ["allergens"],
        source: "shared_product",
      },
    ]);
  });

  it("names the list and extra when its saved portion takes a new product unit", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.dinner);
    await app(async (tx) => {
      const unit = await createUnit(
        tx,
        { name: { en: "Kilogram" }, abbreviation: { en: "kg" }, precision: 3 },
        "en",
      );
      await updateProduct(tx, f.extraLemon, { unitId: unit.id });
    });

    expect(changeBodies(diffMenuDocuments(live, await build(f.dinner)))).toContainEqual({
      kind: "extra_unit_changed",
      productId: f.extraLemon,
      name: "Extra lemon",
      listId: f.extrasList,
      listName: "Extras",
      from: { abbreviation: EACH_UNIT.abbreviation, precision: 0 },
      to: { abbreviation: { en: "kg" }, precision: 3 },
      source: "shared_product",
    });
  });

  it("names each list's portion change when the extra is also a dish", async () => {
    const f = await menusFixture(fx.db);
    const secondList = await app(async (tx) => {
      const list = await createExtraList(
        tx,
        {
          name: "Soup extras",
          minPicks: 0,
          maxPicks: 2,
          items: [{ productId: f.extraLemon, price: "0.40" }],
        },
        "en",
      );
      await writeProductModifiers(tx, f.soup, [{ kind: "extras", id: list.id }]);
      await addMember(tx, f.lunchRoot, product(f.extraLemon));
      return list.id;
    });
    const live = await build(f.lunch);
    await fx.db
      .update(extraListItems)
      .set({ portion: 2000 })
      .where(
        and(eq(extraListItems.listId, f.extrasList), eq(extraListItems.productId, f.extraLemon)),
      );
    await fx.db
      .update(extraListItems)
      .set({ portion: 3000 })
      .where(
        and(eq(extraListItems.listId, secondList), eq(extraListItems.productId, f.extraLemon)),
      );

    expect(
      changeBodies(
        diffMenuDocuments(live, await build(f.lunch)).filter(
          (change) => change.kind === "extra_portion_changed",
        ),
      ),
    ).toEqual([
      {
        kind: "extra_portion_changed",
        productId: f.extraLemon,
        name: "Extra lemon",
        listId: f.extrasList,
        listName: "Extras",
        from: { portion: "1.000", abbreviation: EACH_UNIT.abbreviation },
        to: { portion: "2.000", abbreviation: EACH_UNIT.abbreviation },
        source: "shared_product",
      },
      {
        kind: "extra_portion_changed",
        productId: f.extraLemon,
        name: "Extra lemon",
        listId: secondList,
        listName: "Soup extras",
        from: { portion: "1.000", abbreviation: EACH_UNIT.abbreviation },
        to: { portion: "3.000", abbreviation: EACH_UNIT.abbreviation },
        source: "shared_product",
      },
    ]);
  });

  it("names an extra item's change to and from no quantity limit", async () => {
    const f = await menusFixture(fx.db);
    const limited = await build(f.dinner);
    await fx.db
      .update(extraListItems)
      .set({ maxQuantity: null })
      .where(
        and(eq(extraListItems.listId, f.extrasList), eq(extraListItems.productId, f.extraLemon)),
      );
    const unlimited = await build(f.dinner);
    expect(changeBodies(diffMenuDocuments(limited, unlimited))).toEqual([
      {
        kind: "extra_max_quantity_changed",
        productId: f.extraLemon,
        name: "Extra lemon",
        listId: f.extrasList,
        listName: "Extras",
        from: 1,
        to: null,
        source: "shared_product",
      },
    ]);
    expect(changeBodies(diffMenuDocuments(unlimited, limited))).toEqual([
      {
        kind: "extra_max_quantity_changed",
        productId: f.extraLemon,
        name: "Extra lemon",
        listId: f.extrasList,
        listName: "Extras",
        from: null,
        to: 1,
        source: "shared_product",
      },
    ]);
  });

  it("names a unit change on both lists when the extra is also sold as a dish", async () => {
    const f = await menusFixture(fx.db);
    const secondList = await app(async (tx) => {
      const list = await createExtraList(
        tx,
        {
          name: "Soup extras",
          minPicks: 0,
          maxPicks: 2,
          items: [{ productId: f.extraLemon, price: "0.40" }],
        },
        "en",
      );
      await writeProductModifiers(tx, f.soup, [{ kind: "extras", id: list.id }]);
      await addMember(tx, f.lunchRoot, product(f.extraLemon));
      return list.id;
    });
    const live = await build(f.lunch);
    await app(async (tx) => {
      const unit = await createUnit(
        tx,
        { name: { en: "Kilogram" }, abbreviation: { en: "kg" }, precision: 3 },
        "en",
      );
      await updateProduct(tx, f.extraLemon, { unitId: unit.id });
    });

    expect(
      diffMenuDocuments(live, await build(f.lunch)).filter(
        (change) => change.kind === "extra_unit_changed",
      ),
    ).toEqual([
      expect.objectContaining({
        productId: f.extraLemon,
        listId: f.extrasList,
        listName: "Extras",
      }),
      expect.objectContaining({
        productId: f.extraLemon,
        listId: secondList,
        listName: "Soup extras",
      }),
    ]);
  });

  it("shows an included menu's extra unit change on each affected menu", async () => {
    const f = await menusFixture(fx.db);
    const live = await Promise.all([f.drinksMenu, f.lunch, f.dinner].map(build));
    await app(async (tx) => {
      const unit = await createUnit(
        tx,
        { name: { en: "Kilogram" }, abbreviation: { en: "kg" }, precision: 3 },
        "en",
      );
      await updateProduct(tx, f.extraLemon, { unitId: unit.id });
    });

    for (const [index, menuId] of [f.drinksMenu, f.lunch, f.dinner].entries()) {
      expect(diffMenuDocuments(live[index]!, await build(menuId))).toContainEqual(
        expect.objectContaining({
          kind: "extra_unit_changed",
          productId: f.extraLemon,
          listId: f.extrasList,
          listName: "Extras",
        }),
      );
    }
  });

  it("does not claim an extra's unit changed when only the unit name changed", async () => {
    const f = await menusFixture(fx.db);
    const unitId = await app(async (tx) => {
      const unit = await createUnit(
        tx,
        { name: { en: "Kilogram" }, abbreviation: { en: "kg" }, precision: 3 },
        "en",
      );
      await updateProduct(tx, f.extraLemon, { unitId: unit.id });
      return unit.id;
    });
    const live = await build(f.dinner);
    await app((tx) => updateUnit(tx, unitId, { name: { en: "Kilo" } }, "en"));

    expect(diffMenuDocuments(live, await build(f.dinner))).not.toContainEqual(
      expect.objectContaining({ kind: "extra_unit_changed", productId: f.extraLemon }),
    );
  });

  it("names the fields of a product that changed, the menu's variant settings apart", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.dinner);
    await app(async (tx) => {
      await updateProduct(tx, f.lemonade, {
        customerName: { en: "Cloudy lemonade" },
        description: { en: "Freshly squeezed" },
        image: "cloudy.jpg",
        allergens: { sulphites: { presence: "contains" } },
        dietOverride: { vegan: "yes" },
      });
      await setMenuVariants(tx, await offerOf(tx, f.dinner, f.lemonade), [
        { variantId: f.large, price: "4.00" },
      ]);
    });
    expect(changeBodies(diffMenuDocuments(live, await build(f.dinner)))).toEqual([
      {
        kind: "product_changed",
        productId: f.lemonade,
        name: "Lemonade",
        fields: ["names", "description", "image", "allergens", "diet"],
        source: "shared_product",
      },
      {
        kind: "product_changed",
        productId: f.lemonade,
        name: "Lemonade",
        fields: ["variants"],
        source: "this_menu",
      },
    ]);
  });

  it("names a change to the dish's ordering as the product's ordering", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.dinner);
    await app((tx) => updateProduct(tx, f.burger, { ordering: "staff_only" }));
    const proposed = await build(f.dinner);
    expect(proposed.offers[await app((tx) => offerOf(tx, f.dinner, f.burger))]!.ordering).toBe(
      "staff_only",
    );
    expect(changeBodies(diffMenuDocuments(live, proposed))).toEqual([
      {
        kind: "product_changed",
        productId: f.burger,
        name: "Burger",
        fields: ["ordering"],
        source: "shared_product",
      },
    ]);
  });

  it("names a variant's own changes, a new variant and a changed options list as the product's", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.dinner);
    await app(async (tx) => {
      await updateProduct(tx, f.large, { name: "Huge", unitPrice: "3.90" });
      await setProductVariants(
        tx,
        f.lemonade,
        [
          {
            id: f.large,
            name: "Huge",
            customerName: { en: "A big glass" },
            kitchenName: "LRG",
            image: "large.jpg",
            unitPrice: "3.90",
            available: true,
          },
          {
            name: "Small",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "2.50",
            available: true,
          },
        ],
        "en",
      );
      await tx
        .update(optionLabels)
        .set({ name: "Lots of ice" })
        .where(eq(optionLabels.id, WITH_ICE));
    });
    expect(changeBodies(diffMenuDocuments(live, await build(f.dinner)))).toEqual([
      {
        kind: "product_changed",
        productId: f.lemonade,
        name: "Lemonade",
        fields: ["variants", "options"],
        source: "shared_product",
      },
    ]);
  });

  it("names a change to one variant's own facts as the variants', not the dish's", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.dinner);
    await app((tx) =>
      updateProduct(tx, f.large, {
        name: "Huge",
        image: "huge.jpg",
        allergens: { sulphites: { presence: "contains" } },
        dietOverride: { vegan: "no" },
      }),
    );
    expect(changeBodies(diffMenuDocuments(live, await build(f.dinner)))).toEqual([
      {
        kind: "product_changed",
        productId: f.lemonade,
        name: "Lemonade",
        fields: ["variants"],
        source: "shared_product",
      },
    ]);
  });

  it("names an extra's own facts against the extra, and its terms against the dish", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.dinner);
    await app(async (tx) => {
      await updateProduct(tx, f.extraLemon, {
        allergens: { sulphites: { presence: "contains" } },
        dietaryDeclarations: ["vegan"],
      });
      await tx
        .update(extraListItems)
        .set({ price: 45 })
        .where(eq(extraListItems.productId, f.extraLemon));
    });
    expect(changeBodies(diffMenuDocuments(live, await build(f.dinner)))).toEqual([
      {
        kind: "product_changed",
        productId: f.lemonade,
        name: "Lemonade",
        fields: ["extras"],
        source: "shared_product",
      },
      {
        kind: "product_changed",
        productId: f.extraLemon,
        name: "Extra lemon",
        fields: ["allergens", "diet"],
        source: "shared_product",
      },
    ]);
  });

  it("names a VAT change against the dish, a variant's own as VAT in the variants, and an extra's against the extra", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.dinner);
    await app((tx) => updateProduct(tx, f.lemonade, { vatClass: "general" }));
    const dish = await build(f.dinner);
    expect(changeBodies(diffMenuDocuments(live, dish))).toEqual([
      {
        kind: "product_changed",
        productId: f.lemonade,
        name: "Lemonade",
        fields: ["vat"],
        source: "shared_product",
      },
    ]);
    await app(async (tx) => {
      await updateProduct(tx, f.large, { vatClass: "zero" });
      await updateProduct(tx, f.extraLemon, { vatClass: "general" });
    });
    expect(changeBodies(diffMenuDocuments(dish, await build(f.dinner)))).toEqual([
      {
        kind: "product_changed",
        productId: f.lemonade,
        name: "Lemonade",
        fields: ["vat", "variants"],
        source: "shared_product",
      },
      {
        kind: "product_changed",
        productId: f.extraLemon,
        name: "Extra lemon",
        fields: ["vat"],
        source: "shared_product",
      },
    ]);
  });

  it("names an extra's photo against the extra, a variant extra reading its parent's", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await updateProduct(tx, f.large, { image: null });
      await tx.insert(extraListItems).values({ listId: f.extrasList, productId: f.large, sort: 1 });
    });
    const live = await build(f.dinner);
    const extras = Object.values(live.offers)
      .find((offer) => offer.productId === f.lemonade)!
      .offeredModifiers.find((entry) => entry.kind === "extras");
    expect(extras?.kind === "extras" && extras.items.map((item) => item.image)).toEqual([
      null,
      "lemonade.jpg",
    ]);
    await app(async (tx) => {
      await updateProduct(tx, f.lemonade, { image: "cloudy.jpg" });
      await updateProduct(tx, f.extraLemon, { image: "lemon.jpg" });
    });
    expect(changeBodies(diffMenuDocuments(live, await build(f.dinner)))).toEqual([
      {
        kind: "product_changed",
        productId: f.lemonade,
        name: "Lemonade",
        fields: ["image"],
        source: "shared_product",
      },
      {
        kind: "product_changed",
        productId: f.extraLemon,
        name: "Extra lemon",
        fields: ["image"],
        source: "shared_product",
      },
      {
        kind: "product_changed",
        productId: f.large,
        name: "Large",
        fields: ["image"],
        source: "shared_product",
      },
    ]);
  });

  it("names the menu's renaming, a shortcut change and a display change for the device it changed", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.lunch);
    await addTile(await homeSection(f.lunch), { productId: f.soup });
    await app((tx) => setHomeDisplay(tx, f.lunch, "handheld", { tiles: "thumbnails" }));
    await app((tx) => updateMenuDetails(tx, f.lunch, { name: "Midday Menu" }));
    expect(changeBodies(diffMenuDocuments(live, await build(f.lunch)))).toEqual([
      { kind: "menu_renamed", from: "Lunch Menu", to: "Midday Menu", source: "this_menu" },
      { kind: "home_shortcuts_changed", source: "this_menu" },
      { kind: "home_display_changed", device: "handheld", source: "this_menu" },
    ]);
  });

  it("a first publish names its shortcuts and a display that differs from the default, and says nothing of a default display", async () => {
    const f = await menusFixture(fx.db);
    await addTile(await homeSection(f.lunch), { productId: f.soup });
    await app((tx) => setHomeDisplay(tx, f.lunch, "till", { order: "menu_first" }));
    const home = diffMenuDocuments(null, await build(f.lunch)).filter(({ kind }) =>
      kind.startsWith("home_"),
    );
    expect(changeBodies(home)).toEqual([
      { kind: "home_shortcuts_changed", source: "this_menu" },
      { kind: "home_display_changed", device: "till", source: "this_menu" },
    ]);
  });
});

describe("an include shown as a folder or directly", () => {
  type DocumentSection = Extract<DocumentMember, { kind: "section" }>;

  /** The member of `listId`, somewhere in `menuId`'s structure, that includes `sectionId`. */
  async function includeIn(menuId: string, listId: string, sectionId: string): Promise<string> {
    const structure = await app((tx) => readMenuStructure(tx, menuId));
    const find = (nodes: readonly MenuStructureNode[], holder: string): string | undefined => {
      for (const node of nodes) {
        if (holder === listId && node.ref.kind === "section" && node.ref.sectionId === sectionId)
          return node.memberId;
        if (node.ref.kind === "section" && node.children !== undefined) {
          const found = find(node.children, node.ref.sectionId);
          if (found !== undefined) return found;
        }
      }
      return undefined;
    };
    return find(structure.nodes, structure.rootSectionId)!;
  }
  const setFolder = (listId: string, memberId: string, input: IncludeFolderInput) =>
    app((tx) => setIncludeFolder(tx, listId, memberId, input));
  const sectionAt = (members: readonly DocumentMember[], sectionId: string) =>
    members.find(
      (member): member is DocumentSection =>
        member.kind === "section" && member.sectionId === sectionId,
    )!;
  const idsOf = (members: readonly DocumentMember[]) =>
    members.map((member) => (member.kind === "product" ? member.productId : member.sectionId));
  const fixBar = (f: Awaited<ReturnType<typeof menusFixture>>, memberId: string) =>
    setFolder(f.lunchRoot, memberId, {
      showAsFolder: true,
      overrides: { names: { en: "Bar" }, color: "#112233" },
    });

  it("a folder include is unchanged, and so is the hash of a menu with no direct include", async () => {
    const f = await menusFixture(fx.db);
    const before = await build(f.lunch);
    const hash = menuDocumentHash(before);
    await setFolder(f.lunchRoot, await includeIn(f.lunch, f.lunchRoot, f.drinks), {
      showAsFolder: true,
    });
    const after = await build(f.lunch);
    expect(after).toEqual(before);
    expect(menuDocumentHash(after)).toBe(hash);
  });

  it("an include shown directly keeps its node, marked direct, with its members in their order", async () => {
    const f = await menusFixture(fx.db);
    await setFolder(f.lunchRoot, await includeIn(f.lunch, f.lunchRoot, f.drinks), {
      showAsFolder: false,
    });
    const document = await build(f.lunch);
    const lemonade = await app((tx) => offerOf(tx, f.lunch, f.lemonade));
    const lager = await app((tx) => offerOf(tx, f.lunch, f.lager));
    const soup = await app((tx) => offerOf(tx, f.lunch, f.soup));
    expect(document.root.members).toEqual([
      {
        kind: "section",
        sectionId: f.drinks,
        direct: true,
        internalName: "Drinks",
        includedMenu: { id: f.drinksMenu, name: "Drinks" },
        names: { en: "Something to drink" },
        image: null,
        color: null,
        members: [
          { kind: "product", menuItemId: lemonade, productId: f.lemonade },
          {
            kind: "section",
            sectionId: f.beer,
            internalName: "Beer",
            names: { en: "On tap" },
            image: null,
            color: null,
            members: [{ kind: "product", menuItemId: lager, productId: f.lager }],
          },
        ],
      },
      { kind: "product", menuItemId: soup, productId: f.soup },
    ]);
    expect(idsOf(shownMembers(document.root.members))).toEqual([f.lemonade, f.beer, f.soup]);
  });

  it("the same menu is a folder in one including menu and direct in another", async () => {
    const f = await menusFixture(fx.db);
    await setFolder(f.lunchRoot, await includeIn(f.lunch, f.lunchRoot, f.drinks), {
      showAsFolder: false,
    });
    expect(sectionAt((await build(f.lunch)).root.members, f.drinks).direct).toBe(true);
    const dinner = sectionAt((await build(f.dinner)).root.members, f.drinks);
    expect(dinner).not.toHaveProperty("direct");
    expect(idsOf(shownMembers((await build(f.dinner)).root.members))).toEqual([f.drinks, f.mains]);
  });

  it("an include inside the flattened menu keeps its own setting", async () => {
    const f = await menusFixture(fx.db);
    const wineRoot = await app(async (tx) => {
      const wine = await createCatalogue(tx, { name: "Wine", names: { en: "Something red" } });
      const root = (await readMenuStructure(tx, wine.id)).rootSectionId;
      await addMember(tx, root, product(f.burger));
      await addMember(tx, f.drinks, section(root));
      return root;
    });
    await setFolder(f.lunchRoot, await includeIn(f.lunch, f.lunchRoot, f.drinks), {
      showAsFolder: false,
    });
    const wineInclude = await includeIn(f.drinksMenu, f.drinks, wineRoot);
    await setFolder(f.drinks, wineInclude, { showAsFolder: true });
    const folder = shownMembers((await build(f.lunch)).root.members);
    expect(idsOf(folder)).toEqual([f.lemonade, f.beer, wineRoot, f.soup]);
    expect(folder[2]).not.toHaveProperty("direct");
    await setFolder(f.drinks, wineInclude, { showAsFolder: false });
    expect(idsOf(shownMembers((await build(f.lunch)).root.members))).toEqual([
      f.lemonade,
      f.beer,
      f.burger,
      f.soup,
    ]);
  });

  it("a section named like one of the including menu's shows beside it", async () => {
    const f = await menusFixture(fx.db);
    const ownBeer = await app(
      async (tx) =>
        (await createSectionIn(tx, f.lunchRoot, { internalName: "Beer", names: { en: "Cerveza" } }))
          .id,
    );
    await setFolder(f.lunchRoot, await includeIn(f.lunch, f.lunchRoot, f.drinks), {
      showAsFolder: false,
    });
    const shown = shownMembers((await build(f.lunch)).root.members).filter(
      (member): member is DocumentSection =>
        member.kind === "section" && member.internalName === "Beer",
    );
    expect(shown.map((member) => member.sectionId)).toEqual([f.beer, ownBeer]);
  });

  it("an inactive included menu still drops out", async () => {
    const f = await menusFixture(fx.db);
    const memberId = await includeIn(f.lunch, f.lunchRoot, f.drinks);
    await app((tx) => deactivateCatalogue(tx, f.drinksMenu));
    const soup = await app((tx) => offerOf(tx, f.lunch, f.soup));
    for (const showAsFolder of [true, false]) {
      await setFolder(f.lunchRoot, memberId, { showAsFolder });
      expect((await build(f.lunch)).root.members).toEqual([
        { kind: "product", menuItemId: soup, productId: f.soup },
      ]);
    }
  });

  it("the folder shows the fixed names and colour, and follows every field left alone", async () => {
    const f = await menusFixture(fx.db);
    await fixBar(f, await includeIn(f.lunch, f.lunchRoot, f.drinks));
    const fixed = { names: { en: "Bar" }, color: "#112233" };
    const node = sectionAt((await build(f.lunch)).root.members, f.drinks);
    expect(node).toMatchObject({ names: { en: "Bar" }, color: "#112233", image: null, fixed });
    expect(node).not.toHaveProperty("direct");
    await app(async (tx) => {
      await updateMenuDetails(tx, f.drinksMenu, {
        names: { en: "Drinks and more", es: "Bebidas" },
      });
      await tx.update(sections).set({ image: "drinks.jpg" }).where(eq(sections.id, f.drinks));
    });
    expect(sectionAt((await build(f.lunch)).root.members, f.drinks)).toMatchObject({
      names: { en: "Bar", es: "Bebidas" },
      image: "drinks.jpg",
      color: "#112233",
      fixed,
    });
    expect(sectionAt((await build(f.dinner)).root.members, f.drinks)).toMatchObject({
      names: { en: "Drinks and more", es: "Bebidas" },
      image: "drinks.jpg",
      color: null,
    });
    expect(sectionAt((await build(f.dinner)).root.members, f.drinks)).not.toHaveProperty("fixed");
  });

  it("a fixed photo, and a fixed no-photo, replace the included menu's", async () => {
    const f = await menusFixture(fx.db);
    const memberId = await includeIn(f.lunch, f.lunchRoot, f.drinks);
    const fixPhoto = (image: string | null) =>
      app(async (tx) => {
        await tx.update(sections).set({ image: "drinks.jpg" }).where(eq(sections.id, f.drinks));
        await tx
          .update(sectionMembers)
          .set({ folderOverrides: { image } })
          .where(eq(sectionMembers.id, memberId));
      });
    await fixPhoto("bar.jpg");
    const photo = await build(f.lunch);
    expect(sectionAt(photo.root.members, f.drinks)).toMatchObject({
      image: "bar.jpg",
      fixed: { image: "bar.jpg" },
    });
    expect(documentImages(photo)).toContain("bar.jpg");
    expect(documentImages(photo)).not.toContain("drinks.jpg");
    await fixPhoto(null);
    const none = await build(f.lunch);
    expect(sectionAt(none.root.members, f.drinks)).toMatchObject({
      image: null,
      fixed: { image: null },
    });
    expect(documentImages(none)).not.toContain("drinks.jpg");
  });

  it("switched off, the node shows the included menu's own presentation and keeps the stored overrides", async () => {
    const f = await menusFixture(fx.db);
    const memberId = await includeIn(f.lunch, f.lunchRoot, f.drinks);
    await fixBar(f, memberId);
    await setFolder(f.lunchRoot, memberId, { showAsFolder: false });
    const direct = sectionAt((await build(f.lunch)).root.members, f.drinks);
    expect(direct).toMatchObject({
      direct: true,
      names: { en: "Something to drink" },
      image: null,
      color: null,
    });
    expect(direct).not.toHaveProperty("fixed");
    await setFolder(f.lunchRoot, memberId, { showAsFolder: true });
    expect(sectionAt((await build(f.lunch)).root.members, f.drinks)).toMatchObject({
      names: { en: "Bar" },
      color: "#112233",
      fixed: { names: { en: "Bar" }, color: "#112233" },
    });
  });

  it("a home shortcut to an included menu shown directly is kept", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => addShortcut(tx, f.lunch, section(f.drinks)));
    await setFolder(f.lunchRoot, await includeIn(f.lunch, f.lunchRoot, f.drinks), {
      showAsFolder: false,
    });
    expect((await build(f.lunch)).home.shortcuts).toEqual([
      { kind: "section", sectionId: f.drinks },
    ]);
  });

  it("the same included menu in two lists of one menu keeps each list's setting", async () => {
    const f = await menusFixture(fx.db);
    const bar = await app(async (tx) => {
      const id = (
        await createSectionIn(tx, f.lunchRoot, { internalName: "Bar", names: { en: "At the bar" } })
      ).id;
      await addMember(tx, id, section(f.drinks));
      return id;
    });
    await setFolder(f.lunchRoot, await includeIn(f.lunch, f.lunchRoot, f.drinks), {
      showAsFolder: false,
    });
    await setFolder(bar, await includeIn(f.lunch, bar, f.drinks), {
      showAsFolder: true,
      overrides: { names: { en: "Bar drinks" } },
    });
    const { members } = (await build(f.lunch)).root;
    const atRoot = sectionAt(members, f.drinks);
    const nested = sectionAt(sectionAt(members, bar).members, f.drinks);
    expect(atRoot).toMatchObject({ direct: true, names: { en: "Something to drink" } });
    expect(atRoot).not.toHaveProperty("fixed");
    expect(nested).toMatchObject({
      names: { en: "Bar drinks" },
      fixed: { names: { en: "Bar drinks" } },
    });
    expect(nested).not.toHaveProperty("direct");
  });
});

function changeBodies(changes: readonly MenuChange[]): MenuChangeBody[] {
  return changes.map((change) => {
    expect(change.id).toEqual(expect.any(String));
    expect(change.targets).toEqual({ before: expect.any(Array), after: expect.any(Array) });
    const body: MenuChangeBody & Partial<Pick<MenuChange, "id" | "targets">> = { ...change };
    delete body.id;
    delete body.targets;
    return body;
  });
}
