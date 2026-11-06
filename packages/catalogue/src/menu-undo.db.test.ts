import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  products,
  withTransaction,
  type Transaction,
  menuItems,
  menuItemVariantOverrides,
  sectionMembers,
  sections,
} from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, offerOf, type MenusFixture } from "../test/menus-fixture.js";
import { readContentLanguages, writeContentLanguages } from "./content-languages.js";
import type { MenuChange, MenuPreview } from "@waitron/shared";
import { readMenuHome, setHomeDisplay } from "./menu-home.js";
import { readMenuStructure } from "./menu-structure.js";
import { previewMenu, publishMenu } from "./menu-publication.js";
import { menuChangeActions, type MenuChangeAction, type MenuUndoCommand } from "./menu-undo.js";
import { updateMenuDetails, updateMenuItem, updateProduct } from "./operations.js";
import { setIncludeFolder } from "./include-folder.js";
import { createSectionIn, updateSection } from "./sections.js";
import { setMenuVariantPrice, setProductVariants } from "./variants.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

/** Each command through the catalogue function its route calls. */
function run(tx: Transaction, command: MenuUndoCommand): Promise<unknown> {
  switch (command.method) {
    case "renameCatalogue":
      return updateMenuDetails(tx, command.menuId, { name: command.name });
    case "updateMenuItem":
      return updateMenuItem(tx, command.menuId, command.menuItemId, command.input);
    case "setMenuVariantPrice":
      return setMenuVariantPrice(
        tx,
        command.menuItemId,
        command.variantId,
        command.price,
        command.menuId,
      );
    case "updateSection":
      return updateSection(tx, command.sectionId, command.patch);
    case "setHomeDisplay":
      return setHomeDisplay(tx, command.menuId, command.device, command.patch);
  }
}

async function publish(menuId: string): Promise<void> {
  const { hash } = await app((tx) => previewMenu(tx, menuId));
  await app((tx) => publishMenu(tx, menuId, hash, "person-1"));
}

async function readPreview(menuId: string): Promise<MenuPreview> {
  return app((tx) => previewMenu(tx, menuId));
}

async function actionsOf(preview: MenuPreview): Promise<ReadonlyMap<string, MenuChangeAction>> {
  const { languages } = await app((tx) => readContentLanguages(tx, "en"));
  return menuChangeActions({ preview, languages });
}

/** The one change `pick` finds, and the action offered beside it. */
async function changeAndAction(
  preview: MenuPreview,
  pick: (change: MenuChange) => boolean,
): Promise<{ change: MenuChange; action: MenuChangeAction }> {
  const found = preview.changes.filter(pick);
  expect(found).toHaveLength(1);
  const change = found[0]!;
  return { change, action: (await actionsOf(preview)).get(change.id)! };
}

function commandOf(action: MenuChangeAction): MenuUndoCommand {
  expect(action.kind).toBe("undo");
  return (action as Extract<MenuChangeAction, { kind: "undo" }>).command;
}

/** Changes Burger's menu price on Dinner, the unrelated change every Undo leaves alone. */
async function changeBurgerPrice(f: MenusFixture): Promise<void> {
  await app(async (tx) =>
    updateMenuItem(tx, f.dinner, await offerOf(tx, f.dinner, f.burger), { grossPrice: "13.50" }),
  );
}

/**
 * Runs the Undo of the one change `pick` finds on `menuId`, then reads the preview again: that
 * change is gone, every other change is as it was, and so is `otherMenuId`'s preview.
 */
async function undoAndCheck(
  menuId: string,
  otherMenuId: string,
  pick: (change: MenuChange) => boolean,
): Promise<MenuUndoCommand> {
  const before = await readPreview(menuId);
  const otherBefore = await readPreview(otherMenuId);
  const { change, action } = await changeAndAction(before, pick);
  const command = commandOf(action);
  await app((tx) => run(tx, command));
  const after = await readPreview(menuId);
  expect(after.changes.map(({ id }) => id)).not.toContain(change.id);
  const others = before.changes.filter(({ id }) => id !== change.id);
  expect(others.length).toBeGreaterThan(0);
  expect(after.changes).toEqual(others);
  const otherAfter = await readPreview(otherMenuId);
  expect(otherAfter.changes).toEqual(otherBefore.changes);
  expect(otherAfter.hash).toBe(otherBefore.hash);
  return command;
}

async function sectionRow(sectionId: string) {
  const [row] = await fx.db
    .select({
      internalName: sections.internalName,
      names: sections.names,
      image: sections.image,
      color: sections.color,
    })
    .from(sections)
    .where(eq(sections.id, sectionId));
  return row!;
}

async function rootOf(menuId: string): Promise<string> {
  return (await app((tx) => readMenuStructure(tx, menuId))).rootSectionId;
}

const isRename = (change: MenuChange) => change.kind === "menu_renamed";

describe("menu rename Undo", () => {
  it("puts back the published name and nothing else", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    const root = await rootOf(f.dinner);
    await app((tx) => updateMenuDetails(tx, f.dinner, { name: "Supper" }));
    await changeBurgerPrice(f);
    const rootBefore = await sectionRow(root);

    const command = await undoAndCheck(f.dinner, f.lunch, isRename);

    expect(command).toEqual({ method: "renameCatalogue", menuId: f.dinner, name: "Dinner Menu" });
    expect(await sectionRow(root)).toEqual({ ...rootBefore, internalName: "Dinner Menu" });
  });

  it("is refused when another menu has taken the published name since", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app((tx) => updateMenuDetails(tx, f.dinner, { name: "Supper" }));
    await app((tx) => updateMenuDetails(tx, f.lunch, { name: "Dinner Menu" }));
    const { action } = await changeAndAction(await readPreview(f.dinner), isRename);
    const command = commandOf(action);

    await expect(app((tx) => run(tx, command))).rejects.toMatchObject({
      code: "menu.name_taken",
    });

    expect((await readPreview(f.dinner)).changes).toContainEqual(
      expect.objectContaining({ kind: "menu_renamed", from: "Dinner Menu", to: "Supper" }),
    );
  });
});

describe("Home display Undo", () => {
  const isHandheld = (change: MenuChange) =>
    change.kind === "home_display_changed" && change.device === "handheld";

  it("sends only the column count when only that changed", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app((tx) => setHomeDisplay(tx, f.dinner, "handheld", { columns: 2 }));
    await changeBurgerPrice(f);
    const homeBefore = await app((tx) => readMenuHome(tx, f.dinner));

    const command = await undoAndCheck(f.dinner, f.lunch, isHandheld);

    expect(command).toEqual({
      method: "setHomeDisplay",
      menuId: f.dinner,
      device: "handheld",
      patch: { columns: 3 },
    });
    const homeAfter = await app((tx) => readMenuHome(tx, f.dinner));
    expect(homeAfter.till).toEqual(homeBefore.till);
    expect(homeAfter.shortcuts).toEqual(homeBefore.shortcuts);
    expect(homeAfter.handheld).toEqual({ ...homeBefore.handheld, columns: 3 });
  });

  it("sends the columns and the tiles when both changed, never the order", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app((tx) =>
      setHomeDisplay(tx, f.dinner, "handheld", { columns: 2, tiles: "thumbnails" }),
    );
    await changeBurgerPrice(f);
    const homeBefore = await app((tx) => readMenuHome(tx, f.dinner));

    const command = await undoAndCheck(f.dinner, f.lunch, isHandheld);

    expect(command).toEqual({
      method: "setHomeDisplay",
      menuId: f.dinner,
      device: "handheld",
      patch: { columns: 3, tiles: "colours" },
    });
    const homeAfter = await app((tx) => readMenuHome(tx, f.dinner));
    expect(homeAfter.till).toEqual(homeBefore.till);
    expect(homeAfter.shortcuts).toEqual(homeBefore.shortcuts);
  });
});

describe("own section Undo", () => {
  const isMains = (f: MenusFixture) => (change: MenuChange) =>
    change.kind === "section_changed" && change.sectionId === f.mains;

  it("puts back the names and the colour in one write, leaving the photo alone", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app((tx) =>
      updateSection(tx, f.mains, {
        internalName: "Big plates",
        names: { en: "Big plates" },
        color: "#336699",
      }),
    );
    await changeBurgerPrice(f);

    const command = await undoAndCheck(f.dinner, f.lunch, isMains(f));

    expect(command).toEqual({
      method: "updateSection",
      sectionId: f.mains,
      patch: { internalName: "Mains", names: { en: "Main courses" }, color: null },
      name: "Big plates",
    });
    expect(await sectionRow(f.mains)).toEqual({
      internalName: "Mains",
      names: { en: "Main courses" },
      image: null,
      color: null,
    });
  });

  it("puts back a section inside another of this menu's sections", async () => {
    const f = await menusFixture(fx.db);
    const sides = (
      await app((tx) => createSectionIn(tx, f.mains, { internalName: "Sides", names: {} }))
    ).id;
    await publish(f.dinner);
    await app((tx) => updateSection(tx, sides, { color: "#336699" }));
    await changeBurgerPrice(f);

    const command = await undoAndCheck(
      f.dinner,
      f.lunch,
      (change) => change.kind === "section_changed" && change.sectionId === sides,
    );

    expect(command).toEqual({
      method: "updateSection",
      sectionId: sides,
      patch: { color: null },
      name: "Sides",
    });
  });

  it("is offered when a language switched off since kept its published name", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) =>
      writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] }),
    );
    await app((tx) =>
      updateSection(tx, f.mains, { names: { en: "Main courses", es: "Principales" } }),
    );
    await publish(f.dinner);
    await app((tx) =>
      updateSection(tx, f.mains, { names: { en: "Big plates", es: "Principales" } }),
    );
    await app((tx) => writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en"] }));
    await changeBurgerPrice(f);

    await undoAndCheck(f.dinner, f.lunch, isMains(f));

    expect((await sectionRow(f.mains)).names).toEqual({ en: "Main courses", es: "Principales" });
  });

  it.each<{ edit: string; names: Record<string, string> }>([
    { edit: "edited", names: { en: "Big plates", es: "Platos grandes" } },
    { edit: "emptied", names: { en: "Big plates" } },
  ])(
    "offers nothing when a language switched off since was $edit before it was",
    async ({ names }) => {
      const f = await menusFixture(fx.db);
      await app((tx) =>
        writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] }),
      );
      await app((tx) =>
        updateSection(tx, f.mains, { names: { en: "Main courses", es: "Principales" } }),
      );
      await publish(f.dinner);
      await app((tx) => updateSection(tx, f.mains, { names }));
      await app((tx) => writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en"] }));

      const { action } = await changeAndAction(await readPreview(f.dinner), isMains(f));

      expect(action).toEqual({ kind: "none" });
    },
  );

  it("offers nothing yet for how this menu shows an included menu", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    const [include] = await fx.db
      .select({ id: sectionMembers.id })
      .from(sectionMembers)
      .where(
        and(
          eq(sectionMembers.sectionId, f.dinnerRoot),
          eq(sectionMembers.childSectionId, f.drinks),
        ),
      );
    await app((tx) => setIncludeFolder(tx, f.dinnerRoot, include!.id, { showAsFolder: false }));

    const { change, action } = await changeAndAction(
      await readPreview(f.dinner),
      (found) => found.kind === "section_changed" && found.sectionId === f.drinks,
    );

    expect(change).toMatchObject({ source: "this_menu", fields: ["direct"] });
    expect(action).toEqual({ kind: "none" });
  });

  it("still sends an included menu's renamed section to that menu", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app((tx) => updateMenuDetails(tx, f.drinksMenu, { name: "Bar" }));

    const { action } = await changeAndAction(
      await readPreview(f.dinner),
      (change) => change.kind === "section_changed" && change.sectionId === f.drinks,
    );

    expect(action).toEqual({ kind: "edit_menu", menuId: f.drinksMenu, tab: "structure" });
  });
});

/** The stored price settings of one offer: the menu's own dish price and every variant row. */
async function storedPrices(menuId: string, productId: string) {
  return app(async (tx) => {
    const menuItemId = await offerOf(tx, menuId, productId);
    const [item] = await tx
      .select({ grossPrice: menuItems.grossPrice })
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    const variants = await tx
      .select({
        variantId: menuItemVariantOverrides.variantId,
        price: menuItemVariantOverrides.price,
      })
      .from(menuItemVariantOverrides)
      .where(eq(menuItemVariantOverrides.menuItemId, menuItemId))
      .orderBy(menuItemVariantOverrides.variantId);
    return { grossPrice: item!.grossPrice, variants };
  });
}

async function setDishPrice(menuId: string, productId: string, grossPrice: string | null) {
  await app(async (tx) =>
    updateMenuItem(tx, menuId, await offerOf(tx, menuId, productId), { grossPrice }),
  );
}

async function setVariantPrice(
  menuId: string,
  productId: string,
  variantId: string,
  price: string | null,
) {
  await app(async (tx) =>
    setMenuVariantPrice(tx, await offerOf(tx, menuId, productId), variantId, price, menuId),
  );
}

/** The menu's own offer of the product in the preview's working document. */
function offerIn(preview: MenuPreview, productId: string) {
  return Object.values(preview.document.offers).find((offer) => offer.productId === productId)!;
}

const isPriceOf = (productId: string) => (change: MenuChange) =>
  change.kind === "price_changed" &&
  change.productId === productId &&
  change.source === "this_menu";
const isOwnVariantsOf = (productId: string) => (change: MenuChange) =>
  change.kind === "product_changed" &&
  change.productId === productId &&
  change.source === "this_menu";

interface PriceCase {
  dish: string;
  /** The change's bullet name. */
  name: string;
  /** The menu that sets the price, and the menu every Undo leaves alone. */
  menu: (f: MenusFixture) => string;
  other: (f: MenusFixture) => string;
  product: (f: MenusFixture) => string;
}

const priceCases: PriceCase[] = [
  {
    dish: "Burger on Dinner",
    name: "Burger",
    menu: (f) => f.dinner,
    other: (f) => f.lunch,
    product: (f) => f.burger,
  },
  {
    dish: "Lemonade on Lunch, reached through Drinks",
    name: "Lemonade",
    menu: (f) => f.lunch,
    other: (f) => f.dinner,
    product: (f) => f.lemonade,
  },
];

describe.each(priceCases)("dish price Undo: $dish", ({ name, menu, other, product }) => {
  it.each<{ live: string | null; now: string | null }>([
    { live: "4.00", now: "9.99" },
    { live: "4.00", now: null },
    { live: "0.00", now: "5.00" },
    { live: null, now: "5.00" },
  ])("puts back a published price of $live set to $now", async ({ live, now }) => {
    const f = await menusFixture(fx.db);
    await setDishPrice(menu(f), product(f), live);
    await publish(menu(f));
    const stored = await storedPrices(menu(f), product(f));
    await setDishPrice(menu(f), product(f), now);
    await app((tx) => updateMenuDetails(tx, menu(f), { name: "Renamed" }));

    const command = await undoAndCheck(menu(f), other(f), isPriceOf(product(f)));

    expect(command).toEqual({
      method: "updateMenuItem",
      menuId: menu(f),
      menuItemId: await app((tx) => offerOf(tx, menu(f), product(f))),
      input: { grossPrice: live },
      name,
    });
    expect(await storedPrices(menu(f), product(f))).toEqual(stored);
    expect(offerIn(await readPreview(menu(f)), product(f)).grossPrice).toBe(live);
  });

  it("offers nothing when the price it would inherit moved too", async () => {
    const f = await menusFixture(fx.db);
    await setDishPrice(menu(f), product(f), null);
    await publish(menu(f));
    await setDishPrice(menu(f), product(f), "5.00");
    await app((tx) => updateProduct(tx, product(f), { unitPrice: "7.25" }));

    const { change, action } = await changeAndAction(
      await readPreview(menu(f)),
      isPriceOf(product(f)),
    );

    expect(change).toMatchObject({ inheritedPrice: "7.25" });
    expect(action).toEqual({ kind: "none" });
  });
});

describe("a shared product's price change", () => {
  it("sends Burger's own price change to its product editor", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app((tx) => updateProduct(tx, f.burger, { unitPrice: "12.50" }));

    const { change, action } = await changeAndAction(
      await readPreview(f.dinner),
      (found) => found.kind === "price_changed" && found.productId === f.burger,
    );

    expect(change.source).toBe("shared_product");
    expect(action).toEqual({ kind: "edit_product", productId: f.burger });
  });
});

describe("variant price Undo", () => {
  const large = (f: MenusFixture, unitPrice: string | null) => ({
    id: f.large,
    name: "Large",
    customerName: { en: "A big glass" },
    kitchenName: "LRG",
    image: "large.jpg",
    unitPrice,
    available: true,
  });

  /** Gives Lemonade a second variant, Small, and returns its id. */
  async function addSmall(f: MenusFixture, largePrice: string | null = "3.50"): Promise<string> {
    const variants = await app((tx) =>
      setProductVariants(
        tx,
        f.lemonade,
        [
          large(f, largePrice),
          {
            name: "Small",
            customerName: { en: "A little glass" },
            kitchenName: "SML",
            image: null,
            unitPrice: "2.50",
            available: true,
          },
        ],
        "en",
      ),
    );
    return variants.find((variant) => variant.name === "Small")!.id;
  }

  it.each<{ live: string | null; now: string | null }>([
    { live: null, now: "4.00" },
    { live: "4.00", now: "0.00" },
  ])("puts back one variant's published price of $live set to $now", async ({ live, now }) => {
    const f = await menusFixture(fx.db);
    const small = await addSmall(f);
    await setVariantPrice(f.lunch, f.lemonade, small, "2.20");
    await setVariantPrice(f.lunch, f.lemonade, f.large, live);
    await publish(f.lunch);
    const stored = await storedPrices(f.lunch, f.lemonade);
    await setVariantPrice(f.lunch, f.lemonade, f.large, now);
    await app((tx) => updateMenuDetails(tx, f.lunch, { name: "Renamed" }));

    const command = await undoAndCheck(f.lunch, f.dinner, isOwnVariantsOf(f.lemonade));

    expect(command).toEqual({
      method: "setMenuVariantPrice",
      menuId: f.lunch,
      menuItemId: await app((tx) => offerOf(tx, f.lunch, f.lemonade)),
      variantId: f.large,
      price: live,
      name: "Lemonade",
    });
    expect(await storedPrices(f.lunch, f.lemonade)).toEqual(stored);
  });

  it("offers nothing when two variants' prices changed", async () => {
    const f = await menusFixture(fx.db);
    const small = await addSmall(f);
    await publish(f.lunch);
    await setVariantPrice(f.lunch, f.lemonade, small, "2.20");
    await setVariantPrice(f.lunch, f.lemonade, f.large, "4.00");

    const { action } = await changeAndAction(
      await readPreview(f.lunch),
      isOwnVariantsOf(f.lemonade),
    );

    expect(action).toEqual({ kind: "none" });
  });

  it("leaves a variant that follows the dish's price to the dish's Undo", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => setProductVariants(tx, f.lemonade, [large(f, null)], "en"));
    await publish(f.lunch);
    await setDishPrice(f.lunch, f.lemonade, "3.30");
    await app((tx) => updateMenuDetails(tx, f.lunch, { name: "Renamed" }));
    const before = await readPreview(f.lunch);
    const variants = await changeAndAction(before, isOwnVariantsOf(f.lemonade));
    expect(variants.action).toEqual({ kind: "none" });
    const price = await changeAndAction(before, isPriceOf(f.lemonade));

    await app((tx) => run(tx, commandOf(price.action)));

    const after = await readPreview(f.lunch);
    const gone = new Set([variants.change.id, price.change.id]);
    expect(after.changes).toEqual(before.changes.filter(({ id }) => !gone.has(id)));
    expect(after.changes.length).toBeGreaterThan(0);
  });

  it("offers nothing for one variant's price when another moved with the dish's price", async () => {
    const f = await menusFixture(fx.db);
    const small = await addSmall(f, null);
    await setVariantPrice(f.lunch, f.lemonade, small, "2.20");
    await publish(f.lunch);
    await setDishPrice(f.lunch, f.lemonade, "3.30");
    await setVariantPrice(f.lunch, f.lemonade, small, "2.40");

    const { action } = await changeAndAction(
      await readPreview(f.lunch),
      isOwnVariantsOf(f.lemonade),
    );

    expect(action).toEqual({ kind: "none" });
  });

  it("offers nothing for a variant that had no price here while the dish's price moved", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => setProductVariants(tx, f.lemonade, [large(f, null)], "en"));
    await publish(f.lunch);
    await setDishPrice(f.lunch, f.lemonade, "3.30");
    await setVariantPrice(f.lunch, f.lemonade, f.large, "4.00");

    const { action } = await changeAndAction(
      await readPreview(f.lunch),
      isOwnVariantsOf(f.lemonade),
    );

    expect(action).toEqual({ kind: "none" });
  });

  it.each<{
    probe: string;
    setUp?: (f: MenusFixture) => Promise<unknown>;
    move: (f: MenusFixture) => Promise<unknown>;
  }>([
    {
      probe: "the product's own Large price",
      move: (f) => app((tx) => setProductVariants(tx, f.lemonade, [large(f, "3.75")], "en")),
    },
    {
      probe: "the product price Large follows through a dish Lunch sets no price for",
      setUp: async (f) => {
        await app((tx) => setProductVariants(tx, f.lemonade, [large(f, null)], "en"));
        await setDishPrice(f.lunch, f.lemonade, null);
      },
      move: (f) => app((tx) => updateProduct(tx, f.lemonade, { unitPrice: "3.20" })),
    },
    {
      probe: "Drinks' own price for Large",
      setUp: (f) => setVariantPrice(f.drinksMenu, f.lemonade, f.large, "3.90"),
      move: (f) => setVariantPrice(f.drinksMenu, f.lemonade, f.large, "4.10"),
    },
  ])(
    "offers nothing for a variant that had no price here when $probe moved too",
    async ({ setUp, move }) => {
      const f = await menusFixture(fx.db);
      await setUp?.(f);
      await publish(f.lunch);
      await setVariantPrice(f.lunch, f.lemonade, f.large, "4.00");
      await move(f);

      const { action } = await changeAndAction(
        await readPreview(f.lunch),
        isOwnVariantsOf(f.lemonade),
      );

      expect(action).toEqual({ kind: "none" });
    },
  );

  it("puts back a variant that follows Lunch's own dish price while the product's price moved", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => setProductVariants(tx, f.lemonade, [large(f, null)], "en"));
    await publish(f.lunch);
    const stored = await storedPrices(f.lunch, f.lemonade);
    await setVariantPrice(f.lunch, f.lemonade, f.large, "4.00");
    await app((tx) => updateProduct(tx, f.lemonade, { unitPrice: "3.20" }));
    await app((tx) => updateMenuDetails(tx, f.lunch, { name: "Renamed" }));

    const command = await undoAndCheck(f.lunch, f.dinner, isOwnVariantsOf(f.lemonade));

    expect(command).toMatchObject({
      method: "setMenuVariantPrice",
      variantId: f.large,
      price: null,
    });
    expect(await storedPrices(f.lunch, f.lemonade)).toEqual(stored);
  });

  it("puts back a variant with its own product price while the dish's price moved", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    const stored = await storedPrices(f.lunch, f.lemonade);
    await setDishPrice(f.lunch, f.lemonade, "3.30");
    await setVariantPrice(f.lunch, f.lemonade, f.large, "4.00");

    const command = await undoAndCheck(f.lunch, f.dinner, isOwnVariantsOf(f.lemonade));

    expect(command).toMatchObject({
      method: "setMenuVariantPrice",
      variantId: f.large,
      price: null,
    });
    expect(await storedPrices(f.lunch, f.lemonade)).toEqual({ ...stored, grossPrice: 330 });
  });

  it("is refused for a variant made Inactive since the preview was read", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await setVariantPrice(f.lunch, f.lemonade, f.large, "4.00");
    const { action } = await changeAndAction(
      await readPreview(f.lunch),
      isOwnVariantsOf(f.lemonade),
    );
    const command = commandOf(action);
    // The product editor refuses it while a published menu holds Large ...
    await expect(
      app((tx) =>
        setProductVariants(tx, f.lemonade, [{ ...large(f, "3.50"), active: false }], "en"),
      ),
    ).rejects.toMatchObject({ code: "product.on_live_menu" });
    // ... so these direct writes reach a state the product cannot reach without a race: Large
    // Inactive, and its menu rows gone.
    await fx.db.update(products).set({ active: false }).where(eq(products.id, f.large));
    await fx.db
      .delete(menuItemVariantOverrides)
      .where(eq(menuItemVariantOverrides.variantId, f.large));

    await expect(app((tx) => run(tx, command))).rejects.toMatchObject({
      code: "product.variant_not_found",
    });

    const after = (await readPreview(f.lunch)).changes;
    expect(after.filter(isOwnVariantsOf(f.lemonade))).toEqual([]);
    expect(after).toContainEqual(
      expect.objectContaining({
        kind: "product_changed",
        productId: f.lemonade,
        source: "shared_product",
        fields: expect.arrayContaining(["variants"]),
      }),
    );
  });
});
