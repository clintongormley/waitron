import { beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCatalogue, addProductToMenu, createProduct } from "./operations.js";
import { createExtraList, getExtraList, setMenuItemExtraLists, updateExtraList } from "./extras.js";
import { readMenuExtras } from "./extra-projection.js";
import { writeProductModifiers } from "./product-modifiers.js";
import { racePair } from "../test/fixtures.js";

/**
 * Two saves of an extras list started together (through `racePair`, test/fixtures.ts), the
 * item-exchanging save the delete-then-insert exists for, and a list item whose product has gone.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

/** The domain code a save was refused with, else its cause's code, else the error itself. */
function refusalCode(reason: unknown): unknown {
  const error = reason as { code?: unknown; cause?: { code?: unknown } };
  return error.code ?? error.cause?.code ?? reason;
}

/** The two products the lists below offer, filled by the setup. */
const breads: { sourdough: string; rye: string } = { sourdough: "", rye: "" };
/** The one menu offer the publication tests save against — a sandwich, in one section. */
let offer = "";
/** The sandwich itself. `setMenuItemExtraLists` refuses a list this product does not carry. */
let dish = "";

// `useVenueDb` empties every data table after each test, so the products are re-made per test.
beforeEach(async () => {
  await withTransaction(suite.db, async (tx) => {
    const catalogue = await createCatalogue(tx, { name: "Deli" });
    for (const [key, unitPrice] of Object.entries({ sourdough: "2.50", rye: "3.25" })) {
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: null,
        name: key,
        unitId: null,
        unitPrice,
        vatClass: "reduced",
      });
      breads[key as keyof typeof breads] = product.id;
    }
    dish = (
      await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: null,
        name: "sandwich",
        unitId: null,
        unitPrice: "7.00",
        vatClass: "reduced",
      })
    ).id;
    const menuItem = await addProductToMenu(tx, {
      menuId: catalogue.id,
      productId: dish,
      grossPrice: "7.00",
    });
    offer = menuItem.id;
  });
});

/** The sandwich carries this list, which `setMenuItemExtraLists` requires before it publishes. */
const carries = (tx: Transaction, listId: string) =>
  writeProductModifiers(tx, dish, [{ kind: "extras", id: listId }]);

it("refuses both of two saves that each claim the other list's item", async () => {
  const lists = await withTransaction(suite.db, async (tx) => {
    // Awaited in turn, never Promise.all: they share one transaction (CLAUDE.md §3).
    const bread = await createExtraList(
      tx,
      { name: "Bread", items: [{ productId: breads.sourdough }] },
      "en",
    );
    const sides = await createExtraList(
      tx,
      { name: "Sides", items: [{ productId: breads.rye }] },
      "en",
    );
    return { bread, sides };
  });

  // A save that names an item of another list.
  const claim =
    (mine: { id: string; name: string }, theirItemId: string, productId: string) =>
    (tx: Transaction) =>
      updateExtraList(
        tx,
        mine.id,
        { name: mine.name, items: [{ id: theirItemId, productId }] },
        "en",
      );

  const settled = await racePair(
    suite.db,
    claim(lists.bread, lists.sides.items[0]!.id, breads.sourdough),
    claim(lists.sides, lists.bread.items[0]!.id, breads.rye),
  );

  // Both saves are refused, and neither caller gets a database failure instead.
  expect(
    settled.map((outcome) =>
      outcome.status === "rejected" ? refusalCode(outcome.reason) : "no refusal at all",
    ),
  ).toEqual(["extras.invalid", "extras.invalid"]);
  for (const outcome of settled)
    if (outcome.status === "rejected")
      expect(outcome.reason).toMatchObject({ params: { field: "items.0.id" } });

  const after = await withTransaction(suite.db, async (tx) => {
    const bread = await getExtraList(tx, lists.bread.id);
    const sides = await getExtraList(tx, lists.sides.id);
    return { bread, sides };
  });
  expect(after).toEqual(lists);
});

it("keeps the later of two overlapping saves of the same list, and refuses neither", async () => {
  const created = await withTransaction(suite.db, (tx) =>
    createExtraList(tx, { name: "Bread", items: [{ productId: breads.sourdough }] }, "en"),
  );

  // The order the two saves COMMITTED in, appended as each body finishes.
  const committed: string[] = [];
  // Both bodies replace the list's one item with an item for the SAME product under a NEW id, so
  // whichever save runs second has to remove the other's row before inserting its own, or collide on
  // `extra_list_items_list_product_uq`. The price tells the two survivors apart.
  const save = (price: string) => async (tx: Transaction) => {
    const list = await updateExtraList(
      tx,
      created.id,
      { name: "Bread", items: [{ productId: breads.rye, price }] },
      "en",
    );
    committed.push(price);
    return list;
  };

  const settled = await racePair(suite.db, save("9.99"), save("1.11"));

  expect(
    settled.map((outcome) =>
      outcome.status === "rejected" ? refusalCode(outcome.reason) : "saved",
    ),
  ).toEqual(["saved", "saved"]);

  // One item, the later save's, and no trace of the earlier one's row.
  const after = await withTransaction(suite.db, (tx) => getExtraList(tx, created.id));
  expect(after.items.map((item) => [item.productId, item.price])).toEqual([
    [breads.rye, committed.at(-1)],
  ]);
});

it("saves a body that exchanges two retained items' products", async () => {
  const created = await withTransaction(suite.db, (tx) =>
    createExtraList(
      tx,
      { name: "Bread", items: [{ productId: breads.sourdough }, { productId: breads.rye }] },
      "en",
    ),
  );
  const [first, second] = [created.items[0]!, created.items[1]!];

  // The body's final products are one sourdough and one rye, which `extra_list_items_list_product_uq`
  // allows; only an intermediate state where both rows briefly hold the same product breaks it.
  const updated = await withTransaction(suite.db, (tx) =>
    updateExtraList(
      tx,
      created.id,
      {
        name: "Bread",
        items: [
          { id: first.id, productId: breads.rye },
          { id: second.id, productId: breads.sourdough },
        ],
      },
      "en",
    ),
  );

  expect(updated.items.map((item) => [item.id, item.productId])).toEqual([
    [first.id, breads.rye],
    [second.id, breads.sourdough],
  ]);
});

it("leaves out a list item whose product has gone", async () => {
  await withTransaction(suite.db, async (tx) => {
    // Sourdough carries no price of its own, so the menu view has to go to its `products` row for
    // one; rye carries 1.00 and needs no such read, which is what makes it the control here.
    const created = await createExtraList(
      tx,
      {
        name: "Bread",
        items: [{ productId: breads.sourdough }, { productId: breads.rye, price: "1.00" }],
      },
      "en",
    );
    await carries(tx, created.id);
    await setMenuItemExtraLists(tx, offer, [{ listId: created.id, items: [] }]);
  });

  // The product key is `ON DELETE RESTRICT`, so the state is written with foreign keys off.
  suite.db.execute(sql`pragma foreign_keys = off`);
  try {
    suite.db.execute(sql`delete from products where id = ${breads.sourdough}`);
  } finally {
    suite.db.execute(sql`pragma foreign_keys = on`);
  }

  const published = await withTransaction(suite.db, (tx) => readMenuExtras(tx, [offer]));

  // An item nothing can price cannot be sold, so it is not offered — never present with `undefined`
  // where the type promises a price.
  const items = published.get(offer)![0]!.items;
  expect(items.map((item) => [item.productId, item.price])).toEqual([[breads.rye, "1.00"]]);
  expect(items.every((item) => typeof item.price === "string")).toBe(true);
});
