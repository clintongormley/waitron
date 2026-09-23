import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createMenuItem,
  createMenuSection,
  createProduct,
  listAvailableProducts,
  listMenuOffers,
} from "./operations.js";
import { createExtraList, setMenuItemExtraLists, updateExtraList } from "./extras.js";
import { createOptionList, updateOptionList } from "./options.js";
import { writeProductModifiers } from "./product-modifiers.js";
import { readOfferedModifiers, resolveAttachedModifiers } from "./offered-modifiers.js";
import * as extraProjection from "./extra-projection.js";
import * as productModifiers from "./product-modifiers.js";
import * as optionsModule from "./options.js";
import { seedVenue } from "../test/fixtures.js";

/** The attachment walk is authoring configuration read back, against one SQLite file with the real
 * migrations applied. */
const fx = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS], timeoutMs: 60_000 });
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

const RARE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WELL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * Every name below is DIFFERENT text from its two siblings — staff, customer-facing and kitchen —
 * so a read that takes the wrong one of a trio fails rather than passing on a shared string
 * (CLAUDE.md §3). The same goes for the unit prices: each product's own price is unlike every list
 * item's, so an item paired with the wrong product's row shows up as the wrong money.
 */
const products = {
  burger: {
    name: "burger staff",
    customerName: { en: "Chargrilled burger" },
    kitchenName: "BURG",
    unitPrice: "9.00",
    vatClass: "general" as const,
  },
  bacon: {
    name: "bacon staff",
    customerName: { en: "Smoked streaky bacon" },
    kitchenName: "BCN",
    unitPrice: "3.00",
    vatClass: "reduced" as const,
    allergens: { mustard: { presence: "contains" as const } },
    dietaryDeclarations: ["halal" as const],
  },
  cheese: {
    name: "cheese staff",
    customerName: { en: "Aged manchego" },
    kitchenName: "CHS",
    unitPrice: "2.00",
    vatClass: "general" as const,
    allergens: { milk: { presence: "contains" as const } },
    dietaryDeclarations: ["vegetarian" as const],
  },
  olives: {
    name: "olives staff",
    customerName: { en: "Gordal olives" },
    kitchenName: "OLV",
    unitPrice: "1.25",
    vatClass: "reduced" as const,
  },
};

const ids: Record<keyof typeof products, string> = {
  burger: "",
  bacon: "",
  cheese: "",
  olives: "",
};
let catalogueId = "";
let locationId = "";
/** The burger's one `menu_items` row — the offer a diner orders from. */
let offerId = "";

beforeEach(async () => {
  const venue = await seedVenue(fx.db);
  locationId = venue.locationId;
  await run(async (tx) => {
    await asAppUser(tx);
    const menu = await createCatalogue(tx, { name: "Deli" });
    catalogueId = menu.id;
    const section = await createMenuSection(tx, { menuId: menu.id, name: { en: "Mains" } });
    for (const [key, fields] of Object.entries(products)) {
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        unitId: null,
        ...fields,
      });
      ids[key as keyof typeof ids] = product.id;
    }
    const offer = await createMenuItem(tx, {
      menuId: menu.id,
      productId: ids.burger,
      sectionId: section.id,
      grossPrice: "9.50",
    });
    offerId = offer.id;
    await assignCatalogueToLocation(tx, locationId, menu.id);
  });
});

/**
 * Bacon is priced by the list item (1.50, over the product's 3.00), cheese has to borrow its
 * product's own 2.00, and olives is the list item again (0.75, over 1.25) — the three rungs of the
 * fallback chain below a menu offer.
 */
const toppings = () => ({
  name: "Toppings staff",
  customerName: { en: "Add a topping" },
  kitchenName: "TOP",
  minPicks: 1,
  maxPicks: 3,
  items: [
    { productId: ids.bacon, price: "1.50", maxQuantity: 2, preselected: true },
    { productId: ids.cheese },
    { productId: ids.olives, price: "0.75" },
  ],
});

const sauces = () => ({
  name: "Sauces staff",
  customerName: { en: "Pick a sauce" },
  kitchenName: "SAUCE",
  minPicks: 0,
  maxPicks: 1,
  items: [{ productId: ids.olives }],
});

const cooked = () => ({
  name: "Cooked staff",
  customerName: { en: "How would you like it?" },
  kitchenName: "COOK",
  defaultLabelId: RARE,
  labels: [
    {
      id: RARE,
      name: "Medium rare staff",
      customerName: { en: "Pink in the middle" },
      kitchenName: "MR",
      available: true,
    },
    {
      id: WELL,
      name: "Well done staff",
      customerName: { en: "Cooked right through" },
      kitchenName: "WD",
      available: true,
    },
  ],
});

/** Create the two lists and attach them to the burger in the order given. */
const attach = async (
  tx: Transaction,
  order: ("options" | "extras")[],
): Promise<{ optionsId: string; extrasId: string }> => {
  const options = await createOptionList(tx, cooked(), "en");
  const extras = await createExtraList(tx, toppings(), "en");
  await writeProductModifiers(
    tx,
    ids.burger,
    order.map((kind) => ({ kind, id: kind === "options" ? options.id : extras.id })),
  );
  return { optionsId: options.id, extrasId: extras.id };
};

describe("what a product offers", () => {
  it("walks the product's own attachment order", async () => {
    const seeded = await run(async (tx) => {
      await asAppUser(tx);
      return attach(tx, ["options", "extras"]);
    });

    const offered = await run(async (tx) => {
      await asAppUser(tx);
      return readOfferedModifiers(tx, [{ productId: ids.burger, menuItemId: null }]);
    });

    expect(offered.get(ids.burger)!.map((entry) => [entry.kind, entry.id])).toEqual([
      ["options", seeded.optionsId],
      ["extras", seeded.extrasId],
    ]);
  });

  it("reverses the walk when the attachment order is reversed", async () => {
    const seeded = await run(async (tx) => {
      await asAppUser(tx);
      return attach(tx, ["extras", "options"]);
    });

    const offered = await run(async (tx) => {
      await asAppUser(tx);
      return readOfferedModifiers(tx, [{ productId: ids.burger, menuItemId: null }]);
    });

    expect(offered.get(ids.burger)!.map((entry) => [entry.kind, entry.id])).toEqual([
      ["extras", seeded.extrasId],
      ["options", seeded.optionsId],
    ]);
  });

  it("gives the options list its own three names, its labels' three names and its default", async () => {
    const seeded = await run(async (tx) => {
      await asAppUser(tx);
      return attach(tx, ["options", "extras"]);
    });

    const offered = await run(async (tx) => {
      await asAppUser(tx);
      return readOfferedModifiers(tx, [{ productId: ids.burger, menuItemId: null }]);
    });

    expect(offered.get(ids.burger)![0]).toEqual({
      kind: "options",
      id: seeded.optionsId,
      name: "Cooked staff",
      customerName: { en: "How would you like it?" },
      kitchenName: "COOK",
      defaultLabelId: RARE,
      labels: [
        {
          id: RARE,
          name: "Medium rare staff",
          customerName: { en: "Pink in the middle" },
          kitchenName: "MR",
          available: true,
        },
        {
          id: WELL,
          name: "Well done staff",
          customerName: { en: "Cooked right through" },
          kitchenName: "WD",
          available: true,
        },
      ],
    });
  });

  it("prices each item from the list item and then the product, and carries the product's own facts", async () => {
    const seeded = await run(async (tx) => {
      await asAppUser(tx);
      return attach(tx, ["extras", "options"]);
    });

    const offered = await run(async (tx) => {
      await asAppUser(tx);
      return readOfferedModifiers(tx, [{ productId: ids.burger, menuItemId: null }]);
    });

    expect(offered.get(ids.burger)![0]).toEqual({
      kind: "extras",
      id: seeded.extrasId,
      name: "Toppings staff",
      customerName: { en: "Add a topping" },
      kitchenName: "TOP",
      minPicks: 1,
      maxPicks: 3,
      items: [
        {
          productId: ids.bacon,
          name: "bacon staff",
          customerName: { en: "Smoked streaky bacon" },
          kitchenName: "BCN",
          price: "1.50",
          vatClass: "reduced",
          maxQuantity: 2,
          preselected: true,
          addAllergens: { mustard: { presence: "contains" } },
          suitableFor: ["halal"],
        },
        {
          productId: ids.cheese,
          name: "cheese staff",
          customerName: { en: "Aged manchego" },
          kitchenName: "CHS",
          price: "2.00",
          vatClass: "general",
          maxQuantity: 1,
          preselected: false,
          addAllergens: { milk: { presence: "contains" } },
          // The dish's own line expands its declarations the same way (`readQueueSubItems`,
          // apps/server/src/working-order.ts), so vegetarian implies no meat and no fish.
          suitableFor: ["vegetarian", "no_meat", "no_fish"],
        },
        {
          productId: ids.olives,
          name: "olives staff",
          customerName: { en: "Gordal olives" },
          kitchenName: "OLV",
          price: "0.75",
          vatClass: "reduced",
          maxQuantity: 1,
          preselected: false,
          addAllergens: null,
          suitableFor: [],
        },
      ],
    });
  });

  it("leaves out a list the manager has deactivated", async () => {
    await run(async (tx) => {
      await asAppUser(tx);
      const seeded = await attach(tx, ["options", "extras"]);
      await updateOptionList(tx, seeded.optionsId, { ...cooked(), active: false }, "en");
      await updateExtraList(tx, seeded.extrasId, { ...toppings(), active: false }, "en");
    });

    const offered = await run(async (tx) => {
      await asAppUser(tx);
      return readOfferedModifiers(tx, [{ productId: ids.burger, menuItemId: null }]);
    });

    expect(offered.get(ids.burger)).toEqual([]);
  });

  it("offers only the labels still available, and drops a default naming a withdrawn one", async () => {
    // `option_lists.default_label_id` carries no foreign key (schema/options.ts), and
    // `parseOptionListInput` drops a default naming an unavailable label (option-contract.ts), so
    // the authoring API cannot leave the two out of step. The column is written directly here to
    // reach the state anyway, because nothing in the database keeps it consistent.
    const seeded = await run(async (tx) => {
      await asAppUser(tx);
      return attach(tx, ["options"]);
    });
    await fx.db.execute(sql`update option_labels set available = false where id = ${RARE}`);

    const offered = await run(async (tx) => {
      await asAppUser(tx);
      return readOfferedModifiers(tx, [{ productId: ids.burger, menuItemId: null }]);
    });

    const list = offered.get(ids.burger)![0]!;
    expect(list).toMatchObject({ id: seeded.optionsId, defaultLabelId: null });
    expect(list.kind === "options" && list.labels.map((label) => label.id)).toEqual([WELL]);
  });
});

describe("what a menu offer publishes", () => {
  it("replaces each extras list with the offer's own narrowed, repriced version", async () => {
    await run(async (tx) => {
      await asAppUser(tx);
      const seeded = await attach(tx, ["options", "extras"]);
      await setMenuItemExtraLists(tx, offerId, [
        {
          listId: seeded.extrasId,
          items: [
            { productId: ids.bacon, price: "1.00" },
            { productId: ids.cheese, available: false },
          ],
        },
      ]);
    });

    const offered = await run(async (tx) => {
      await asAppUser(tx);
      return readOfferedModifiers(tx, [{ productId: ids.burger, menuItemId: offerId }]);
    });

    const list = offered.get(offerId)![1]!;
    expect(
      list.kind === "extras" && list.items.map((item) => [item.productId, item.price]),
    ).toEqual([
      [ids.bacon, "1.00"],
      [ids.olives, "0.75"],
    ]);
  });

  it("omits an extras list the offer does not publish, and keeps the options list", async () => {
    const seeded = await run(async (tx) => {
      await asAppUser(tx);
      const attached = await attach(tx, ["options", "extras"]);
      const second = await createExtraList(tx, sauces(), "en");
      await writeProductModifiers(tx, ids.burger, [
        { kind: "options", id: attached.optionsId },
        { kind: "extras", id: attached.extrasId },
        { kind: "extras", id: second.id },
      ]);
      // Only the second list is published on this offer.
      await setMenuItemExtraLists(tx, offerId, [{ listId: second.id, items: [] }]);
      return { ...attached, secondId: second.id };
    });

    const offered = await run(async (tx) => {
      await asAppUser(tx);
      return readOfferedModifiers(tx, [{ productId: ids.burger, menuItemId: offerId }]);
    });

    expect(offered.get(offerId)!.map((entry) => [entry.kind, entry.id])).toEqual([
      ["options", seeded.optionsId],
      ["extras", seeded.secondId],
    ]);
  });
});

describe("the two reads a till sells from", () => {
  it("listAvailableProducts carries the product-side walk", async () => {
    const seeded = await run(async (tx) => {
      await asAppUser(tx);
      return attach(tx, ["options", "extras"]);
    });

    const { products: available } = await run(async (tx) => {
      await asAppUser(tx);
      return listAvailableProducts(tx, locationId);
    });

    const burger = available.find((product) => product.id === ids.burger)!;
    expect(burger.offeredModifiers.map((entry) => [entry.kind, entry.id])).toEqual([
      ["options", seeded.optionsId],
      ["extras", seeded.extrasId],
    ]);
    // A product carrying no attachment at all comes back with an empty walk, not a missing key.
    expect(available.find((product) => product.id === ids.olives)!.offeredModifiers).toEqual([]);
  });

  it("listMenuOffers carries the menu-resolved walk", async () => {
    const seeded = await run(async (tx) => {
      await asAppUser(tx);
      const attached = await attach(tx, ["options", "extras"]);
      await setMenuItemExtraLists(tx, offerId, [
        { listId: attached.extrasId, items: [{ productId: ids.bacon, price: "1.00" }] },
      ]);
      return attached;
    });

    const offers = await run(async (tx) => {
      await asAppUser(tx);
      return listMenuOffers(tx, [catalogueId]);
    });

    const walk = offers.find((offer) => offer.id === offerId)!.offeredModifiers;
    expect(walk.map((entry) => [entry.kind, entry.id])).toEqual([
      ["options", seeded.optionsId],
      ["extras", seeded.extrasId],
    ]);
    const list = walk[1]!;
    expect(list.kind === "extras" && list.items[0]!.price).toBe("1.00");
  });
});

describe("one shared resolution for a set of dishes", () => {
  afterEach(() => vi.restoreAllMocks());

  // These four assertions moved here with the code they are about: the order path used to call
  // these readers itself, and "basket-wide modifier resolution (perf)"
  // (apps/server/src/working-order.test.ts) watched them from there. It now calls
  // `resolveAttachedModifiers` and counts THAT, because a spy on the `@waitron/catalogue` index
  // cannot see a call this file makes through its own relative import.

  it("reads the product side alone for dishes that name no offer", async () => {
    await run(async (tx) => {
      await asAppUser(tx);
      await attach(tx, ["options", "extras"]);
    });
    const menuExtras = vi.spyOn(extraProjection, "readMenuExtras");
    const productExtras = vi.spyOn(extraProjection, "readProductExtras");
    const attachments = vi.spyOn(productModifiers, "readProductModifiers");
    const optionLists = vi.spyOn(optionsModule, "readOptionListsByIds");

    // Three dishes, the first twice, so a read that moved inside a per-dish loop would count 3.
    await run(async (tx) => {
      await asAppUser(tx);
      return resolveAttachedModifiers(tx, [
        { productId: ids.burger, menuItemId: null },
        { productId: ids.burger, menuItemId: null },
        { productId: ids.olives, menuItemId: null },
      ]);
    });

    expect(productExtras).toHaveBeenCalledTimes(1);
    expect(optionLists).toHaveBeenCalledTimes(1);
    // ONCE, not twice: `readProductExtras` reads the same `product_modifiers` rows as its own first
    // statement, and is handed the map this resolve already read instead of asking again. It calls
    // `readProductModifiers` through the same module this spy replaces the binding on, so a second
    // read would show up here as a second call.
    expect(attachments).toHaveBeenCalledTimes(1);
    expect(productExtras.mock.calls[0]![2]).toBe(await attachments.mock.results[0]!.value);
    // No dish names a menu offer, so the menu-side read is never reached.
    expect(menuExtras).not.toHaveBeenCalled();
  });

  it("reads the menu side alone for dishes ordered through an offer", async () => {
    await run(async (tx) => {
      await asAppUser(tx);
      const attached = await attach(tx, ["options", "extras"]);
      await setMenuItemExtraLists(tx, offerId, [{ listId: attached.extrasId, items: [] }]);
    });
    const menuExtras = vi.spyOn(extraProjection, "readMenuExtras");
    const productExtras = vi.spyOn(extraProjection, "readProductExtras");
    const attachments = vi.spyOn(productModifiers, "readProductModifiers");
    const optionLists = vi.spyOn(optionsModule, "readOptionListsByIds");

    await run(async (tx) => {
      await asAppUser(tx);
      return resolveAttachedModifiers(tx, [
        { productId: ids.burger, menuItemId: offerId },
        { productId: ids.burger, menuItemId: offerId },
      ]);
    });

    expect(menuExtras).toHaveBeenCalledTimes(1);
    expect(attachments).toHaveBeenCalledTimes(1);
    expect(optionLists).toHaveBeenCalledTimes(1);
    // Every dish names an offer, so the product-side extras read is never reached.
    expect(productExtras).not.toHaveBeenCalled();
  });
});
