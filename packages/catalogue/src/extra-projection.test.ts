import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCatalogue, addProductToMenu, createProduct } from "./operations.js";
import { createExtraList, updateExtraList } from "./extras.js";
import { createOptionList } from "./options.js";
import { readProductModifiers, writeProductModifiers } from "./product-modifiers.js";
import * as productModifiers from "./product-modifiers.js";
import { readProductExtras } from "./extra-projection.js";
import { createUnit } from "./units.js";

const UNKNOWN_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const fx = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS], timeoutMs: 60_000 });
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
/**
 * Six products, every one with a DIFFERENT name and a DIFFERENT unit price, so a read that pairs an
 * item with the wrong product's row shows up as the wrong money rather than passing. Four are the
 * toppings a list offers; two are the dishes the menu offers carry, which is what the dependants
 * preview names.
 */
const unitPrices = {
  bacon: "3.00",
  cheese: "2.00",
  olives: "1.25",
  ham: "5.00",
  burger: "9.00",
  pizza: "11.00",
};
const ids: Record<keyof typeof unitPrices, string> = {
  bacon: "",
  cheese: "",
  olives: "",
  ham: "",
  burger: "",
  pizza: "",
};
/** The two menu offers — one row of `menu_items` each, for the burger and for the pizza. */
const offers = { burger: "", pizza: "" };

beforeEach(async () => {
  await seedTenant(fx.db);
  await run(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Deli" });
    for (const [key, unitPrice] of Object.entries(unitPrices)) {
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: key,
        unitId: null,
        unitPrice,
        vatClass: "reduced",
      });
      ids[key as keyof typeof ids] = product.id;
    }
    for (const dish of ["burger", "pizza"] as const) {
      const offer = await addProductToMenu(tx, {
        menuId: menu.id,
        productId: ids[dish],
        grossPrice: unitPrices[dish],
      });
      offers[dish] = offer.id;
    }
  });
});

/**
 * Four toppings, each resolving its price from a different place: bacon from the list item (1.50,
 * over the product's 3.00), cheese and ham from their products (2.00 and 5.00), olives from the list
 * item again (0.75, over the product's 1.25).
 */
const toppings = () => ({
  name: "Toppings",
  customerName: { en: "Add a topping" },
  kitchenName: "TOP",
  minPicks: 0,
  maxPicks: 3,
  items: [
    { productId: ids.bacon, price: "1.50", maxQuantity: 2, preselected: true },
    { productId: ids.cheese },
    { productId: ids.olives, price: "0.75" },
    { productId: ids.ham },
  ],
});

const carries = async (tx: Transaction, dish: keyof typeof offers, ...listIds: string[]) => {
  const productId = ids[dish];
  const held = (await readProductModifiers(tx, [productId])).get(productId) ?? [];
  const added = listIds
    .map((listId) => listId.toLowerCase())
    .filter((listId) => !held.some((ref) => ref.kind === "extras" && ref.id === listId))
    .map((listId) => ({ kind: "extras" as const, id: listId }));
  await writeProductModifiers(tx, productId, [...held, ...added]);
};

describe("what a product's own extras lists offer", () => {
  it("returns the effective unit and portion with a rounded per-pick price", async () => {
    const { listId, unitId, weightedId } = await run(async (tx) => {
      const kg = await createUnit(
        tx,
        { name: { en: "Kilogram" }, abbreviation: { en: "kg" }, precision: 3 },
        "en",
      );
      const weighted = await createProduct(tx, {
        catalogueId: (await createCatalogue(tx, { name: "Weight" })).id,
        categoryId: null,
        name: "Olives by weight",
        unitId: kg.id,
        unitPrice: "0.27",
        vatClass: "reduced",
      });
      const list = await createExtraList(
        tx,
        {
          name: "Weighted toppings",
          items: [
            { productId: weighted.id, portion: "0.050" },
            { productId: ids.bacon, price: "1.50" },
          ],
        },
        "en",
      );
      await carries(tx, "burger", list.id);
      return { listId: list.id, unitId: kg.id, weightedId: weighted.id };
    });

    const offered = await run((tx) => readProductExtras(tx, [ids.burger]));
    expect(offered.get(ids.burger)![0]!.id).toBe(listId);
    expect(offered.get(ids.burger)![0]!.items).toEqual([
      expect.objectContaining({
        productId: weightedId,
        portion: "0.050",
        price: "0.01",
        unit: { id: unitId, abbreviation: { en: "kg" }, precision: 3 },
      }),
      expect.objectContaining({
        productId: ids.bacon,
        portion: "1.000",
        price: "1.50",
        unit: expect.objectContaining({ precision: 0 }),
      }),
    ]);
  });

  it("prices each item from the list item and then the product, with no menu offer involved", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) => carries(tx, "burger", list.id));

    const carried = await run((tx) => readProductExtras(tx, [ids.burger]));

    const [only] = carried.get(ids.burger)!;
    expect(only!.id).toBe(list.id);
    // Bacon and olives carry a price on the list item, over their products' 3.00 and 1.25; cheese
    // and ham carry none and fall to their products' own. Four different amounts, so an item paired
    // with the wrong product's row shows up as the wrong money.
    expect(only!.items.map((item) => [item.productId, item.price])).toEqual([
      [ids.bacon, "1.50"],
      [ids.cheese, "2.00"],
      [ids.olives, "0.75"],
      [ids.ham, "5.00"],
    ]);
  });

  it("returns each product's lists in the order that product carries them", async () => {
    const toppingsList = await run((tx) => createExtraList(tx, toppings(), "en"));
    const sauces = await run((tx) =>
      createExtraList(tx, { name: "Sauces", items: [{ productId: ids.ham }] }, "en"),
    );
    // The two dishes carry the same two lists in OPPOSITE orders, so an order taken from the list
    // id, or from `extra_lists.sort`, has to get one of them wrong whichever ids were minted.
    await run(async (tx) => {
      await writeProductModifiers(tx, ids.burger, [
        { kind: "extras", id: toppingsList.id },
        { kind: "extras", id: sauces.id },
      ]);
      await writeProductModifiers(tx, ids.pizza, [
        { kind: "extras", id: sauces.id },
        { kind: "extras", id: toppingsList.id },
      ]);
    });

    const carried = await run((tx) => readProductExtras(tx, [ids.burger, ids.pizza]));

    expect(carried.get(ids.burger)!.map((each) => each.id)).toEqual([toppingsList.id, sauces.id]);
    expect(carried.get(ids.pizza)!.map((each) => each.id)).toEqual([sauces.id, toppingsList.id]);
  });

  it("leaves out an options list the same product carries", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    const doneness = await run((tx) =>
      createOptionList(tx, { name: "Doneness", labels: [{ name: "Rare" }] }, "en"),
    );
    // The options list is attached FIRST, so a read that walked the attachment list without
    // filtering would hand back its id here rather than the extras list's.
    await run((tx) =>
      writeProductModifiers(tx, ids.burger, [
        { kind: "options", id: doneness.id },
        { kind: "extras", id: list.id },
      ]),
    );

    const carried = await run((tx) => readProductExtras(tx, [ids.burger]));

    expect(carried.get(ids.burger)!.map((each) => each.id)).toEqual([list.id]);
  });

  it("returns an empty map for no products, and nothing for a product carrying none", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) => carries(tx, "burger", list.id));

    expect(await run((tx) => readProductExtras(tx, []))).toEqual(new Map());
    const carried = await run((tx) => readProductExtras(tx, [ids.pizza]));
    expect(carried.get(ids.pizza)).toBeUndefined();
  });

  it("takes attachments the caller already read rather than reading them again", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) => carries(tx, "burger", list.id));
    const control = await run((tx) => readProductExtras(tx, [ids.burger]));
    const attachments = await run((tx) => readProductModifiers(tx, [ids.burger]));

    const spy = vi.spyOn(productModifiers, "readProductModifiers");
    try {
      const supplied = await run((tx) => readProductExtras(tx, [ids.burger], attachments));
      // The caller's map answers this read's first question, so it does not ask it.
      expect(spy).not.toHaveBeenCalled();
      expect(supplied).toEqual(control);

      // With no map supplied the read does ask, and answers the same.
      const reread = await run((tx) => readProductExtras(tx, [ids.burger]));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(reread).toEqual(control);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns an inactive list rather than dropping it", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) => carries(tx, "burger", list.id));
    await run((tx) => updateExtraList(tx, list.id, { ...toppings(), active: false }, "en"));

    const carried = await run((tx) => readProductExtras(tx, [ids.burger]));

    expect(carried.get(ids.burger)!.map((each) => [each.id, each.active])).toEqual([
      [list.id, false],
    ]);
  });
});

describe("a product extras read handed the caller's attachments", () => {
  it("answers only the products asked for, when the map covers a wider set", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run(async (tx) => {
      await carries(tx, "burger", list.id);
      await carries(tx, "pizza", list.id);
    });
    const attachments = await run((tx) => readProductModifiers(tx, [ids.burger, ids.pizza]));

    const carried = await run((tx) => readProductExtras(tx, [ids.burger], attachments));

    expect([...carried.keys()]).toEqual([ids.burger]);
  });

  it("skips an attachment naming a list no row holds", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    const attachments = new Map([
      [
        ids.burger,
        [
          { kind: "extras" as const, id: UNKNOWN_ID },
          { kind: "extras" as const, id: list.id },
        ],
      ],
    ]);

    const carried = await run((tx) => readProductExtras(tx, [ids.burger], attachments));

    expect(carried.get(ids.burger)!.map((each) => each.id)).toEqual([list.id]);
  });
});
