import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, offerOf, product, section } from "../test/menus-fixture.js";
import { createCategory } from "./categories.js";
import { deleteCatalogueItems } from "./catalogue-items.js";
import { addShortcut, readMenuHome } from "./menu-home.js";
import { menuStatus, previewMenu, publishMenu } from "./menu-publication.js";
import { menusHolding, takeOffMenus } from "./menu-removal.js";
import { readMenuStructure } from "./menu-structure.js";
import {
  createCatalogue,
  createProduct,
  deactivateCatalogue,
  deactivateProduct,
  listMenuOffers,
  menuPrices,
  updateMenuItem,
  updateProduct,
} from "./operations.js";
import { readProductEditor, saveProductEditor } from "./product-editor.js";
import { menuItems } from "./schema/menu.js";
import { sectionMembers } from "./schema/sections.js";
import { menuItemVariantOverrides } from "./schema/variant-overrides.js";
import { addMember, addProducts, createSectionIn, replaceMember } from "./sections.js";
import { listProductVariants, setMenuVariantPrice, setProductVariants } from "./variants.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

async function codeOf(fn: () => Promise<unknown>): Promise<unknown> {
  return ((await captureError(fn)) as { code?: unknown }).code;
}

/**
 * Tapas places Tortilla twice: in its root and in its Fried list. Terrace reaches it through a list
 * nested two deep. Croquetas sits beside it in every one of those lists. Both products carry a menu
 * price and a variant price on both menus, and Tortilla is a shortcut on Tapas' Device Home Page.
 */
async function removalFixture() {
  await menusFixture(fx.db);
  return app(async (tx) => {
    const tapasFolder = (await createCategory(tx, { name: "Tapas" })).id;
    const tapas = (await createCatalogue(tx, { name: "Tapas" })).id;
    const terrace = (await createCatalogue(tx, { name: "Terrace" })).id;
    const make = async (name: string) =>
      (
        await createProduct(tx, {
          catalogueId: tapas,
          categoryId: tapasFolder,
          name,
          pricingUnit: "each",
          unitPrice: "4.00",
          vatClass: "reduced",
          allergens: {},
        })
      ).id;
    const tortilla = await make("Tortilla");
    const croquetas = await make("Croquetas");
    const half = async (productId: string) =>
      (
        await setProductVariants(
          tx,
          productId,
          [
            {
              name: "Half",
              customerName: null,
              kitchenName: null,
              image: null,
              unitPrice: "2.50",
              available: true,
            },
          ],
          "en",
        )
      )[0]!.id;
    const tortillaHalf = await half(tortilla);
    const croquetasHalf = await half(croquetas);

    const tapasRoot = (await readMenuStructure(tx, tapas)).rootSectionId;
    const terraceRoot = (await readMenuStructure(tx, terrace)).rootSectionId;
    await addMember(tx, tapasRoot, product(croquetas));
    await addMember(tx, tapasRoot, product(tortilla));
    const fried = (await createSectionIn(tx, tapasRoot, { internalName: "Fried" })).id;
    await addMember(tx, fried, product(tortilla));
    await addMember(tx, fried, product(croquetas));
    const starters = (await createSectionIn(tx, terraceRoot, { internalName: "Starters" })).id;
    const cold = (await createSectionIn(tx, starters, { internalName: "Cold" })).id;
    await addMember(tx, cold, product(tortilla));
    await addMember(tx, cold, product(croquetas));

    for (const menuId of [tapas, terrace])
      for (const [productId, variantId] of [
        [tortilla, tortillaHalf],
        [croquetas, croquetasHalf],
      ] as const) {
        const offer = await offerOf(tx, menuId, productId);
        await updateMenuItem(tx, menuId, offer, { grossPrice: "5.00" });
        await setMenuVariantPrice(tx, offer, variantId, "3.00", menuId);
      }
    await addShortcut(tx, tapas, product(croquetas));
    await addShortcut(tx, tapas, product(tortilla));
    await addShortcut(tx, tapas, section(fried));
    return {
      tapasFolder,
      tapas,
      terrace,
      tapasRoot,
      fried,
      cold,
      tortilla,
      croquetas,
      tortillaHalf,
      croquetasHalf,
    };
  });
}

type Removal = Awaited<ReturnType<typeof removalFixture>>;

async function publish(menuId: string) {
  const { hash } = await app((tx) => previewMenu(tx, menuId));
  await app((tx) => publishMenu(tx, menuId, hash, "person-1"));
}

async function states(menuIds: readonly string[]) {
  const status = await app((tx) => menuStatus(tx, menuIds));
  return menuIds.map((menuId) => status.get(menuId)!.state);
}

async function memberRowsNaming(productId: string) {
  return fx.db.select().from(sectionMembers).where(eq(sectionMembers.productId, productId));
}

async function listProducts(sectionId: string) {
  const rows = await fx.db
    .select()
    .from(sectionMembers)
    .where(eq(sectionMembers.sectionId, sectionId));
  return rows
    .sort((a, b) => a.position - b.position)
    .map((row) => ({ position: row.position, productId: row.productId }));
}

/** The product's price row on the menu and how many variant price rows hang off it. */
async function offerSettings(menuId: string, productId: string) {
  const [row] = await fx.db
    .select({ id: menuItems.id, grossPrice: menuItems.grossPrice })
    .from(menuItems)
    .where(and(eq(menuItems.menuId, menuId), eq(menuItems.productId, productId)));
  const overrides = await fx.db
    .select()
    .from(menuItemVariantOverrides)
    .where(inArray(menuItemVariantOverrides.menuItemId, [row!.id]));
  return { grossPrice: row!.grossPrice, variantPrices: overrides.length };
}

async function expectOffEveryMenu(r: Removal, productId: string) {
  expect(await memberRowsNaming(productId)).toEqual([]);
  for (const menuId of [r.tapas, r.terrace])
    expect(await offerSettings(menuId, productId)).toEqual({ grossPrice: null, variantPrices: 0 });
}

async function expectStillOnEveryMenu(r: Removal, productId: string) {
  expect(await memberRowsNaming(productId)).toHaveLength(4);
  for (const menuId of [r.tapas, r.terrace])
    expect(await offerSettings(menuId, productId)).toEqual({ grossPrice: 500, variantPrices: 1 });
}

describe("a product made Inactive comes off every menu", () => {
  it("through updateProduct: no list names it, each menu's price row is cleared, both published menus read changed, and the product beside it keeps its place and prices", async () => {
    const r = await removalFixture();
    await publish(r.tapas);
    await publish(r.terrace);
    expect(await states([r.tapas, r.terrace])).toEqual(["current", "current"]);

    await app((tx) => updateProduct(tx, r.tortilla, { active: false }));

    await expectOffEveryMenu(r, r.tortilla);
    expect(await states([r.tapas, r.terrace])).toEqual(["changed", "changed"]);
    await expectStillOnEveryMenu(r, r.croquetas);
    expect(await listProducts(r.tapasRoot)).toEqual([
      { position: 0, productId: r.croquetas },
      { position: 1, productId: null },
    ]);
    expect(await listProducts(r.fried)).toEqual([{ position: 0, productId: r.croquetas }]);
    expect(await listProducts(r.cold)).toEqual([{ position: 0, productId: r.croquetas }]);
  });

  it("is not put back on any menu when made Active again", async () => {
    const r = await removalFixture();
    await app((tx) => updateProduct(tx, r.tortilla, { active: false }));
    await app((tx) => updateProduct(tx, r.tortilla, { active: true }));
    await expectOffEveryMenu(r, r.tortilla);
  });

  it("through deactivateProduct", async () => {
    const r = await removalFixture();
    await app((tx) => deactivateProduct(tx, r.tortilla));
    await expectOffEveryMenu(r, r.tortilla);
    await expectStillOnEveryMenu(r, r.croquetas);
  });

  it("through the product editor's save with active false", async () => {
    const r = await removalFixture();
    await app(async (tx) => {
      const value = await readProductEditor(tx, r.tortilla);
      await saveProductEditor(tx, r.tortilla, r.tapas, { ...value, active: false }, "en");
    });
    await expectOffEveryMenu(r, r.tortilla);
    await expectStillOnEveryMenu(r, r.croquetas);
  });

  it("for every product one Disable of a product selection names", async () => {
    const r = await removalFixture();
    await app((tx) =>
      deleteCatalogueItems(
        tx,
        { productIds: [r.tortilla, r.croquetas], categoryIds: [] },
        "delete",
      ),
    );
    await expectOffEveryMenu(r, r.tortilla);
    await expectOffEveryMenu(r, r.croquetas);
    expect(await listProducts(r.tapasRoot)).toEqual([{ position: 0, productId: null }]);
  });

  it("for a product disabled beside a folder deleted with its contents moved up", async () => {
    const r = await removalFixture();
    await app((tx) =>
      deleteCatalogueItems(
        tx,
        { productIds: [r.tortilla], categoryIds: [r.tapasFolder] },
        "move_up",
      ),
    );
    await expectOffEveryMenu(r, r.tortilla);
    await expectStillOnEveryMenu(r, r.croquetas);
  });

  it("for every product in a folder deleted with its contents", async () => {
    const r = await removalFixture();
    await app((tx) =>
      deleteCatalogueItems(tx, { productIds: [], categoryIds: [r.tapasFolder] }, "delete"),
    );
    await expectOffEveryMenu(r, r.tortilla);
    await expectOffEveryMenu(r, r.croquetas);
  });

  it("from a menu that includes the list holding it, which then reads changed", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await publish(f.dinner);
    await app((tx) => updateProduct(tx, f.lemonade, { active: false }));
    expect(await memberRowsNaming(f.lemonade)).toEqual([]);
    const [lunchRow] = await fx.db
      .select({ grossPrice: menuItems.grossPrice })
      .from(menuItems)
      .where(and(eq(menuItems.menuId, f.lunch), eq(menuItems.productId, f.lemonade)));
    expect(lunchRow).toEqual({ grossPrice: null });
    expect(await states([f.lunch, f.dinner])).toEqual(["changed", "changed"]);
  });

  it("leaves a missing tile, named with the product's name, where its Device Home Page shortcut was", async () => {
    const r = await removalFixture();
    await app((tx) => updateProduct(tx, r.tortilla, { active: false }));
    const home = await app((tx) => readMenuHome(tx, r.tapas));
    expect(home.shortcuts.map(({ position, ref }) => ({ position, ref }))).toEqual([
      { position: 0, ref: product(r.croquetas) },
      { position: 1, ref: { kind: "missing", name: "Tortilla" } },
      { position: 2, ref: section(r.fried) },
    ]);
  });
});

describe("takeOffMenus", () => {
  it("writes nothing for a product on no list, and every menu keeps its status", async () => {
    const r = await removalFixture();
    await publish(r.tapas);
    await publish(r.terrace);
    const loose = await app(
      async (tx) =>
        (
          await createProduct(tx, {
            catalogueId: r.tapas,
            categoryId: null,
            name: "Gazpacho",
            pricingUnit: "each",
            unitPrice: "4.00",
            vatClass: "reduced",
            allergens: {},
          })
        ).id,
    );
    const snapshot = async () => ({
      members: await fx.db.select().from(sectionMembers).orderBy(sectionMembers.id),
      offers: await fx.db.select().from(menuItems).orderBy(menuItems.id),
      variantPrices: await fx.db
        .select()
        .from(menuItemVariantOverrides)
        .orderBy(menuItemVariantOverrides.menuItemId, menuItemVariantOverrides.variantId),
    });
    const before = await snapshot();

    await app((tx) => takeOffMenus(tx, [loose]));

    expect(await snapshot()).toEqual(before);
    expect(await states([r.tapas, r.terrace])).toEqual(["current", "current"]);
  });
});

describe("an Inactive product cannot be added to a menu list", () => {
  async function inactive(r: Removal): Promise<string> {
    return app(async (tx) => {
      const { id } = await createProduct(tx, {
        catalogueId: r.tapas,
        categoryId: null,
        name: "Gazpacho",
        pricingUnit: "each",
        unitPrice: "4.00",
        vatClass: "reduced",
        allergens: {},
      });
      await deactivateProduct(tx, id);
      return id;
    });
  }

  it("by addProducts", async () => {
    const r = await removalFixture();
    const gazpacho = await inactive(r);
    expect(await codeOf(() => app((tx) => addProducts(tx, r.cold, [gazpacho])))).toBe(
      "menu_section.membership_invalid",
    );
    expect(await memberRowsNaming(gazpacho)).toEqual([]);
  });

  it("by addMember", async () => {
    const r = await removalFixture();
    const gazpacho = await inactive(r);
    expect(await codeOf(() => app((tx) => addMember(tx, r.cold, product(gazpacho))))).toBe(
      "menu_section.membership_invalid",
    );
    expect(await memberRowsNaming(gazpacho)).toEqual([]);
  });

  it("by replaceMember", async () => {
    const r = await removalFixture();
    const gazpacho = await inactive(r);
    const [held] = await fx.db
      .select({ id: sectionMembers.id })
      .from(sectionMembers)
      .where(and(eq(sectionMembers.sectionId, r.cold), eq(sectionMembers.productId, r.tortilla)));
    expect(
      await codeOf(() => app((tx) => replaceMember(tx, r.cold, held!.id, product(gazpacho)))),
    ).toBe("menu_section.membership_invalid");
    expect(await memberRowsNaming(gazpacho)).toEqual([]);
  });

  it("and one a list holds anyway, written past the refusing writers, is left out of the menu's offers and prices", async () => {
    const r = await removalFixture();
    const gazpacho = await inactive(r);
    await fx.db
      .insert(sectionMembers)
      .values({ sectionId: r.cold, position: 2, productId: gazpacho });
    await fx.db
      .insert(menuItems)
      .values({ menuId: r.terrace, productId: gazpacho, grossPrice: 450 });

    const offered = await app((tx) => listMenuOffers(tx, [r.terrace]));
    expect(offered.map((offer) => offer.productId)).toEqual([r.tortilla, r.croquetas]);
    const priced = await app((tx) => menuPrices(tx, r.terrace));
    expect(priced.map((row) => row.productId)).toEqual([r.tortilla, r.croquetas]);
  });
});

/**
 * {@link removalFixture} with a second size of Tortilla, Whole, priced on both menus beside Half:
 * every size of both products then holds a price row on Tapas and on Terrace.
 */
async function variantFixture() {
  const r = await removalFixture();
  const tortillaWhole = await app(async (tx) => {
    const [half] = await listProductVariants(tx, r.tortilla);
    const whole = (
      await setProductVariants(
        tx,
        r.tortilla,
        [
          half!,
          {
            name: "Whole",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "7.00",
            available: true,
          },
        ],
        "en",
      )
    )[1]!.id;
    for (const menuId of [r.tapas, r.terrace])
      await setMenuVariantPrice(tx, await offerOf(tx, menuId, r.tortilla), whole, "6.00", menuId);
    return whole;
  });
  return { ...r, tortillaWhole };
}

type VariantRemoval = Awaited<ReturnType<typeof variantFixture>>;

/** The menus holding a price row for the variant, in menu-id order. */
async function menusPricing(variantId: string): Promise<string[]> {
  const rows = await fx.db
    .select({ menuId: menuItems.menuId })
    .from(menuItemVariantOverrides)
    .innerJoin(menuItems, eq(menuItems.id, menuItemVariantOverrides.menuItemId))
    .where(eq(menuItemVariantOverrides.variantId, variantId));
  return rows.map((row) => row.menuId).sort();
}

const bothMenus = (r: VariantRemoval) => [r.tapas, r.terrace].sort();

describe("a variant made Inactive loses its price on every menu", () => {
  const ways: [string, (r: VariantRemoval) => Promise<unknown>][] = [
    [
      "through its own editor save",
      (r) =>
        app(async (tx) => {
          const value = await readProductEditor(tx, r.tortillaHalf);
          await saveProductEditor(tx, r.tortillaHalf, r.tapas, { ...value, active: false }, "en");
        }),
    ],
    [
      "through its product's editor save sending it Inactive",
      (r) =>
        app(async (tx) => {
          const value = await readProductEditor(tx, r.tortilla);
          const variants = value.variants.map((variant) =>
            variant.id === r.tortillaHalf ? { ...variant, active: false } : variant,
          );
          await saveProductEditor(tx, r.tortilla, r.tapas, { ...value, variants }, "en");
        }),
    ],
    [
      "through setProductVariants leaving it out",
      (r) =>
        app(async (tx) => {
          const whole = (await listProductVariants(tx, r.tortilla)).find(
            (variant) => variant.id === r.tortillaWhole,
          );
          await setProductVariants(tx, r.tortilla, [whole!], "en");
        }),
    ],
  ];

  it.each(ways)(
    "%s: both its rows go, every other size keeps its own, and both published menus read changed",
    async (_, makeInactive) => {
      const r = await variantFixture();
      expect(await menusPricing(r.tortillaHalf)).toEqual(bothMenus(r));
      await publish(r.tapas);
      await publish(r.terrace);
      expect(await states([r.tapas, r.terrace])).toEqual(["current", "current"]);

      await makeInactive(r);

      expect(await menusPricing(r.tortillaHalf)).toEqual([]);
      expect(await menusPricing(r.tortillaWhole)).toEqual(bothMenus(r));
      expect(await menusPricing(r.croquetasHalf)).toEqual(bothMenus(r));
      expect(await memberRowsNaming(r.tortilla)).toHaveLength(4);
      expect(await states([r.tapas, r.terrace])).toEqual(["changed", "changed"]);
    },
  );

  it("is left out of each menu's prices, and comes back to both, with no price of its own, when made Active again", async () => {
    const r = await variantFixture();
    const sizesPriced = async (menuId: string) =>
      (await app((tx) => menuPrices(tx, menuId)))
        .find((row) => row.productId === r.tortilla)!
        .variants.map(({ variantId, price, active }) => ({ variantId, price, active }));
    const sizesOffered = async (menuId: string) =>
      (await app((tx) => listMenuOffers(tx, [menuId])))
        .find((offer) => offer.productId === r.tortilla)!
        .variants.map(({ id, menuPrice }) => ({ id, menuPrice }));
    await app(async (tx) => {
      const whole = (await listProductVariants(tx, r.tortilla)).find(
        (variant) => variant.id === r.tortillaWhole,
      );
      await setProductVariants(tx, r.tortilla, [whole!], "en");
    });
    for (const menuId of [r.tapas, r.terrace]) {
      expect(await sizesPriced(menuId)).toEqual([
        { variantId: r.tortillaWhole, price: "6.00", active: true },
      ]);
      expect(await sizesOffered(menuId)).toEqual([{ id: r.tortillaWhole, menuPrice: "6.00" }]);
    }

    await app(async (tx) => {
      const variants = await listProductVariants(tx, r.tortilla);
      await setProductVariants(
        tx,
        r.tortilla,
        variants.map((variant) => ({ ...variant, active: true })),
        "en",
      );
    });

    for (const menuId of [r.tapas, r.terrace]) {
      expect(await sizesPriced(menuId)).toEqual([
        { variantId: r.tortillaWhole, price: "6.00", active: true },
        { variantId: r.tortillaHalf, price: null, active: true },
      ]);
      expect(await sizesOffered(menuId)).toEqual([
        { id: r.tortillaWhole, menuPrice: "6.00" },
        { id: r.tortillaHalf, menuPrice: null },
      ]);
    }
  });

  it("cannot be given a menu price by setMenuVariantPrice", async () => {
    const r = await variantFixture();
    await app((tx) => updateProduct(tx, r.tortillaHalf, { active: false }));
    const offer = await app((tx) => offerOf(tx, r.tapas, r.tortilla));
    expect(
      await codeOf(() =>
        app((tx) => setMenuVariantPrice(tx, offer, r.tortillaHalf, "3.20", r.tapas)),
      ),
    ).toBe("product.variant_not_found");
    expect(await menusPricing(r.tortillaHalf)).toEqual([]);
  });
});

describe("menusHolding", () => {
  it("counts each active menu whose structure reaches the products once, an including menu too, and a variant by its product", async () => {
    const f = await menusFixture(fx.db);
    const count = (ids: string[]) => app((tx) => menusHolding(tx, ids));
    // Lemonade sits in the Drinks menu's root, which Lunch and Dinner both include.
    expect(await count([f.lemonade])).toBe(3);
    expect(await count([f.large])).toBe(3);
    expect(await count([f.lemonade, f.lager, f.large])).toBe(3);
    expect(await count([f.burger])).toBe(1);
    expect(await count([f.soup, f.burger])).toBe(2);
    expect(await count([f.extraLemon])).toBe(0);
    expect(await count([])).toBe(0);

    await app((tx) => deactivateCatalogue(tx, f.dinner));
    expect(await count([f.lemonade])).toBe(2);
    expect(await count([f.burger])).toBe(0);
  });

  it("does not count a menu whose Device Home Page alone holds the product", async () => {
    const r = await removalFixture();
    const gazpacho = await app(async (tx) => {
      const id = (
        await createProduct(tx, {
          catalogueId: r.tapas,
          categoryId: null,
          name: "Gazpacho",
          pricingUnit: "each",
          unitPrice: "4.00",
          vatClass: "reduced",
          allergens: {},
        })
      ).id;
      await tx.insert(sectionMembers).values({
        id: crypto.randomUUID(),
        sectionId: (await readMenuHome(tx, r.tapas)).homeSectionId,
        position: 9,
        productId: id,
      });
      return id;
    });
    expect(await app((tx) => menusHolding(tx, [gazpacho]))).toBe(0);
    expect(await app((tx) => menusHolding(tx, [r.tortilla, gazpacho]))).toBe(2);
  });
});
