import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { menuItems, withTransaction, type Transaction } from "@waitron/db";
import { seedPerson, seedTaxpayer, seedVenueSettings } from "@waitron/db/testing/seed.js";
import { useMenuDb } from "../test/fixtures.js";
import { saveBodyOf } from "../test/save-body.js";
import { deleteMenu } from "./delete.js";
import type { MenuOffer } from "@waitron/shared";
import { clashesOf } from "./menu-combine.js";
import { buildMenuDocument, documentOffers } from "./menu-document.js";
import { requireMenuRoot } from "./menu-structure.js";
import {
  addProductToMenu,
  createMenu,
  createProduct,
  listMenuOffers,
  menuPrices,
  updateMenuItem,
} from "./operations.js";
import { readProductEditor, saveProductEditor } from "./product-editor.js";
import { addMember } from "./sections.js";
import { addSetMenuDishes, readSetMenu } from "./set-menus.js";
import { setProductVariants } from "./variants.js";

/** A menu's own price on a product sold through its Active variants: ordinary menus hold none. */
const suite = useMenuDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);

const glass = {
  name: "Glass",
  customerName: null,
  kitchenName: null,
  image: null,
  unitPrice: "4.00",
  available: true,
};

async function fixture(tx: Transaction) {
  const lunch = await createMenu(tx, { name: "Lunch" });
  const dinner = await createMenu(tx, { name: "Dinner" });
  const daily = await createMenu(tx, { name: "Daily", kind: "set_menu", setPrice: "14.00" });
  const product = (name: string) =>
    createProduct(tx, {
      name,
      categoryId: null,
      unitId: null,
      unitPrice: "8.00",
      vatClass: "reduced",
    });
  const wine = await product("Wine");
  const cider = await product("Cider");
  const lunchWine = await addProductToMenu(tx, {
    menuId: lunch.id,
    productId: wine.id,
    grossPrice: "9.00",
  });
  const dinnerWine = await addProductToMenu(tx, {
    menuId: dinner.id,
    productId: wine.id,
    grossPrice: "9.50",
  });
  await addSetMenuDishes(tx, daily.id, [{ productId: wine.id, excludedVariantIds: [] }]);
  const [dish] = (await readSetMenu(tx, daily.id)).dishes;
  await updateMenuItem(tx, daily.id, dish!.menuItemId, { grossPrice: "1.50" });
  return {
    lunch: lunch.id,
    dinner: dinner.id,
    daily: daily.id,
    wine: wine.id,
    cider: cider.id,
    lunchWine: lunchWine.id,
    dinnerWine: dinnerWine.id,
    dailyWine: dish!.menuItemId,
  };
}

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  await seedTaxpayer(suite.db);
  await seedVenueSettings(suite.db);
  await seedPerson(suite.db, { id: "person-1", displayName: "Test person-1" });
  f = await app(fixture);
});

/** The stored `gross_price`, in whole cents, of `productId` on `menuId`; undefined with no row. */
async function stored(menuId: string, productId: string): Promise<number | null | undefined> {
  const [row] = await suite.db
    .select({ grossPrice: menuItems.grossPrice })
    .from(menuItems)
    .where(and(eq(menuItems.menuId, menuId), eq(menuItems.productId, productId)));
  return row?.grossPrice;
}

const addGlassInEditor = (productId: string) =>
  app(async (tx) => {
    const value = await readProductEditor(tx, productId);
    await saveProductEditor(
      tx,
      productId,
      { ...saveBodyOf(value), variants: [{ ...glass, active: true }] },
      "en",
    );
  });

describe("the menu price writers", () => {
  it("refuse a price on an ordinary menu for a product with variants, and store nothing", async () => {
    await app((tx) => setProductVariants(tx, f.wine, [glass], "en"));
    await expect(
      app((tx) => updateMenuItem(tx, f.lunch, f.lunchWine, { grossPrice: "7.00" })),
    ).rejects.toMatchObject({
      code: "menu_item.has_variants",
      params: { menuItemId: f.lunchWine },
    });
    expect(await stored(f.lunch, f.wine)).toBeNull();

    const other = await app((tx) => createMenu(tx, { name: "Terrace" }));
    await expect(
      app((tx) =>
        addProductToMenu(tx, { menuId: other.id, productId: f.wine, grossPrice: "7.00" }),
      ),
    ).rejects.toMatchObject({ code: "menu_item.has_variants" });
    expect(await stored(other.id, f.wine)).toBeUndefined();
  });

  it("accept no price for a product with variants", async () => {
    await app((tx) => setProductVariants(tx, f.wine, [glass], "en"));
    await app((tx) => updateMenuItem(tx, f.lunch, f.lunchWine, { grossPrice: null }));
    const other = await app((tx) => createMenu(tx, { name: "Terrace" }));
    await expect(
      app((tx) => addProductToMenu(tx, { menuId: other.id, productId: f.wine, grossPrice: null })),
    ).resolves.toMatchObject({ productId: f.wine, grossPrice: null });
    expect(await stored(f.lunch, f.wine)).toBeNull();
  });

  it("save a set menu's supplement on a dish with variants", async () => {
    await app((tx) => setProductVariants(tx, f.wine, [glass], "en"));
    await app((tx) => updateMenuItem(tx, f.daily, f.dailyWine, { grossPrice: "2.00" }));
    expect(await stored(f.daily, f.wine)).toBe(200);
  });

  it("still price a product without variants on an ordinary menu", async () => {
    await app((tx) => setProductVariants(tx, f.wine, [glass], "en"));
    const offer = await app((tx) =>
      addProductToMenu(tx, { menuId: f.lunch, productId: f.cider, grossPrice: "7.00" }),
    );
    expect(offer.grossPrice).toBe("7.00");
  });
});

describe("a product's first variant", () => {
  it("takes its price off every ordinary menu, deleted ones included, and keeps the set menu's supplement", async () => {
    await app((tx) => deleteMenu(tx, f.dinner, "person-1"));
    expect(await stored(f.dinner, f.wine)).toBe(950);

    await addGlassInEditor(f.wine);

    expect(await stored(f.lunch, f.wine)).toBeNull();
    expect(await stored(f.dinner, f.wine)).toBeNull();
    expect(await stored(f.daily, f.wine)).toBe(150);
  });

  it("does not bring the price back when the variants go", async () => {
    await addGlassInEditor(f.wine);
    await app(async (tx) => {
      const value = await readProductEditor(tx, f.wine);
      await saveProductEditor(tx, f.wine, { ...saveBodyOf(value), variants: [] }, "en");
    });
    expect(await stored(f.lunch, f.wine)).toBeNull();
  });
});

describe("a menu price stored on a product with variants by hand", () => {
  /** Wine gains a Glass with no price of its own, then Lunch's 9.00 is written straight into the
   * table, past the writers that refuse it. */
  const storeByHand = async () => {
    await app((tx) => setProductVariants(tx, f.wine, [{ ...glass, unitPrice: null }], "en"));
    await suite.db.update(menuItems).set({ grossPrice: 900 }).where(eq(menuItems.id, f.lunchWine));
  };
  const priced = (offers: readonly MenuOffer[]) =>
    offers
      .filter((offer) => offer.productId === f.wine)
      .map((offer) => ({
        grossPrice: offer.grossPrice,
        unitPrice: offer.unitPrice,
        variants: offer.variants.map((variant) => variant.unitPrice),
      }));
  const includes = (tx: Transaction, menuId: string, includedMenuId: string) =>
    requireMenuRoot(tx, includedMenuId).then(async (sectionId) =>
      addMember(tx, await requireMenuRoot(tx, menuId), { kind: "section", sectionId }),
    );

  it("is not offered, listed among the menu's prices or published", async () => {
    await storeByHand();
    expect(priced(await app((tx) => listMenuOffers(tx, [f.lunch])))).toEqual([
      { grossPrice: null, unitPrice: "8.00", variants: ["8.00"] },
    ]);
    const [row] = (await app((tx) => menuPrices(tx, f.lunch))).filter(
      (price) => price.productId === f.wine,
    );
    expect(row).toMatchObject({ override: null, effectivePrice: "8.00" });
    expect(row!.combined.variants[0]!.price).toMatchObject({ state: "decided", value: "8.00" });
    const { document } = await app((tx) => buildMenuDocument(tx, f.lunch));
    expect(
      documentOffers(document)
        .filter((offer) => offer.productId === f.wine)
        .map((offer) => ({
          grossPrice: offer.grossPrice,
          unitPrice: offer.unitPrice,
          variants: offer.variants.map((variant) => variant.unitPrice),
        })),
    ).toEqual([{ grossPrice: null, unitPrice: "8.00", variants: ["8.00"] }]);
  });

  it("reaches no menu that includes that menu, one or two levels up", async () => {
    await storeByHand();
    const terrace = await app((tx) => createMenu(tx, { name: "Terrace" }));
    const patio = await app((tx) => createMenu(tx, { name: "Patio" }));
    await app((tx) => includes(tx, terrace.id, f.lunch));
    await app((tx) => includes(tx, patio.id, terrace.id));
    for (const menuId of [terrace.id, patio.id]) {
      const offers = await app((tx) => listMenuOffers(tx, [menuId]));
      expect(priced(offers)).toEqual([{ grossPrice: null, unitPrice: "8.00", variants: ["8.00"] }]);
      expect(offers.flatMap((offer) => clashesOf(offer.combined))).toEqual([]);
    }
  });
});
