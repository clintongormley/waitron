import { beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, withTransaction, type Database, type Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { createCatalogue, createProduct } from "./operations.js";
import { createExtraList, getExtraList, updateExtraList } from "./extras.js";

// Two saves have to be in flight at once for the first two tests to mean anything, and PGlite
// serialises every query onto its single backend, so the same suite there is a false pass
// (CLAUDE.md §4). The last test would run on PGlite; it is here because it shares this file's
// product fixture with the others, and because a real backend is where the unique index it is about
// was first seen to fire.
const suite = useTemplateDb({ template: "core" });

function app<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** A promise plus the function that settles it — the two barriers below are built from these. */
function latch(): { waited: Promise<void>; open: () => void } {
  let open!: () => void;
  const waited = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { waited, open };
}

/**
 * The domain code a save was refused with — or, when the failure came from the database rather than
 * from the code, that failure's SQLSTATE. drizzle wraps a driver error in a `Failed query:` error
 * that carries no `code` of its own and keeps the original on `cause`, so reading `code` alone
 * reports `undefined` for exactly the failure this test exists to catch.
 */
function refusalCode(reason: unknown): unknown {
  const error = reason as { code?: unknown; cause?: { code?: unknown } };
  return error.code ?? error.cause?.code ?? reason;
}

/** The two products the lists below offer. Ids, filled by the setup that creates the rows. */
const breads: { sourdough: string; rye: string } = { sourdough: "", rye: "" };

// `useTemplateDb` empties every data table after each test, so the products are re-made per test.
// Created on the clone's owner connection, like the seeding in extras.test.ts.
beforeEach(async () => {
  await withTransaction(suite.admin, async (tx) => {
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
  });
});

it("refuses both of two saves that each claim the other list's item, without deadlocking", async () => {
  const lists = await app(suite.admin, async (tx) => {
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

  const [left, right] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  const arrived = [latch(), latch()];
  const go = latch();
  // A save that names an item of another list. No customer-facing name on the body, so
  // `validateNames` reads nothing and the race is over the item tables alone.
  const claim = (
    db: Database,
    mine: { id: string; name: string },
    theirItemId: string,
    productId: string,
    ready: () => void,
  ) =>
    app(db, async (tx) => {
      // Both transactions are open and both have taken a statement's round trip before either
      // starts saving. That is what makes the two saves overlap rather than run in sequence: the
      // version this guards against takes its row locks inside `updateExtraList`, and with the saves
      // in sequence the second one never reaches an uncommitted delete to wait on.
      await tx.execute(sql`select 1`);
      ready();
      await go.waited;
      return updateExtraList(
        tx,
        mine.id,
        { name: mine.name, items: [{ id: theirItemId, productId }] },
        "en",
      );
    });

  let attempts: Promise<unknown>[] = [];
  try {
    attempts = [
      claim(left, lists.bread, lists.sides.items[0]!.id, breads.sourdough, arrived[0]!.open),
      claim(right, lists.sides, lists.bread.items[0]!.id, breads.rye, arrived[1]!.open),
    ];
    // Racing the attempts so a save that throws before reaching its barrier surfaces its own error
    // rather than hanging the test on a latch nothing will open.
    await Promise.race([Promise.all([arrived[0]!.waited, arrived[1]!.waited]), ...attempts]);
    go.open();
    const settled = await Promise.allSettled(attempts);

    // Both saves are refused, and neither caller gets a database failure instead. Run against a copy
    // of extras.ts whose `writeItems` drops the ownership check and leaves a stolen id to the
    // insert's conflict, this line read `40P01 deadlock detected` for one of the two saves in every
    // one of five runs (which of the two varied); against the code as it stands it passed five runs
    // out of five.
    expect(
      settled.map((outcome) =>
        outcome.status === "rejected" ? refusalCode(outcome.reason) : "no refusal at all",
      ),
    ).toEqual(["extras.invalid", "extras.invalid"]);
    for (const outcome of settled)
      if (outcome.status === "rejected")
        expect(outcome.reason).toMatchObject({ params: { field: "items.0.id" } });

    const after = await app(suite.admin, async (tx) => {
      const bread = await getExtraList(tx, lists.bread.id);
      const sides = await getExtraList(tx, lists.sides.id);
      return { bread, sides };
    });
    expect(after).toEqual(lists);
  } finally {
    go.open();
    await Promise.allSettled(attempts);
    await Promise.all([left.close(), right.close()]);
  }
});

it("keeps the later of two overlapping saves of the same list, and refuses neither", async () => {
  const created = await app(suite.admin, (tx) =>
    createExtraList(tx, { name: "Bread", items: [{ productId: breads.sourdough }] }, "en"),
  );

  const [left, right] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  const arrived = [latch(), latch()];
  const go = latch();
  // The order the two transactions COMMITTED in, appended as each save's promise settles — which is
  // after its `commit` came back. Which of the two gets there first is the database's choice, so the
  // assertion below reads this rather than naming a winner in advance.
  const committed: string[] = [];
  // Both bodies replace the list's one item with an item for the SAME product under a NEW id, so
  // whichever save runs second has to remove the other's row before inserting its own, and a save
  // that removes nothing collides on `extra_list_items_list_product_uq`. The price is what tells the
  // two survivors apart. No customer-facing name on either body, so `validateNames` reads nothing
  // and the race is over the list and item tables alone.
  const save = (db: Database, price: string, ready: () => void) =>
    app(db, async (tx) => {
      // Both transactions are open and both have taken a statement's round trip before either
      // starts saving, so the two saves overlap rather than run in sequence.
      await tx.execute(sql`select 1`);
      ready();
      await go.waited;
      return updateExtraList(
        tx,
        created.id,
        { name: "Bread", items: [{ productId: breads.rye, price }] },
        "en",
      );
    }).then((list) => {
      committed.push(price);
      return list;
    });

  let attempts: Promise<unknown>[] = [];
  try {
    attempts = [save(left, "9.99", arrived[0]!.open), save(right, "1.11", arrived[1]!.open)];
    // Racing the attempts so a save that throws before reaching its barrier surfaces its own error
    // rather than hanging the test on a latch nothing will open.
    await Promise.race([Promise.all([arrived[0]!.waited, arrived[1]!.waited]), ...attempts]);
    go.open();
    const settled = await Promise.allSettled(attempts);

    // Neither caller is refused, and in particular neither gets a database failure: a `23505` on the
    // product index escapes `writeItems` as a drizzle `Failed query:` error carrying no `code`, and
    // the server answers that as an opaque 500. What this line guards is `lockExtraList`, and it
    // passed before that lock existed, because `updateExtraList`'s own `update` of the list row ran
    // first and serialised the two saves by accident. Removing the lock AND moving that `update`
    // after `writeItems` made this read `["saved", "23505"]`; putting the lock back, with the
    // `update` still moved, made it green again.
    expect(
      settled.map((outcome) =>
        outcome.status === "rejected" ? refusalCode(outcome.reason) : "saved",
      ),
    ).toEqual(["saved", "saved"]);

    // One item, the later save's, and no trace of the earlier one's row.
    const after = await app(suite.admin, (tx) => getExtraList(tx, created.id));
    expect(after.items.map((item) => [item.productId, item.price])).toEqual([
      [breads.rye, committed.at(-1)],
    ]);
  } finally {
    go.open();
    await Promise.allSettled(attempts);
    await Promise.all([left.close(), right.close()]);
  }
});

it("saves a body that exchanges two retained items' products", async () => {
  const created = await app(suite.admin, (tx) =>
    createExtraList(
      tx,
      { name: "Bread", items: [{ productId: breads.sourdough }, { productId: breads.rye }] },
      "en",
    ),
  );
  const [first, second] = [created.items[0]!, created.items[1]!];

  // The body's final products are one sourdough and one rye, which `extra_list_items_list_product_uq`
  // allows; only an intermediate state where both rows briefly hold the same product breaks it.
  const updated = await app(suite.admin, (tx) =>
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
