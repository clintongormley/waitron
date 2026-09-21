import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { captureError, CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { CATALOGUE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";
import { createCatalogue, createMenuItem, createMenuSection, createProduct } from "./operations.js";
import {
  createExtraList,
  deleteExtraList,
  extraListDependants,
  setMenuItemExtraLists,
  updateExtraList,
} from "./extras.js";
import { createOptionList } from "./options.js";
import { readProductModifiers, writeProductModifiers } from "./product-modifiers.js";
import * as productModifiers from "./product-modifiers.js";
import { readMenuExtras, readProductExtras } from "./extra-projection.js";

// Publishing an extras list on a menu offer is authoring configuration, run here against one
// SQLite file with the real migrations applied. The grants walkthrough this file used to end with
// is gone with the grants themselves; the cases about a save racing a list edit are in
// extras.concurrency.test.ts.
const fx = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS], timeoutMs: 60_000 });
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
const refusal = (fn: (tx: Transaction) => Promise<unknown>) => captureError(() => run(fn));

const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

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
    const section = await createMenuSection(tx, { menuId: menu.id, name: { en: "Mains" } });
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
      const offer = await createMenuItem(tx, {
        menuId: menu.id,
        productId: ids[dish],
        sectionId: section.id,
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

/**
 * Attach these extras lists to the dish's product, on top of whatever it already carries.
 * `setMenuItemExtraLists` refuses a list the offer's product does not carry, so a test that
 * publishes has to say what the dish carries first.
 */
const carries = async (tx: Transaction, dish: keyof typeof offers, ...listIds: string[]) => {
  const productId = ids[dish];
  const held = (await readProductModifiers(tx, [productId])).get(productId) ?? [];
  const added = listIds
    .map((listId) => listId.toLowerCase())
    .filter((listId) => !held.some((ref) => ref.kind === "extras" && ref.id === listId))
    .map((listId) => ({ kind: "extras" as const, id: listId }));
  await writeProductModifiers(tx, productId, [...held, ...added]);
};

/** {@link carries}, then publish — what a manager's two saves do, in one call. */
const publish = async (
  tx: Transaction,
  dish: keyof typeof offers,
  publications: { listId: string; items?: unknown[] }[],
) => {
  await carries(tx, dish, ...publications.map((publication) => publication.listId));
  await setMenuItemExtraLists(tx, offers[dish], publications);
};

const countRows = async (table: "menu_item_extra_lists" | "menu_item_extra_items") => {
  const rows = await fx.db.execute<{ count: number }>(
    sql`select count(*) as count from ${sql.identifier(table)}`,
  );
  return rows.rows[0]!.count;
};

describe("what a menu offer publishes", () => {
  it("prices each item from the menu, then the list item, then the product", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) =>
      publish(tx, "burger", [
        { listId: list.id, items: [{ productId: ids.bacon, price: "1.00" }] },
      ]),
    );

    const published = await run((tx) => readMenuExtras(tx, [offers.burger]));

    // Bacon is the plan's three-price case: the product says 3.00, the list item says 1.50, this
    // menu offer says 1.00, and the menu wins. Cheese, olives and ham carry no menu row at all and
    // are still offered — a menu offer that narrows nothing offers the whole list.
    expect(
      published.get(offers.burger)![0]!.items.map((item) => [item.productId, item.price]),
    ).toEqual([
      [ids.bacon, "1.00"],
      [ids.cheese, "2.00"],
      [ids.olives, "0.75"],
      [ids.ham, "5.00"],
    ]);
  });

  it("drops an item this menu offer marks unavailable, leaving the list itself alone", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) =>
      publish(tx, "burger", [
        { listId: list.id, items: [{ productId: ids.cheese, available: false }] },
      ]),
    );

    const published = await run((tx) => readMenuExtras(tx, [offers.burger]));

    expect(published.get(offers.burger)![0]!.items.map((item) => item.productId)).toEqual([
      ids.bacon,
      ids.olives,
      ids.ham,
    ]);
    // Withdrawn here and nowhere else: the pizza's offer publishes the same list and still shows it.
    await run((tx) => publish(tx, "pizza", [{ listId: list.id, items: [] }]));
    const elsewhere = await run((tx) => readMenuExtras(tx, [offers.pizza]));
    expect(elsewhere.get(offers.pizza)![0]!.items.map((item) => item.productId)).toContain(
      ids.cheese,
    );
  });

  it("carries the list's own terms through to the menu view", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) => publish(tx, "burger", [{ listId: list.id, items: [] }]));

    const [published] = (await run((tx) => readMenuExtras(tx, [offers.burger]))).get(
      offers.burger,
    )!;

    expect(published).toMatchObject({
      id: list.id,
      name: "Toppings",
      customerName: { en: "Add a topping" },
      kitchenName: "TOP",
      minPicks: 0,
      maxPicks: 3,
      active: true,
    });
    // An item keeps its own id and the terms of the offer — how many the diner may take and whether
    // it starts picked — so the till can answer with `validateExtraSelections` (extra-contract.ts).
    expect(published!.items[0]).toEqual({
      id: list.items[0]!.id,
      productId: ids.bacon,
      maxQuantity: 2,
      preselected: true,
      price: "1.50",
    });
  });

  it("returns each offer's lists in the order that offer published them", async () => {
    const toppingsList = await run((tx) => createExtraList(tx, toppings(), "en"));
    const sauces = await run((tx) =>
      createExtraList(tx, { name: "Sauces", items: [{ productId: ids.ham }] }, "en"),
    );
    // The two offers publish the same two lists in OPPOSITE orders, so an ordering taken from the
    // list id rather than from `display_order` has to get one of them wrong whichever ids were
    // minted.
    await run(async (tx) => {
      await publish(tx, "burger", [
        { listId: toppingsList.id, items: [] },
        { listId: sauces.id, items: [] },
      ]);
      await publish(tx, "pizza", [
        { listId: sauces.id, items: [] },
        { listId: toppingsList.id, items: [] },
      ]);
    });

    const published = await run((tx) => readMenuExtras(tx, [offers.burger, offers.pizza]));

    expect(published.get(offers.burger)!.map((list) => list.id)).toEqual([
      toppingsList.id,
      sauces.id,
    ]);
    expect(published.get(offers.pizza)!.map((list) => list.id)).toEqual([
      sauces.id,
      toppingsList.id,
    ]);
  });

  it("returns an empty map for no menu items, and nothing for an offer that publishes none", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) => publish(tx, "burger", [{ listId: list.id, items: [] }]));

    expect(await run((tx) => readMenuExtras(tx, []))).toEqual(new Map());
    const published = await run((tx) => readMenuExtras(tx, [offers.pizza]));
    expect(published.get(offers.pizza)).toBeUndefined();
  });

  it("replaces the whole published set, rather than adding to it", async () => {
    const toppingsList = await run((tx) => createExtraList(tx, toppings(), "en"));
    const sauces = await run((tx) =>
      createExtraList(tx, { name: "Sauces", items: [{ productId: ids.ham }] }, "en"),
    );
    await run((tx) =>
      publish(tx, "burger", [
        { listId: toppingsList.id, items: [{ productId: ids.bacon, price: "1.00" }] },
      ]),
    );

    await run((tx) => publish(tx, "burger", [{ listId: sauces.id, items: [] }]));

    const published = await run((tx) => readMenuExtras(tx, [offers.burger]));
    expect(published.get(offers.burger)!.map((list) => list.id)).toEqual([sauces.id]);
    // The dropped list's per-item override went with it, through
    // `menu_item_extra_items_list_fk ... ON DELETE CASCADE`.
    expect(await countRows("menu_item_extra_items")).toBe(0);
  });

  it("publishes nothing when the body is empty, clearing what the offer carried", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) =>
      publish(tx, "burger", [
        { listId: list.id, items: [{ productId: ids.bacon, price: "1.00" }] },
      ]),
    );

    await run((tx) => publish(tx, "burger", []));

    expect(await run((tx) => readMenuExtras(tx, [offers.burger]))).toEqual(new Map());
    expect(await countRows("menu_item_extra_lists")).toBe(0);
    expect(await countRows("menu_item_extra_items")).toBe(0);
  });

  it("saves an upper-cased list id and reads it back", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));

    await run((tx) =>
      publish(tx, "burger", [
        {
          listId: list.id.toUpperCase(),
          items: [{ productId: ids.bacon.toUpperCase(), price: "1.00" }],
        },
      ]),
    );

    const published = await run((tx) => readMenuExtras(tx, [offers.burger]));
    expect(published.get(offers.burger)!.map((each) => each.id)).toEqual([list.id]);
    expect(
      published.get(offers.burger)![0]!.items.find((item) => item.productId === ids.bacon)!.price,
    ).toBe("1.00");
  });
});

describe("what a product's own extras lists offer", () => {
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

  it("ignores what the dish's menu offer reprices and withdraws", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) =>
      publish(tx, "burger", [
        {
          listId: list.id,
          items: [
            { productId: ids.bacon, price: "1.00" },
            { productId: ids.cheese, available: false },
          ],
        },
      ]),
    );

    const carried = await run((tx) => readProductExtras(tx, [ids.burger]));

    // The burger's menu offer charges 1.00 for bacon and withdraws cheese. What the PRODUCT carries
    // is a different thing, so all four items are still here at the list-then-product prices.
    expect(carried.get(ids.burger)![0]!.items.map((item) => [item.productId, item.price])).toEqual([
      [ids.bacon, "1.50"],
      [ids.cheese, "2.00"],
      [ids.olives, "0.75"],
      [ids.ham, "5.00"],
    ]);
  });

  it("takes attachments the caller already read rather than reading them again", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) => carries(tx, "burger", list.id));
    const control = await run((tx) => readProductExtras(tx, [ids.burger]));
    const attachments = await run((tx) => readProductModifiers(tx, [ids.burger]));

    const spy = vi.spyOn(productModifiers, "readProductModifiers");
    try {
      const supplied = await run((tx) => readProductExtras(tx, [ids.burger], attachments));
      // The caller's map is the answer to the question this read's first statement would have
      // asked, so it does not ask it: the order path reads `product_modifiers` once per basket
      // (`resolveBasketModifiers`, apps/server/src/working-order.ts).
      expect(spy).not.toHaveBeenCalled();
      expect(supplied).toEqual(control);

      // The control in the other direction: with no map supplied the read does ask, and answers
      // the same — so the assertion above is about the query, not about the result being empty.
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

describe("what publishing an extras list on a menu offer refuses", () => {
  const list = async () => run((tx) => createExtraList(tx, toppings(), "en"));

  it("refuses an unknown menu offer", async () => {
    const toppingsList = await list();

    const error = await refusal((tx) =>
      setMenuItemExtraLists(tx, UNKNOWN_ID, [{ listId: toppingsList.id, items: [] }]),
    );

    expect(error).toEqual(
      expect.objectContaining({
        code: "menu_item.not_found",
        params: { menuItemId: UNKNOWN_ID },
      }),
    );
  });

  it("refuses a list the offer's product does not carry, naming its position", async () => {
    const sauces = await run((tx) =>
      createExtraList(tx, { name: "Sauces", items: [{ productId: ids.ham }] }, "en"),
    );
    const toppingsList = await list();
    // The burger carries the sauces and not the toppings, so the refusal has to name the SECOND
    // publication rather than simply the first.
    await run((tx) => carries(tx, "burger", sauces.id));

    const error = await refusal((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [
        { listId: sauces.id, items: [] },
        { listId: toppingsList.id, items: [] },
      ]),
    );

    expect(error).toEqual(
      expect.objectContaining({ code: "extras.invalid", params: { field: "lists.1.listId" } }),
    );
  });

  it("refuses the same list published twice, naming the second position", async () => {
    const toppingsList = await list();

    const error = await refusal((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [
        { listId: toppingsList.id, items: [] },
        { listId: toppingsList.id.toUpperCase(), items: [] },
      ]),
    );

    expect(error).toEqual(
      expect.objectContaining({ code: "extras.invalid", params: { field: "lists.1.listId" } }),
    );
  });

  it("refuses the same product overridden twice within one list", async () => {
    const toppingsList = await list();

    const error = await refusal((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [
        {
          listId: toppingsList.id,
          items: [
            { productId: ids.bacon, price: "1.00" },
            { productId: ids.bacon, available: false },
          ],
        },
      ]),
    );

    expect(error).toEqual(
      expect.objectContaining({
        code: "extras.invalid",
        params: { field: "lists.0.items.1.productId" },
      }),
    );
  });

  it("refuses a list id no extras list holds", async () => {
    const toppingsList = await list();

    const error = await refusal((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [
        { listId: toppingsList.id, items: [] },
        { listId: UNKNOWN_ID, items: [] },
      ]),
    );

    expect(error).toEqual(
      expect.objectContaining({
        code: "extras.not_found",
        params: { extraListId: UNKNOWN_ID },
      }),
    );
  });

  it("refuses an override naming a product the list does not offer", async () => {
    const toppingsList = await list();
    // Carried by the dish, so the refusal below is about the override and not about the list.
    await run((tx) => carries(tx, "burger", toppingsList.id));

    // The burger itself is a product, and a real one — what makes it wrong here is that the
    // Toppings list does not offer it. The field path names its own position, so a hardcoded
    // `items.0` fails too.
    const error = await refusal((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [
        {
          listId: toppingsList.id,
          items: [{ productId: ids.bacon }, { productId: ids.burger }],
        },
      ]),
    );

    expect(error).toEqual(
      expect.objectContaining({
        code: "extras.invalid",
        params: { field: "lists.0.items.1.productId" },
      }),
    );
  });

  it("refuses a price that is not a product price", async () => {
    const toppingsList = await list();

    const error = await refusal((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [
        { listId: toppingsList.id, items: [{ productId: ids.bacon, price: "-1.00" }] },
      ]),
    );

    expect(error).toEqual(
      expect.objectContaining({
        code: "extras.invalid",
        params: { field: "lists.0.items.0.price" },
      }),
    );
  });

  it("refuses a list id that is not a uuid", async () => {
    await list();

    const error = await refusal((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [{ listId: "not-a-uuid", items: [] }]),
    );

    expect(error).toEqual(
      expect.objectContaining({ code: "extras.invalid", params: { field: "lists.0.listId" } }),
    );
  });

  it("refuses an overridden product id that is not a uuid", async () => {
    const toppingsList = await list();

    const error = await refusal((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [
        { listId: toppingsList.id, items: [{ productId: "not-a-uuid" }] },
      ]),
    );

    expect(error).toEqual(
      expect.objectContaining({
        code: "extras.invalid",
        params: { field: "lists.0.items.0.productId" },
      }),
    );
  });

  it("refuses an availability flag that is a string rather than a boolean", async () => {
    const toppingsList = await list();

    const error = await refusal((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [
        { listId: toppingsList.id, items: [{ productId: ids.bacon, available: "false" }] },
      ]),
    );

    expect(error).toEqual(
      expect.objectContaining({
        code: "extras.invalid",
        params: { field: "lists.0.items.0.available" },
      }),
    );
  });

  it("refuses a key neither a published list nor an override carries", async () => {
    const toppingsList = await list();

    const onTheList = await refusal((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [
        { listId: toppingsList.id, items: [], displayOrder: 3 },
      ]),
    );
    const onAnOverride = await refusal((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [
        { listId: toppingsList.id, items: [{ productId: ids.bacon, maxQuantity: 2 }] },
      ]),
    );

    expect(onTheList).toEqual(
      expect.objectContaining({
        code: "extras.invalid",
        params: { field: "lists.0.displayOrder" },
      }),
    );
    expect(onAnOverride).toEqual(
      expect.objectContaining({
        code: "extras.invalid",
        params: { field: "lists.0.items.0.maxQuantity" },
      }),
    );
  });

  it("leaves the published set as it was when it refuses", async () => {
    const toppingsList = await list();
    await run((tx) =>
      publish(tx, "burger", [
        { listId: toppingsList.id, items: [{ productId: ids.bacon, price: "1.00" }] },
      ]),
    );

    await refusal((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [{ listId: UNKNOWN_ID, items: [] }]),
    );

    const published = await run((tx) => readMenuExtras(tx, [offers.burger]));
    expect(
      published.get(offers.burger)![0]!.items.find((item) => item.productId === ids.bacon)!.price,
    ).toBe("1.00");
  });
});

describe("a menu override whose product leaves the list", () => {
  it("is gone when the product comes back, rather than repricing it", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) =>
      publish(tx, "burger", [
        { listId: list.id, items: [{ productId: ids.bacon, price: "1.00" }] },
      ]),
    );

    // Bacon leaves the list, then comes back at the list item's own 1.50.
    const withoutBacon = {
      ...toppings(),
      items: toppings().items.filter((item) => item.productId !== ids.bacon),
    };
    await run((tx) => updateExtraList(tx, list.id, withoutBacon, "en"));
    await run((tx) => updateExtraList(tx, list.id, toppings(), "en"));

    const published = await run((tx) => readMenuExtras(tx, [offers.burger]));
    expect(
      published.get(offers.burger)![0]!.items.find((item) => item.productId === ids.bacon)!.price,
    ).toBe("1.50");
    expect(await countRows("menu_item_extra_items")).toBe(0);
  });

  it("is gone when the list is emptied altogether", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) =>
      publish(tx, "burger", [
        {
          listId: list.id,
          items: [
            { productId: ids.bacon, price: "1.00" },
            { productId: ids.cheese, available: false },
          ],
        },
      ]),
    );

    // An ACTIVE list may not be emptied (`parseExtraListInput` refuses it), so a withdrawn list is
    // what empties one.
    await run((tx) =>
      updateExtraList(tx, list.id, { ...toppings(), active: false, items: [] }, "en"),
    );

    expect(await countRows("menu_item_extra_items")).toBe(0);
    // The publication itself stays: the offer still publishes the list, which now offers nothing.
    expect(await countRows("menu_item_extra_lists")).toBe(1);
    const published = await run((tx) => readMenuExtras(tx, [offers.burger]));
    expect(published.get(offers.burger)![0]!.items).toEqual([]);
    expect(published.get(offers.burger)![0]!.active).toBe(false);
  });

  it("keeps the overrides of the products the list still offers", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) =>
      publish(tx, "burger", [
        {
          listId: list.id,
          items: [
            { productId: ids.bacon, price: "1.00" },
            { productId: ids.olives, price: "0.10" },
          ],
        },
      ]),
    );

    const withoutBacon = {
      ...toppings(),
      items: toppings().items.filter((item) => item.productId !== ids.bacon),
    };
    await run((tx) => updateExtraList(tx, list.id, withoutBacon, "en"));

    const published = await run((tx) => readMenuExtras(tx, [offers.burger]));
    expect(
      published.get(offers.burger)![0]!.items.find((item) => item.productId === ids.olives)!.price,
    ).toBe("0.10");
  });
});

describe("the menu publication in the catalogue's configuration transfer", () => {
  const transferred = CATALOGUE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);

  it("copies a publication after both parents it names, and its overrides after it", () => {
    // `importConfigurationTables` inserts in this order and deletes in its reverse
    // (apps/server/src/configuration-transfer.ts), so each parent has to come first.
    expect(transferred.indexOf("menu_items")).toBeLessThan(
      transferred.indexOf("menu_item_extra_lists"),
    );
    expect(transferred.indexOf("extra_lists")).toBeLessThan(
      transferred.indexOf("menu_item_extra_lists"),
    );
    expect(transferred.indexOf("menu_item_extra_lists")).toBeLessThan(
      transferred.indexOf("menu_item_extra_items"),
    );
  });
});

describe("what deleting an extras list would touch", () => {
  it("names every menu offer that publishes it, by the dish's staff name", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run(async (tx) => {
      await publish(tx, "burger", [{ listId: list.id, items: [] }]);
      await publish(tx, "pizza", [{ listId: list.id, items: [] }]);
    });

    const dependants = await run((tx) => extraListDependants(tx, list.id));

    // The two dishes carry different names, so a join that reaches the wrong product shows up here.
    expect([...dependants.menus].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { id: offers.burger, name: "burger" },
      { id: offers.pizza, name: "pizza" },
    ]);
    // Both dishes carry the list as well as publishing it, which is the only way to publish it.
    // Alphabetical by staff name, so this pins the order as well as the membership.
    expect(dependants.products).toEqual([
      { id: ids.burger, name: "burger" },
      { id: ids.pizza, name: "pizza" },
    ]);
  });

  it("reports no menu offer for a list nobody publishes", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    const other = await run((tx) =>
      createExtraList(tx, { name: "Sauces", items: [{ productId: ids.ham }] }, "en"),
    );
    await run((tx) => publish(tx, "burger", [{ listId: other.id, items: [] }]));

    expect(await run((tx) => extraListDependants(tx, list.id))).toEqual({
      products: [],
      menus: [],
    });
  });

  it("takes the publication and its overrides with it when the list is deleted", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) =>
      publish(tx, "burger", [
        { listId: list.id, items: [{ productId: ids.bacon, price: "1.00" }] },
      ]),
    );
    expect(await countRows("menu_item_extra_lists")).toBe(1);
    expect(await countRows("menu_item_extra_items")).toBe(1);

    await run((tx) => deleteExtraList(tx, list.id));

    // Run rather than read off the foreign-key clause: the publication goes through
    // `menu_item_extra_lists_list_fk` and its overrides through `menu_item_extra_items_list_fk`,
    // both ON DELETE CASCADE.
    expect(await countRows("menu_item_extra_lists")).toBe(0);
    expect(await countRows("menu_item_extra_items")).toBe(0);
    expect(await run((tx) => readMenuExtras(tx, [offers.burger]))).toEqual(new Map());
  });
});
