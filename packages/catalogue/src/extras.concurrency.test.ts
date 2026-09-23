import { beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCatalogue, createMenuItem, createMenuSection, createProduct } from "./operations.js";
import { createExtraList, getExtraList, setMenuItemExtraLists, updateExtraList } from "./extras.js";
import { readMenuExtras } from "./extra-projection.js";
import { writeProductModifiers } from "./product-modifiers.js";
import { racePair } from "../test/fixtures.js";

/**
 * Two saves of an extras list started together, and one case about the STATE a torn read used to
 * leave behind.
 *
 * This file replaces a real-PostgreSQL suite that took two and three pooled connections, held rows
 * `for update` from outside the code under test, and polled `pg_stat_activity` for a backend
 * waiting on a lock. None of that exists here: one connection per file, no row locks, and one write
 * transaction at a time (`racePair` in `test/fixtures.ts` carries the mechanism, the measurement
 * and the control). The two save races below keep every assertion they carried.
 *
 * TWO CASES WENT, and neither can be staged on this engine:
 *
 *  - "does not keep a menu price for a product the list stopped offering while it was saving"
 *    needed a THIRD transaction holding the offer's publication row so that a publish stopped
 *    between its membership read and its override write, and a list edit then slipped into that
 *    window. A write transaction cannot be interrupted by another writer here. What it asserted
 *    about the final state — a stale override does not survive the product leaving and rejoining
 *    the list — is `extra-projection.test.ts`'s "a menu override whose product leaves the list"
 *    pair, which reaches it without a race.
 *  - the third overlapping case, about the ordering of `assertPublishedListsExist`'s locks, went
 *    with the locks; `extras.ts` says what replaced them.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

/**
 * The domain code a save was refused with — or, when the failure came from the database rather than
 * from the code, the error itself. Drizzle wraps a driver error in a `Failed query:` error that
 * carries no `code` of its own and keeps the original on `cause`, so reading `code` alone reports
 * `undefined` for exactly the failure this test exists to catch.
 */
function refusalCode(reason: unknown): unknown {
  const error = reason as { code?: unknown; cause?: { code?: unknown } };
  return error.code ?? error.cause?.code ?? reason;
}

/** The two products the lists below offer. Ids, filled by the setup that creates the rows. */
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
    const section = await createMenuSection(tx, { menuId: catalogue.id, name: { en: "Mains" } });
    const menuItem = await createMenuItem(tx, {
      menuId: catalogue.id,
      productId: dish,
      sectionId: section.id,
      grossPrice: "7.00",
    });
    offer = menuItem.id;
  });
});

/**
 * The sandwich carries this list. `setMenuItemExtraLists` refuses to publish a list the offer's
 * product does not carry (`assertProductCarries`, extras.ts), so a test that publishes has to say
 * what the dish carries first — the step `carries` takes in extra-projection.test.ts.
 */
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

  // A save that names an item of another list. No customer-facing name on the body, so
  // `validateNames` reads nothing and the race is over the item tables alone.
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

  // Both saves are refused, and neither caller gets a database failure instead. On PostgreSQL, run
  // against a copy of extras.ts whose `writeItems` drops the ownership check and leaves a stolen id
  // to the insert's conflict, this line read `40P01 deadlock detected` for one of the two saves.
  // That is not a shape one writer can produce; what still catches the same defect is the last
  // assertion, which reads both lists back unchanged.
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

  // The order the two saves COMMITTED in, appended as each body finishes. On PostgreSQL which of
  // the two got there first was the database's choice; the write queue runs them in start order,
  // so this now records a fact rather than discovering one — the assertion still reads it rather
  // than naming a winner in advance.
  const committed: string[] = [];
  // Both bodies replace the list's one item with an item for the SAME product under a NEW id, so
  // whichever save runs second has to remove the other's row before inserting its own, and a save
  // that removes nothing collides on `extra_list_items_list_product_uq`. The price is what tells the
  // two survivors apart. No customer-facing name on either body, so `validateNames` reads nothing
  // and the race is over the list and item tables alone.
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

  // Neither caller is refused, and in particular neither gets a database failure: a unique-index
  // collision on the product index escapes `writeItems` as a drizzle `Failed query:` error carrying
  // no `code`, and the server answers that as an opaque 500.
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

  // **HOW THIS STATE IS REACHED CHANGED; WHAT IT ASSERTS DID NOT.** On PostgreSQL the item row
  // outliving its product was produced by TEARING `readMenuExtras`'s two statements apart: the
  // suite took an ACCESS EXCLUSIVE lock on `products` to stop the second statement, deleted the
  // item and the product in the gap, and let the read finish. Neither half of that is available —
  // SQLite has no table-level lock statement, and a read taken inside `withTransaction` holds the
  // venue file's write queue, so no writer can commit between two of its statements at all.
  //
  // The state is written directly instead: `extra_list_items_product_fk` is `ON DELETE RESTRICT`,
  // so the product delete is refused while foreign keys are on (measured: `FOREIGN KEY constraint
  // failed`, errcode 1811), and with them off for the two statements it leaves the item row
  // pointing at nothing. That is the row `readMenuExtras` met mid-read, handed to it whole.
  suite.db.execute(sql`pragma foreign_keys = off`);
  try {
    suite.db.execute(sql`delete from products where id = ${breads.sourdough}`);
  } finally {
    suite.db.execute(sql`pragma foreign_keys = on`);
  }

  const published = await withTransaction(suite.db, (tx) => readMenuExtras(tx, [offer]));

  // An item nothing can price cannot be sold, so it is not offered. What must never happen is the
  // shape this test was written for: the item present with `undefined` where the type promises a
  // price, which a till would put on a line and a fiscal record.
  const items = published.get(offer)![0]!.items;
  expect(items.map((item) => [item.productId, item.price])).toEqual([[breads.rye, "1.00"]]);
  expect(items.every((item) => typeof item.price === "string")).toBe(true);
});
