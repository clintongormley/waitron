import { beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  addProductToMenu,
  listAvailableProducts,
  listMenuOffers,
  listProducts,
} from "./operations.js";
import { readProductEditor, saveProductEditor, type ProductEditorInput } from "./product-editor.js";
import { createUnit } from "./units.js";
import { seedVenue, useCatalogueDb } from "../test/fixtures.js";

// Active is whether the product exists for the venue, Available is "sold out for now".
// The till sells a product only when it is BOTH, and each state is written without touching the
// other — so every case below gives the two flags different values.
const fx = useCatalogueDb();
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

let locationId = "";
let catalogueId = "";
let productId = "";
let body: ProductEditorInput;

beforeEach(async () => {
  locationId = (await seedVenue(fx.db)).locationId;
  await run(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Deli" });
    catalogueId = menu.id;
    const unit = await createUnit(
      tx,
      { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
      "en",
    );
    body = {
      name: "Tortilla",
      customerName: null,
      ordering: "public",
      description: null,
      kitchenName: null,
      image: null,
      unitId: unit.id,
      unitPrice: "4.50",
      active: true,
      available: true,
      vatClass: "reduced",
      variants: [],
      primaryCategoryId: null,
      modifiers: [],
      allergens: null,
      dietaryDeclarations: [],
      color: null,
    };
    productId = (await saveProductEditor(tx, null, menu.id, body, "en")).id;
    await addProductToMenu(tx, {
      menuId: menu.id,
      productId,
      grossPrice: "5.00",
    });
    await assignCatalogueToLocation(tx, locationId, menu.id);
  });
});

async function save(flags: { active: boolean; available: boolean }) {
  return run((tx) => saveProductEditor(tx, productId, catalogueId, { ...body, ...flags }, "en"));
}

/** What the editor, the product list, the menu's offers and the sellable list say of the one product. */
async function reads() {
  return run(async (tx) => {
    const editor = await readProductEditor(tx, productId);
    const [listed] = await listProducts(tx, catalogueId);
    return {
      editor: { active: editor.active, available: editor.available },
      listed: { active: listed!.active, available: listed!.available },
      offers: (await listMenuOffers(tx, [catalogueId])).map((offer) => offer.productId),
      sellable: (await listAvailableProducts(tx, locationId)).products.map((p) => p.id),
    };
  });
}

describe("Active and Available", () => {
  it("an Unavailable product stays Active and on listMenuOffers, and leaves listAvailableProducts", async () => {
    await save({ active: true, available: false });

    expect(await reads()).toEqual({
      editor: { active: true, available: false },
      listed: { active: true, available: false },
      offers: [productId],
      sellable: [],
    });
  });

  it("an Inactive product keeps its availability and leaves listMenuOffers and listAvailableProducts", async () => {
    await save({ active: false, available: true });

    expect(await reads()).toEqual({
      editor: { active: false, available: true },
      listed: { active: false, available: true },
      offers: [],
      sellable: [],
    });
  });

  it("making an Unavailable product Inactive leaves it Unavailable", async () => {
    await save({ active: true, available: false });
    await save({ active: false, available: false });

    expect((await reads()).editor).toEqual({ active: false, available: false });
  });

  it("an archived product refuses becoming Active and Available again or returning to a menu", async () => {
    await save({ active: true, available: false });
    await save({ active: false, available: false });
    await expect(save({ active: true, available: true })).rejects.toMatchObject({
      code: "product.archived",
      params: { productId },
    });
    const archived = {
      editor: { active: false, available: false },
      listed: { active: false, available: false },
      offers: [],
      sellable: [],
    };
    expect(await reads()).toEqual(archived);
    await expect(
      run((tx) => addProductToMenu(tx, { menuId: catalogueId, productId })),
    ).rejects.toMatchObject({ code: "menu_section.membership_invalid" });
    expect(await reads()).toEqual(archived);
  });

  it("a product created Unavailable is created Active", async () => {
    const created = await run((tx) =>
      saveProductEditor(
        tx,
        null,
        catalogueId,
        { ...body, name: "Croqueta", available: false },
        "en",
      ),
    );

    expect({ active: created.active, available: created.available }).toEqual({
      active: true,
      available: false,
    });
  });

  // Every Active, Available product on a menu is offered to the till, whatever its ordering: the
  // offer carries the setting, and the till and the order path act on it.
  it("offers an Active, Available product the till whatever its ordering, and says which", async () => {
    for (const ordering of ["public", "staff_only", "not_sold_separately"] as const) {
      await run((tx) => saveProductEditor(tx, productId, catalogueId, { ...body, ordering }, "en"));
      const offers = await run((tx) => listMenuOffers(tx, [catalogueId]));
      expect(offers.map((offer) => offer.ordering)).toEqual([ordering]);
      expect(offers.map((offer) => offer.productId)).toEqual([productId]);
    }
  });
});
