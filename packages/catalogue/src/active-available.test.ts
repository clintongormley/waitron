import { beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createMenuItem,
  createMenuSection,
  listAvailableProducts,
  listMenuOffers,
  listProducts,
} from "./operations.js";
import { readProductEditor, saveProductEditor, type ProductEditorInput } from "./product-editor.js";
import { createUnit } from "./units.js";
import { seedVenue, useCatalogueDb } from "../test/fixtures.js";

// Spec §15.6: Active is whether the product exists for the venue, Available is "sold out for now".
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
      soldAlone: true,
      description: null,
      kitchenName: null,
      image: null,
      unitId: unit.id,
      unitPrice: "4.50",
      active: true,
      available: true,
      vatClass: "reduced",
      variants: [],
      categoryIds: [],
      primaryCategoryId: null,
      modifiers: [],
      allergens: null,
      dietaryDeclarations: [],
    };
    productId = (await saveProductEditor(tx, null, menu.id, body, "en")).id;
    const section = await createMenuSection(tx, { menuId: menu.id, name: { en: "Tapas" } });
    await createMenuItem(tx, {
      menuId: menu.id,
      productId,
      sectionId: section.id,
      grossPrice: "5.00",
    });
    await assignCatalogueToLocation(tx, locationId, menu.id);
  });
});

async function save(flags: { active: boolean; available: boolean }) {
  return run((tx) => saveProductEditor(tx, productId, catalogueId, { ...body, ...flags }, "en"));
}

/** What the till would be offered, and what the dashboard lists and manages, for the one product. */
async function reads() {
  return run(async (tx) => {
    const editor = await readProductEditor(tx, productId);
    const [listed] = await listProducts(tx, catalogueId);
    return {
      editor: { active: editor.active, available: editor.available },
      listed: { active: listed!.active, available: listed!.available },
      offers: (await listMenuOffers(tx, [catalogueId])).map((offer) => offer.productId),
      managed: (await listMenuOffers(tx, [catalogueId], { includeUnavailable: true })).map(
        (offer) => offer.productId,
      ),
      sellable: (await listAvailableProducts(tx, locationId)).products.map((p) => p.id),
    };
  });
}

describe("Active and Available", () => {
  it("an Unavailable product stays Active, leaves listMenuOffers and listAvailableProducts and stays managed", async () => {
    await save({ active: true, available: false });

    expect(await reads()).toEqual({
      editor: { active: true, available: false },
      listed: { active: true, available: false },
      offers: [],
      managed: [productId],
      sellable: [],
    });
  });

  it("an Inactive product keeps its availability and leaves listMenuOffers and listAvailableProducts", async () => {
    await save({ active: false, available: true });

    expect(await reads()).toEqual({
      editor: { active: false, available: true },
      listed: { active: false, available: true },
      offers: [],
      managed: [],
      sellable: [],
    });
  });

  it("making an Unavailable product Inactive leaves it Unavailable", async () => {
    await save({ active: true, available: false });
    await save({ active: false, available: false });

    expect((await reads()).editor).toEqual({ active: false, available: false });
  });

  it("a product that is both Active and Available is sold again", async () => {
    await save({ active: false, available: false });
    await save({ active: true, available: true });

    expect(await reads()).toEqual({
      editor: { active: true, available: true },
      listed: { active: true, available: true },
      offers: [productId],
      managed: [productId],
      sellable: [productId],
    });
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

  // Spec §15.4: every Active, Available product on a menu is offered to the till, sold alone or not.
  it("offers an Active, Available product the till whether or not it is sold alone", async () => {
    for (const soldAlone of [true, false]) {
      await run((tx) =>
        saveProductEditor(tx, productId, catalogueId, { ...body, soldAlone }, "en"),
      );
      const offers = await run((tx) => listMenuOffers(tx, [catalogueId]));
      expect(offers.map((offer) => offer.productId)).toEqual([productId]);
    }
  });
});
