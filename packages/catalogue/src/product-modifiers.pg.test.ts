import { beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, withTransaction, type Database, type Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { createCatalogue, createProduct } from "./operations.js";
import { createExtraList, deleteExtraList } from "./extras.js";
import { createOptionList, deleteOptionList } from "./options.js";
import { readProductModifiers, writeProductModifiers } from "./product-modifiers.js";
import type { ProductModifierRef } from "./product-types.js";

// A saved attachment list racing a DELETE of one of the lists it names — three transactions in
// flight at once, two of them holding row locks the third has to wait for. PGlite serialises every
// query onto its single backend, so the same suite there is a false pass (CLAUDE.md §4): nothing on
// it can hold a row lock while another statement runs. The rest of this module's behaviour does not
// turn on who connected or on two writers racing, and stays on PGlite in
// product-modifiers.test.ts.

const suite = useTemplateDb({ template: "core" });

function app<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** A promise plus the function that settles it — the barrier below is built from one of these. */
function latch(): { waited: Promise<void>; open: () => void } {
  let open!: () => void;
  const waited = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { waited, open };
}

/**
 * The domain code a call was refused with — or, when the failure came from the database rather than
 * from the code, that failure's SQLSTATE. drizzle wraps a driver error in a `Failed query:` error
 * that carries no `code` of its own and keeps the original on `cause`, so reading `code` alone
 * reports `undefined` for exactly the failure this file exists to catch (`40P01`). Same reader
 * extras.pg.test.ts uses.
 */
function refusalCode(reason: unknown): unknown {
  const error = reason as { code?: unknown; cause?: { code?: unknown } };
  return error.code ?? error.cause?.code ?? reason;
}

/**
 * How many backends on THIS database are blocked on a heavyweight lock. The case below reads it to
 * know a transaction has REACHED the statement it is meant to stop at, rather than sleeping for a
 * guessed interval. Taken on `suite.admin`, which is a pool, so it has an idle client of its own
 * while the three connections below sit in open transactions.
 */
async function lockWaiters(): Promise<number> {
  const rows = await suite.admin.execute<{ waiting: number }>(sql`
    select count(*)::int as waiting
    from pg_stat_activity
    where datname = current_database() and wait_event_type = 'Lock'`);
  return rows.rows[0]!.waiting;
}

/**
 * Poll until `condition` holds, and fail by NAME rather than hang when it never does. The bound is
 * well under this package's 30s test timeout (vitest.config.ts) and is reached in milliseconds on a
 * healthy run — it is here so a choreography that stops working reports what it was waiting for.
 */
async function until(what: string, condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * The dish whose attachment list is saved, a second dish for the case that saves two products'
 * lists at once, and one product an extras list can offer.
 */
let dish = "";
let otherDish = "";
let topping = "";

// `useTemplateDb` empties every data table after each test, so the products are re-made per test.
// Created on the clone's owner connection, like the seeding in extras.pg.test.ts.
beforeEach(async () => {
  await withTransaction(suite.admin, async (tx) => {
    const catalogue = await createCatalogue(tx, { name: "Deli" });
    const make = async (name: string, unitPrice: string) =>
      (
        await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: null,
          name,
          unitId: null,
          unitPrice,
          vatClass: "reduced",
        })
      ).id;
    dish = await make("sandwich", "7.00");
    otherDish = await make("salad", "6.00");
    topping = await make("sourdough", "2.50");
  });
});

/**
 * Two lists of one kind, and the delete that removes one of them. An ACTIVE extras list must offer
 * at least one product and an active options list at least one label (`parseExtraListInput`,
 * `parseOptionListInput`), so each list is created with one.
 */
async function makeLists(kind: ProductModifierRef["kind"]): Promise<{
  target: string;
  other: string;
  remove: (tx: Transaction, id: string) => Promise<void>;
}> {
  if (kind === "extras") {
    const lists = await withTransaction(suite.admin, async (tx) => {
      // Awaited in turn, never Promise.all: they share one transaction (CLAUDE.md §3).
      const target = await createExtraList(
        tx,
        { name: "Bread", items: [{ productId: topping }] },
        "en",
      );
      const other = await createExtraList(
        tx,
        { name: "Sides", items: [{ productId: topping }] },
        "en",
      );
      return { target: target.id, other: other.id };
    });
    return { ...lists, remove: deleteExtraList };
  }
  const lists = await withTransaction(suite.admin, async (tx) => {
    const target = await createOptionList(
      tx,
      { name: "Doneness", labels: [{ name: "rare" }] },
      "en",
    );
    const other = await createOptionList(tx, { name: "Dressing", labels: [{ name: "oil" }] }, "en");
    return { target: target.id, other: other.id };
  });
  return { ...lists, remove: deleteOptionList };
}

/**
 * A save of the dish's attachment list, overlapping a DELETE of one of the lists it names.
 *
 * The choreography, and why each step is where it is. The dish starts out carrying two lists, the
 * TARGET first — `writeProductModifiers` numbers `sort` from the body's order and inserts in that
 * order, so the target's attachment row is both the first row of the index the delete uses and the
 * first row on the heap, which is what makes "the save locks the target's row and then stops" the
 * only possible outcome of the step below rather than a coin toss.
 *
 * 1. A BLOCKER transaction holds the OTHER list's attachment row with `for update`. It is never
 *    part of the cycle; it is what parks the save at a chosen point instead of a guessed one.
 * 2. The SAVE replaces the dish's list with the target alone. It stops inside its delete, on the
 *    row the blocker holds.
 * 3. The DELETE of the target list starts, and stops too — on the list row the save holds, or on
 *    the attachment row the save holds, depending on which of them the save took first. Both
 *    worlds show two waiters here, so this same script runs either way.
 * 4. The blocker releases, and one of two things happens. Each transaction waiting on a lock the
 *    other holds is `40P01 deadlock detected`, which is what this file was written for. Otherwise
 *    both finish, and the save commits first because the delete is the one waiting on it.
 */
async function raceSaveAgainstDelete(kind: ProductModifierRef["kind"]): Promise<unknown[]> {
  const { target, other, remove } = await makeLists(kind);
  await app(suite.admin, (tx) =>
    writeProductModifiers(tx, dish, [
      { kind, id: target },
      { kind, id: other },
    ]),
  );
  const column = kind === "extras" ? sql`extra_list_id` : sql`option_list_id`;

  const [writer, deleter, blocker] = await Promise.all([
    suite.pg.connect(),
    suite.pg.connect(),
    suite.pg.connect(),
  ]);
  const release = latch();
  let held: Promise<unknown> | undefined;
  let saving: Promise<unknown> | undefined;
  let deleting: Promise<unknown> | undefined;
  try {
    held = withTransaction(blocker, async (tx) => {
      await tx.execute(
        sql`select 1 from product_modifiers where product_id = ${dish} and ${column} = ${other} for update`,
      );
      await release.waited;
    });
    // Nothing else in this transaction: the save under test is the whole of it, exactly as a route
    // handler runs it.
    saving = app(writer, (tx) => writeProductModifiers(tx, dish, [{ kind, id: target }]));
    await until(
      "the save to reach the row the blocker holds",
      async () => (await lockWaiters()) >= 1,
    );

    deleting = app(deleter, (tx) => remove(tx, target));
    await until("the list delete to block as well", async () => (await lockWaiters()) >= 2);

    release.open();
    const settled = await Promise.allSettled([saving, deleting]);
    return settled.map((outcome) =>
      outcome.status === "rejected" ? refusalCode(outcome.reason) : "done",
    );
  } finally {
    release.open();
    await Promise.allSettled([saving, deleting, held]);
    await Promise.all([writer.close(), deleter.close(), blocker.close()]);
  }
}

// Measured against the code as it stood before `assertRefsExist` took the referenced list rows'
// locks: both kinds reported `40P01 deadlock detected` for one of the two transactions. The save
// had the target's ATTACHMENT row and wanted the LIST row for its insert's foreign key, while the
// delete had the LIST row and wanted that same attachment row for its cascade. The exact output is
// in the branch's review thread.
it.each(["extras", "options"] as const)(
  "saves a product's %s attachment list while one of its lists is being deleted, without deadlocking",
  async (kind) => {
    expect(await raceSaveAgainstDelete(kind)).toEqual(["done", "done"]);

    // The save commits first — the delete is the one waiting on it — and the delete then takes the
    // row the save just wrote with it, through `product_modifiers`' cascade on the list key. The
    // other list's attachment row is gone because the save's body did not name it.
    const after = await app(suite.admin, (tx) => readProductModifiers(tx, [dish]));
    expect(after).toEqual(new Map());
  },
);

/**
 * The lock the save takes on each list it names is SHARED, and this is what says so. One
 * transaction saves the sandwich's list and stays OPEN, holding that list's row; a second saves
 * the salad's list, naming the same list, and must not wait for it. Run with `lockList`'s strength
 * changed from `key share` to `update` (product-modifiers.ts), the second save never finishes and
 * this case fails on its own deadline — so the choice has a negative control rather than a claim
 * read off PostgreSQL's lock-conflict table.
 */
it("lets two products attach the same list at once, without either waiting for the other", async () => {
  const { target } = await makeLists("extras");

  const [first, second] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  const release = latch();
  let holding: Promise<unknown> | undefined;
  let saved = false;
  let saving: Promise<unknown> | undefined;
  try {
    holding = app(first, async (tx) => {
      await writeProductModifiers(tx, dish, [{ kind: "extras", id: target }]);
      await release.waited;
    });
    // The first save has run every one of its statements — the list lock included — and is now
    // sitting on the latch with its transaction still open, so the row locks it took are still
    // held. Its rows are invisible from here until it commits, which is why the wait is on the
    // backend's state rather than on a read of the table.
    await until(
      "the first save to finish its statements with its transaction still open",
      async () => {
        const activity = await suite.admin.execute<{ idle: number }>(sql`
          select count(*)::int as idle
          from pg_stat_activity
          where datname = current_database() and state = 'idle in transaction'`);
        return activity.rows[0]!.idle >= 1;
      },
    );

    saving = app(second, (tx) =>
      writeProductModifiers(tx, otherDish, [{ kind: "extras", id: target }]),
    ).then(() => {
      saved = true;
    });
    await until("the second product's save to finish while the first holds the list", async () => {
      await Promise.race([saving, new Promise((resolve) => setTimeout(resolve, 20))]);
      return saved;
    });
    expect(saved).toBe(true);

    release.open();
    await Promise.all([holding, saving]);
  } finally {
    release.open();
    await Promise.allSettled([holding, saving]);
    await Promise.all([first.close(), second.close()]);
  }

  const after = await app(suite.admin, (tx) => readProductModifiers(tx, [dish, otherDish]));
  expect(after).toEqual(
    new Map([
      [dish, [{ kind: "extras", id: target }]],
      [otherDish, [{ kind: "extras", id: target }]],
    ]),
  );
});
