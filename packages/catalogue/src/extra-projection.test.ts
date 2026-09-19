import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, captureError, CORE_MIGRATIONS, withTransaction } from "@waitron/db";
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
import { readMenuExtras } from "./extra-projection.js";

// Publishing an extras list on a menu offer is authoring configuration, and PGlite is the lighter
// target that still runs the real migrations (CLAUDE.md §4). It enforces the two publication
// tables' grants once the session assumes the application role — which only the walkthrough at the
// foot of this file does, with `asAppUser`; every other test in this file runs on PGlite's
// superuser connection and so exercises no grant at all. What PGlite cannot show is two writers
// overlapping, because every query serialises onto its one backend: the cases about a save racing a
// list edit, and about a product vanishing mid-read, are in extras.pg.test.ts against a real
// backend.
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

const countRows = async (table: "menu_item_extra_lists" | "menu_item_extra_items") => {
  const rows = await fx.db.execute<{ count: number }>(
    sql`select count(*)::int as count from ${sql.identifier(table)}`,
  );
  return rows.rows[0]!.count;
};

describe("what a menu offer publishes", () => {
  it("prices each item from the menu, then the list item, then the product", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [
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
      setMenuItemExtraLists(tx, offers.burger, [
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
    await run((tx) => setMenuItemExtraLists(tx, offers.pizza, [{ listId: list.id, items: [] }]));
    const elsewhere = await run((tx) => readMenuExtras(tx, [offers.pizza]));
    expect(elsewhere.get(offers.pizza)![0]!.items.map((item) => item.productId)).toContain(
      ids.cheese,
    );
  });

  it("carries the list's own terms through to the menu view", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) => setMenuItemExtraLists(tx, offers.burger, [{ listId: list.id, items: [] }]));

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
      await setMenuItemExtraLists(tx, offers.burger, [
        { listId: toppingsList.id, items: [] },
        { listId: sauces.id, items: [] },
      ]);
      await setMenuItemExtraLists(tx, offers.pizza, [
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
    await run((tx) => setMenuItemExtraLists(tx, offers.burger, [{ listId: list.id, items: [] }]));

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
      setMenuItemExtraLists(tx, offers.burger, [
        { listId: toppingsList.id, items: [{ productId: ids.bacon, price: "1.00" }] },
      ]),
    );

    await run((tx) => setMenuItemExtraLists(tx, offers.burger, [{ listId: sauces.id, items: [] }]));

    const published = await run((tx) => readMenuExtras(tx, [offers.burger]));
    expect(published.get(offers.burger)!.map((list) => list.id)).toEqual([sauces.id]);
    // The dropped list's per-item override went with it, through
    // `menu_item_extra_items_list_fk ... ON DELETE CASCADE`.
    expect(await countRows("menu_item_extra_items")).toBe(0);
  });

  it("publishes nothing when the body is empty, clearing what the offer carried", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [
        { listId: list.id, items: [{ productId: ids.bacon, price: "1.00" }] },
      ]),
    );

    await run((tx) => setMenuItemExtraLists(tx, offers.burger, []));

    expect(await run((tx) => readMenuExtras(tx, [offers.burger]))).toEqual(new Map());
    expect(await countRows("menu_item_extra_lists")).toBe(0);
    expect(await countRows("menu_item_extra_items")).toBe(0);
  });

  it("saves an upper-cased list id and reads it back", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));

    await run((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [
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
      setMenuItemExtraLists(tx, offers.burger, [
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
      setMenuItemExtraLists(tx, offers.burger, [
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
      setMenuItemExtraLists(tx, offers.burger, [
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
      setMenuItemExtraLists(tx, offers.burger, [
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
      await setMenuItemExtraLists(tx, offers.burger, [{ listId: list.id, items: [] }]);
      await setMenuItemExtraLists(tx, offers.pizza, [{ listId: list.id, items: [] }]);
    });

    const dependants = await run((tx) => extraListDependants(tx, list.id));

    // The two dishes carry different names, so a join that reaches the wrong product shows up here.
    expect([...dependants.menus].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { id: offers.burger, name: "burger" },
      { id: offers.pizza, name: "pizza" },
    ]);
    // Nothing attaches a list to a PRODUCT yet — `product_modifiers` is Task 6 of the plan.
    expect(dependants.products).toEqual([]);
  });

  it("reports no menu offer for a list nobody publishes", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    const other = await run((tx) =>
      createExtraList(tx, { name: "Sauces", items: [{ productId: ids.ham }] }, "en"),
    );
    await run((tx) => setMenuItemExtraLists(tx, offers.burger, [{ listId: other.id, items: [] }]));

    expect(await run((tx) => extraListDependants(tx, list.id))).toEqual({
      products: [],
      menus: [],
    });
  });

  it("takes the publication and its overrides with it when the list is deleted", async () => {
    const list = await run((tx) => createExtraList(tx, toppings(), "en"));
    await run((tx) =>
      setMenuItemExtraLists(tx, offers.burger, [
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

/**
 * The walkthrough that answers to drizzle/0009_menu_extra_publication_grants.sql, the sibling of
 * extras.test.ts's for drizzle/0005_extra_lists_grants.sql. Every other test in this file runs as
 * PGlite's superuser, which holds every privilege and so proves nothing about a grant.
 *
 * Seen red rather than assumed, once per table, because a grant on one of them proves nothing about
 * the other. With `DELETE` revoked on `menu_item_extra_lists` this walkthrough failed at
 * `delete from "menu_item_extra_lists" where "menu_item_extra_lists"."menu_item_id" = $1`; with it
 * revoked on `menu_item_extra_items` alone it failed inside `dropStaleMenuOverrides` (extras.ts)
 * instead. Both said `42501 permission denied for table <that table>`, and both passed with the
 * grant put back.
 */
describe("publishing on a menu offer as the non-superuser application role", () => {
  const app = <T>(fn: (tx: Transaction) => Promise<T>) =>
    withTransaction(fx.db, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });

  const baconPrice = (published: Awaited<ReturnType<typeof readMenuExtras>>) =>
    published.get(offers.burger)![0]!.items.find((item) => item.productId === ids.bacon)!.price;

  it("publishes, reads, reprices and clears under the application role's grants", async () => {
    await app(async (tx) => {
      const role = await tx.execute<{ role: string; superuser: boolean }>(
        sql`select current_user as role, rolsuper as superuser from pg_roles where rolname = current_user`,
      );
      expect(role.rows).toEqual([{ role: "app_user", superuser: false }]);

      const list = await createExtraList(tx, toppings(), "en");
      // INSERT on both tables: the publication row, and the override under it.
      await setMenuItemExtraLists(tx, offers.burger, [
        { listId: list.id, items: [{ productId: ids.bacon, price: "1.00" }] },
      ]);
      // SELECT on both tables.
      expect(baconPrice(await readMenuExtras(tx, [offers.burger]))).toBe("1.00");

      // UPDATE is granted and no write path reaches it today — `setMenuItemExtraLists` replaces
      // rows rather than editing them — so it is walked by statement, which is the only way to
      // establish the role actually holds what the migration granted it.
      await tx.execute(
        sql`update menu_item_extra_lists set display_order = 1 where menu_item_id = ${offers.burger}`,
      );
      await tx.execute(
        sql`update menu_item_extra_items set price = '1.50' where menu_item_id = ${offers.burger}`,
      );
      expect(baconPrice(await readMenuExtras(tx, [offers.burger]))).toBe("1.50");

      // DELETE on `menu_item_extra_items`, walked as its own step because nothing else here
      // reaches it: dropping bacon from the LIST makes `dropStaleMenuOverrides` (extras.ts) issue a
      // delete on that table under this role, and that is the only place in this PACKAGE that
      // deletes from it. The configuration-transfer import clears the whole table too
      // (apps/server/src/configuration-transfer.ts), but as the table owner, so it walks no grant.
      await updateExtraList(
        tx,
        list.id,
        { ...toppings(), items: toppings().items.filter((item) => item.productId !== ids.bacon) },
        "en",
      );
      const overrides = await tx.execute<{ count: number }>(
        sql`select count(*)::int as count from menu_item_extra_items`,
      );
      expect(overrides.rows).toEqual([{ count: 0 }]);

      // DELETE on `menu_item_extra_lists`: republishing the offer as empty removes its publication
      // row. Whatever override rows sat under it go by `menu_item_extra_items_list_fk`'s ON DELETE
      // CASCADE, and a CASCADE is not checked against this role, so this statement leaves the child
      // table's own `DELETE` grant unwalked. That is why the step above exists: without it, and with
      // `DELETE` revoked on `menu_item_extra_items`, this walkthrough passed whole.
      await setMenuItemExtraLists(tx, offers.burger, []);
      expect(await readMenuExtras(tx, [offers.burger])).toEqual(new Map());
    });
  });
});
