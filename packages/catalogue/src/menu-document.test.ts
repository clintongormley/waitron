import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { products, withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, offerOf, product, section, WITH_ICE } from "../test/menus-fixture.js";
import {
  applyLiveFields,
  buildMenuDocument,
  diffMenuDocuments,
  menuDocumentHash,
  type MenuDocument,
} from "./menu-document.js";
import { renameCatalogue, updateMenuItem, updateProduct } from "./operations.js";
import { addMember, moveMember, removeMember, updateSection } from "./sections.js";
import { setMenuVariants, setProductVariants } from "./variants.js";
import { setMenuItemExtraLists } from "./extras.js";
import { writeProductModifiers } from "./product-modifiers.js";
import { extraListItems } from "./schema/extras.js";
import { menuDetails } from "./schema/menu.js";
import { optionLabels } from "./schema/options.js";
import { sectionMembers, sections } from "./schema/sections.js";
import { menuItemExtraItems } from "./schema/extras.js";

const fx = useCatalogueDb();
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

async function defaultLayout(menuId: string): Promise<string> {
  const [row] = await fx.db
    .select({ id: menuDetails.defaultHomeLayoutId })
    .from(menuDetails)
    .where(eq(menuDetails.menuId, menuId));
  return row!.id;
}

let tilePosition = 0;
async function addTile(layoutId: string, ref: { productId?: string; sectionId?: string }) {
  await fx.db.insert(sectionMembers).values({
    sectionId: layoutId,
    position: tilePosition++,
    productId: ref.productId ?? null,
    childSectionId: ref.sectionId ?? null,
  });
}

describe("buildMenuDocument", () => {
  it("holds the structure with display content, one offer per product, and the layouts", async () => {
    const f = await menusFixture(fx.db);
    const document = await build(f.lunch);
    const lemonade = await app((tx) => offerOf(tx, f.lunch, f.lemonade));
    const lager = await app((tx) => offerOf(tx, f.lunch, f.lager));
    const soup = await app((tx) => offerOf(tx, f.lunch, f.soup));
    expect(document).toMatchObject({
      format: 1,
      menuId: f.lunch,
      menuName: "Lunch Menu",
      defaultHomeLayoutId: await defaultLayout(f.lunch),
      homeLayouts: [{ id: await defaultLayout(f.lunch), name: "Home", tiles: [] }],
    });
    expect(document.root).toEqual({
      members: [
        {
          kind: "section",
          sectionId: f.drinks,
          internalName: "Drinks",
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
      offered: true,
    });
  });

  it("leaves out every live field and every field that is not menu content", async () => {
    const f = await menusFixture(fx.db);
    const document = await build(f.lunch);
    const offer = document.offers[await app((tx) => offerOf(tx, f.lunch, f.lemonade))]!;
    for (const field of ["available", "vatClass", "courseId", "category"])
      expect(Object.keys(offer)).not.toContain(field);
    for (const field of ["available", "vatClass", "courseId", "category"])
      expect(Object.keys(offer.variants[0]!)).not.toContain(field);
    const [extras, options] = offer.offeredModifiers;
    if (extras?.kind !== "extras" || options?.kind !== "options") throw new Error("lists");
    expect(Object.keys(extras.items[0]!)).not.toContain("vatClass");
    expect(Object.keys(extras.items[0]!)).not.toContain("available");
    for (const label of options.labels) expect(Object.keys(label)).not.toContain("available");
  });

  it("holds every extras item and option label, available or not", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await tx.update(optionLabels).set({ available: false }).where(eq(optionLabels.id, WITH_ICE));
      await updateProduct(tx, f.extraLemon, { available: false });
      await tx.insert(menuItemExtraItems).values({
        menuItemId: await offerOf(tx, f.dinner, f.lemonade),
        listId: f.extrasList,
        productId: f.extraLemon,
        available: false,
      });
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

  it("omits a product the menu switches off, and one that is deleted", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await updateMenuItem(tx, f.lunch, await offerOf(tx, f.lunch, f.soup), { active: false });
      await updateProduct(tx, f.lager, { active: false });
    });
    const document = await build(f.lunch);
    expect(Object.values(document.offers).map((offer) => offer.name)).toEqual(["Lemonade"]);
    expect(JSON.stringify(document.root)).not.toContain(f.soup);
    expect(JSON.stringify(document.root)).not.toContain(f.lager);
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

  it("leaves a shortcut whose target is not on the menu out of the layout, and reports it (D13)", async () => {
    const f = await menusFixture(fx.db);
    const layout = await defaultLayout(f.lunch);
    await addTile(layout, { productId: f.lemonade });
    await addTile(layout, { productId: f.burger });
    await addTile(layout, { sectionId: f.beer });
    await addTile(layout, { sectionId: f.mains });
    const { document, omittedShortcuts } = await app((tx) => buildMenuDocument(tx, f.lunch));
    expect(document.homeLayouts[0]!.tiles).toEqual([
      { kind: "product", productId: f.lemonade },
      { kind: "section", sectionId: f.beer },
    ]);
    expect(omittedShortcuts).toEqual([
      { layoutId: layout, ref: product(f.burger) },
      { layoutId: layout, ref: section(f.mains) },
    ]);
  });

  it("puts the default layout first and the others by name", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    for (const name of ["Terrace", "Counter"])
      await fx.db
        .insert(sections)
        .values({ internalName: name, role: "home_layout", ownerMenuId: f.lunch });
    const document = await build(f.lunch);
    expect(document.homeLayouts.map((layout) => layout.name)).toEqual([
      "Home",
      "Counter",
      "Terrace",
    ]);
    expect(document.homeLayouts[0]!.id).toBe(home);
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
    ["the dish's VAT class", (tx, f) => updateProduct(tx, f.lemonade, { vatClass: "general" })],
    ["the variant's VAT class", (tx, f) => updateProduct(tx, f.large, { vatClass: "general" })],
    ["the extra's VAT class", (tx, f) => updateProduct(tx, f.extraLemon, { vatClass: "general" })],
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
    [
      "whether the offer withdraws the extra",
      async (tx, f) =>
        tx.insert(menuItemExtraItems).values({
          menuItemId: await offerOf(tx, f.dinner, f.lemonade),
          listId: f.extrasList,
          productId: f.extraLemon,
          available: false,
        }),
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
    ["the dish's name", (tx, f) => updateProduct(tx, f.lemonade, { name: "Still lemonade" })],
    ["the dish's price", (tx, f) => updateProduct(tx, f.lemonade, { unitPrice: "3.20" })],
    ["the dish's image", (tx, f) => updateProduct(tx, f.lemonade, { image: "other.jpg" })],
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
      "whether the variant is offered",
      async (tx, f) =>
        setMenuVariants(tx, await offerOf(tx, f.dinner, f.lemonade), [
          { variantId: f.large, price: null, offered: false },
        ]),
    ],
    ["the extra's name", (tx, f) => updateProduct(tx, f.extraLemon, { name: "Lemon wedge" })],
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
});

describe("applyLiveFields", () => {
  it("puts availability, VAT, course and category back from the current rows", async () => {
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
      await tx.update(optionLabels).set({ available: false }).where(eq(optionLabels.id, WITH_ICE));
      await tx.insert(menuItemExtraItems).values({
        menuItemId: await offerOf(tx, f.dinner, f.lemonade),
        listId: f.extrasList,
        productId: f.extraLemon,
        available: false,
      });
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
      vatClass: "general",
      courseId: f.course,
      category: "Cold drinks",
      unitPrice: "2.80",
      menuName: "Lunch Menu",
      image: "lemonade.jpg",
    });
    expect(lemonade.variants[0]).toMatchObject({
      id: f.large,
      available: false,
      vatClass: "general",
      courseId: f.course,
      category: "Cold drinks",
    });
    const [extras, options] = lemonade.offeredModifiers;
    if (extras?.kind !== "extras" || options?.kind !== "options") throw new Error("lists");
    expect(extras.items).toMatchObject([
      { productId: f.extraLemon, available: true, vatClass: "reduced" },
    ]);
    expect(options.labels.map((label) => [label.name, label.available])).toEqual([
      ["No ice", true],
      ["With ice", false],
    ]);
    // Withdrawn from Dinner's offer alone.
    const dinnerLemonade = live.get(f.dinner)!.find((offer) => offer.productId === f.lemonade)!;
    const dinnerExtras = dinnerLemonade.offeredModifiers[0]!;
    expect(dinnerExtras.kind === "extras" && dinnerExtras.items[0]!.available).toBe(false);
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

  it("clears the default label while it is unavailable", async () => {
    const f = await menusFixture(fx.db);
    const document = await build(f.lunch);
    await app((tx) =>
      tx
        .update(optionLabels)
        .set({ available: false })
        .where(sql`${optionLabels.listId} = ${f.iceList} and ${optionLabels.name} = 'No ice'`),
    );
    const [lemonade] = (await app((tx) => applyLiveFields(tx, [document]))).get(f.lunch)!;
    const options = lemonade!.offeredModifiers[1]!;
    expect(options.kind === "options" && options.defaultLabelId).toBeNull();
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
    expect(changes).toEqual([
      {
        kind: "section_added",
        sectionId: f.drinks,
        name: "Drinks",
        under: [],
        source: "this_menu",
      },
      {
        kind: "section_added",
        sectionId: f.beer,
        name: "Beer",
        under: ["Drinks"],
        source: "shared_section",
      },
      {
        kind: "product_added",
        productId: f.lemonade,
        name: "Lemonade",
        under: ["Drinks"],
        source: "shared_section",
      },
      {
        kind: "product_added",
        productId: f.lager,
        name: "Lager",
        under: ["Drinks", "Beer"],
        source: "shared_section",
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
    expect(diffMenuDocuments(live, await build(f.lunch))).toEqual([
      { kind: "order_changed", list: [], source: "this_menu" },
    ]);
  });

  it("names a reorder inside a section as that section's change", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.lunch);
    await app(async (tx) =>
      moveMember(tx, f.drinks, await memberOf(f.drinks, { sectionId: f.beer }), 0),
    );
    expect(diffMenuDocuments(live, await build(f.lunch))).toEqual([
      { kind: "order_changed", list: ["Drinks"], source: "shared_section" },
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
    expect(diffMenuDocuments(live, await build(f.lunch))).toEqual([
      {
        kind: "product_removed",
        productId: f.lager,
        name: "Lager",
        under: ["Drinks", "Beer"],
        source: "shared_section",
      },
      {
        kind: "product_moved",
        productId: f.soup,
        name: "Soup",
        from: [[]],
        to: [["Drinks"]],
        source: "shared_section",
      },
    ]);
  });

  it("names a section removed and its products", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.lunch);
    await app(async (tx) =>
      removeMember(tx, f.drinks, await memberOf(f.drinks, { sectionId: f.beer })),
    );
    expect(diffMenuDocuments(live, await build(f.lunch))).toEqual([
      {
        kind: "section_removed",
        sectionId: f.beer,
        name: "Beer",
        under: ["Drinks"],
        source: "shared_section",
      },
      {
        kind: "product_removed",
        productId: f.lager,
        name: "Lager",
        under: ["Drinks", "Beer"],
        source: "shared_section",
      },
    ]);
  });

  it("names a section's changed details", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.lunch);
    await app(async (tx) => {
      await updateSection(tx, f.drinks, { internalName: "Soft drinks", color: "#112233" });
      await tx.update(sections).set({ image: "drinks.jpg" }).where(eq(sections.id, f.drinks));
      await updateSection(tx, f.beer, { names: { en: "Cold beers" } });
    });
    expect(diffMenuDocuments(live, await build(f.lunch))).toEqual([
      {
        kind: "section_changed",
        sectionId: f.drinks,
        name: "Soft drinks",
        fields: ["names", "image", "color"],
        source: "shared_section",
      },
      {
        kind: "section_changed",
        sectionId: f.beer,
        name: "Beer",
        fields: ["names"],
        source: "shared_section",
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
    expect(diffMenuDocuments(lunch, await build(f.lunch))).toEqual([
      {
        kind: "price_changed",
        productId: f.lemonade,
        name: "Lemonade",
        from: "2.80",
        to: "2.60",
        source: "this_menu",
      },
    ]);
    expect(diffMenuDocuments(dinner, await build(f.dinner))).toEqual([
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
    expect(diffMenuDocuments(live, await build(f.lunch))).toEqual([
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
    const live = await build(f.lunch);
    await app(async (tx) => {
      await addMember(tx, f.lunchRoot, section(f.beer));
      await addMember(tx, f.lunchRoot, product(f.lemonade));
    });
    expect(diffMenuDocuments(live, await build(f.lunch))).toEqual([
      { kind: "section_added", sectionId: f.beer, name: "Beer", under: [], source: "this_menu" },
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
        source: "shared_section",
      },
    ]);
  });

  it("names a change to an extra that is also a dish once, as the dish's", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await writeProductModifiers(tx, f.soup, [{ kind: "extras", id: f.extrasList }]);
      await setMenuItemExtraLists(tx, await offerOf(tx, f.lunch, f.soup), [
        { listId: f.extrasList, items: [] },
      ]);
      await addMember(tx, f.lunchRoot, product(f.extraLemon));
    });
    const live = await build(f.lunch);
    await app(async (tx) => {
      await updateProduct(tx, f.extraLemon, { allergens: { sulphites: { presence: "contains" } } });
      await tx.insert(extraListItems).values({ listId: f.extrasList, productId: f.lager, sort: 1 });
    });
    expect(diffMenuDocuments(live, await build(f.lunch))).toEqual([
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
        { variantId: f.large, price: "4.00", offered: true },
      ]);
    });
    expect(diffMenuDocuments(live, await build(f.dinner))).toEqual([
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
    expect(diffMenuDocuments(live, await build(f.dinner))).toEqual([
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
    expect(diffMenuDocuments(live, await build(f.dinner))).toEqual([
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
    expect(diffMenuDocuments(live, await build(f.dinner))).toEqual([
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

  it("names the layouts, the default layout and the menu's name", async () => {
    const f = await menusFixture(fx.db);
    const live = await build(f.lunch);
    const home = await defaultLayout(f.lunch);
    const [counter] = await fx.db
      .insert(sections)
      .values({ internalName: "Counter", role: "home_layout", ownerMenuId: f.lunch })
      .returning({ id: sections.id });
    await addTile(home, { productId: f.soup });
    await fx.db
      .update(menuDetails)
      .set({ defaultHomeLayoutId: counter!.id })
      .where(eq(menuDetails.menuId, f.lunch));
    await app((tx) => renameCatalogue(tx, f.lunch, "Midday Menu"));
    expect(diffMenuDocuments(live, await build(f.lunch))).toEqual([
      { kind: "menu_renamed", from: "Lunch Menu", to: "Midday Menu", source: "this_menu" },
      { kind: "layout_changed", layoutId: counter!.id, name: "Counter", source: "this_menu" },
      { kind: "layout_changed", layoutId: home, name: "Home", source: "this_menu" },
      { kind: "default_layout_changed", from: "Home", to: "Counter", source: "this_menu" },
    ]);
  });

  it("names a layout that was removed", async () => {
    const f = await menusFixture(fx.db);
    const [counter] = await fx.db
      .insert(sections)
      .values({ internalName: "Counter", role: "home_layout", ownerMenuId: f.lunch })
      .returning({ id: sections.id });
    const live = await build(f.lunch);
    await fx.db.delete(sections).where(eq(sections.id, counter!.id));
    expect(diffMenuDocuments(live, await build(f.lunch))).toEqual([
      { kind: "layout_changed", layoutId: counter!.id, name: "Counter", source: "this_menu" },
    ]);
  });
});
