import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, offerOf, product, section } from "../test/menus-fixture.js";
import { createCategory } from "./categories.js";
import { deleteCatalogueItems } from "./catalogue-items.js";
import { addShortcut, readMenuHome } from "./menu-home.js";
import { menuStatus, previewMenu, publishMenu } from "./menu-publication.js";
import { takeOffMenus } from "./menu-removal.js";
import { readMenuStructure } from "./menu-structure.js";
import {
  createCatalogue,
  createProduct,
  deactivateProduct,
  updateMenuItem,
  updateProduct,
} from "./operations.js";
import { readProductEditor, saveProductEditor } from "./product-editor.js";
import { menuItems } from "./schema/menu.js";
import { sectionMembers } from "./schema/sections.js";
import { menuItemVariantOverrides } from "./schema/variant-overrides.js";
import { addMember, addProducts, createSectionIn, replaceMember } from "./sections.js";
import { setMenuVariantPrice, setProductVariants } from "./variants.js";

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
    return { tapasFolder, tapas, terrace, tapasRoot, fried, cold, tortilla, croquetas };
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
});
