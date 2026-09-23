import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  captureError,
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  isPgError,
  newId,
  pgErrorMessage,
  refusalOn,
  UNIQUE_VIOLATION,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCatalogue, createProduct } from "./operations.js";
import { createExtraList } from "./extras.js";
import { createOptionList } from "./options.js";
import { readProductModifiers, writeProductModifiers } from "./product-modifiers.js";
import { CATALOGUE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

// One SQLite file with the real migrations applied. There is one writer on this engine and there
// are no roles, so neither the container twin this file used to name nor the grants walkthrough it
// used to end with has anything left to run — both are gone, and the commit message says what each
// proved.
//
// Every raw `insert into product_modifiers` below supplies its own `id`. The column's value comes
// from the table's `$defaultFn`, which drizzle runs per insert and a raw statement never reaches,
// so without it the row is refused `NOT NULL constraint failed: product_modifiers.id` — the wrong
// refusal for every case here. Raw rather than through the table because what these cases prove is
// what the DATABASE refuses, for a write that goes through no write path at all.
const fx = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS], timeoutMs: 60_000 });
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
const refusal = (fn: (tx: Transaction) => Promise<unknown>) => captureError(() => run(fn));

const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

/**
 * Two dishes, two products an extras list offers, and two lists of each kind, re-made per test:
 * `useVenueDb` empties every data table after each test, so the ids are minted fresh each time.
 * Every fixture carries DIFFERENT text so a read that picks up the wrong row is visible
 * (CLAUDE.md §4). Products are created with `unitId: null` and `categoryId: null` so nothing else
 * points at them, which is what lets the product-delete case below name the one key it is about.
 */
const dishes: { burger: string; salad: string } = { burger: "", salad: "" };
const toppings: { bacon: string; aioli: string } = { bacon: "", aioli: "" };
const extras: { breads: string; sauces: string } = { breads: "", sauces: "" };
const options: { doneness: string; dressing: string } = { doneness: "", dressing: "" };

beforeEach(async () => {
  await seedTenant(fx.db);
  await run(async (tx) => {
    const catalogue = await createCatalogue(tx, { name: "Deli" });
    const product = async (name: string, unitPrice: string) =>
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
    dishes.burger = await product("burger", "9.50");
    dishes.salad = await product("salad", "7.25");
    toppings.bacon = await product("bacon", "1.50");
    toppings.aioli = await product("aioli", "0.75");
    // An ACTIVE extras list must offer at least one product (`parseExtraListInput`,
    // extra-contract.ts), and an active options list at least one label.
    for (const [key, productId] of [
      ["breads", toppings.bacon],
      ["sauces", toppings.aioli],
    ] as const) {
      const list = await createExtraList(tx, { name: key, items: [{ productId }] }, "en");
      extras[key] = list.id;
    }
    for (const key of ["doneness", "dressing"] as const) {
      const list = await createOptionList(tx, { name: key, labels: [{ name: key }] }, "en");
      options[key] = list.id;
    }
  });
});

describe("what the attachment table refuses", () => {
  it("refuses a row naming both an extras list and an options list", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        fx.db.execute(
          sql`insert into product_modifiers (id, product_id, extra_list_id, option_list_id)
            values (${newId()}, ${dishes.burger}, ${extras.breads}, ${options.doneness})`,
        ),
      ),
    );

    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    // A CHECK is the one refusal class SQLite names, so this half is unchanged.
    expect(pgErrorMessage(error)).toContain("product_modifiers_one_reference_ck");
  });

  it("refuses a row naming neither list", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        fx.db.execute(
          sql`insert into product_modifiers (id, product_id) values (${newId()}, ${dishes.burger})`,
        ),
      ),
    );

    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toContain("product_modifiers_one_reference_ck");
  });

  it("refuses an attachment naming a product, extras list or options list that does not exist", async () => {
    // `key` is the assertion's LABEL only. SQLite reports a foreign-key refusal as the six words
    // `FOREIGN KEY constraint failed` and names neither the constraint nor the column, so the
    // `toContain(<constraint name>)` half of this helper has no replacement the engine can supply
    // (`constraintTarget`, packages/db/src/constraint-target.ts). Each statement below carries
    // exactly one unknown id, so the class plus the statement say which key fired.
    const missing = async (statement: ReturnType<typeof sql>, key: string) => {
      const error = await captureError(() => Promise.resolve(fx.db.execute(statement)));
      expect(isPgError(error, FOREIGN_KEY_VIOLATION), key).toBe(true);
    };

    await missing(
      sql`insert into product_modifiers (id, product_id, extra_list_id)
          values (${newId()}, ${UNKNOWN_ID}, ${extras.breads})`,
      "product_modifiers_product_fk",
    );
    await missing(
      sql`insert into product_modifiers (id, product_id, extra_list_id)
          values (${newId()}, ${dishes.burger}, ${UNKNOWN_ID})`,
      "product_modifiers_extra_list_fk",
    );
    await missing(
      sql`insert into product_modifiers (id, product_id, option_list_id)
          values (${newId()}, ${dishes.burger}, ${UNKNOWN_ID})`,
      "product_modifiers_option_list_fk",
    );
  });

  /**
   * The receipt for the claim the two unique indexes rest on: a unique index treats two NULLs as
   * DIFFERENT values, so `product_modifiers_product_option_uq` constrains only the rows that carry
   * an options list, and leaves every extras-only row of the same product alone. Run rather than
   * read off the documentation — and re-run on this engine, since it is SQLite answering now.
   */
  it("lets one product carry many extras-only rows under the options-list unique index", async () => {
    fx.db.execute(
      sql`insert into product_modifiers (id, product_id, extra_list_id, sort)
          values (${newId()}, ${dishes.burger}, ${extras.breads}, 0),
                 (${newId()}, ${dishes.burger}, ${extras.sauces}, 1)`,
    );

    const rows = fx.db.execute<{ count: number }>(
      sql`select count(*) as count from product_modifiers
          where product_id = ${dishes.burger} and option_list_id is null`,
    );
    expect(rows.rows).toEqual([{ count: 2 }]);
  });

  it("refuses the same extras list attached to one product twice", async () => {
    fx.db.execute(
      sql`insert into product_modifiers (id, product_id, extra_list_id) values (${newId()}, ${dishes.burger}, ${extras.breads})`,
    );

    // `writeProductModifiers` already refuses a duplicate ref in one body; this index is what
    // enforces the same rule for a write that goes through no write path at all.
    const error = await captureError(() =>
      Promise.resolve(
        fx.db.execute(
          sql`insert into product_modifiers (id, product_id, extra_list_id) values (${newId()}, ${dishes.burger}, ${extras.breads})`,
        ),
      ),
    );

    // SQLite names the KEY that collided rather than the index, so `refusalOn` asks the question
    // the index name used to answer: which table and columns was this refused on
    // (packages/db/src/constraint-target.ts).
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "product_modifiers",
        columns: ["product_id", "extra_list_id"],
      }),
    ).toBe(true);
  });

  it("refuses the same options list attached to one product twice", async () => {
    fx.db.execute(
      sql`insert into product_modifiers (id, product_id, option_list_id) values (${newId()}, ${dishes.burger}, ${options.doneness})`,
    );

    const error = await captureError(() =>
      Promise.resolve(
        fx.db.execute(
          sql`insert into product_modifiers (id, product_id, option_list_id) values (${newId()}, ${dishes.burger}, ${options.doneness})`,
        ),
      ),
    );

    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "product_modifiers",
        columns: ["product_id", "option_list_id"],
      }),
    ).toBe(true);
  });

  it("lets two different products each carry the same list", async () => {
    fx.db.execute(
      sql`insert into product_modifiers (id, product_id, extra_list_id)
          values (${newId()}, ${dishes.burger}, ${extras.breads}),
                 (${newId()}, ${dishes.salad}, ${extras.breads})`,
    );

    const rows = fx.db.execute<{ count: number }>(
      sql`select count(*) as count from product_modifiers where extra_list_id = ${extras.breads}`,
    );
    expect(rows.rows).toEqual([{ count: 2 }]);
  });
});

describe("what deleting a parent row takes with it", () => {
  const attachmentCount = async () => {
    const rows = fx.db.execute<{ count: number }>(
      sql`select count(*) as count from product_modifiers`,
    );
    return rows.rows[0]!.count;
  };

  it("removes a product's attachments when the extras list is deleted", async () => {
    await run((tx) =>
      writeProductModifiers(tx, dishes.burger, [
        { kind: "extras", id: extras.breads },
        { kind: "options", id: options.doneness },
      ]),
    );
    expect(await attachmentCount()).toBe(2);

    await fx.db.execute(sql`delete from extra_lists where id = ${extras.breads}`);

    expect(await attachmentCount()).toBe(1);
    expect(await run((tx) => readProductModifiers(tx, [dishes.burger]))).toEqual(
      new Map([[dishes.burger, [{ kind: "options", id: options.doneness }]]]),
    );
  });

  it("removes a product's attachments when the options list is deleted", async () => {
    await run((tx) =>
      writeProductModifiers(tx, dishes.burger, [
        { kind: "extras", id: extras.breads },
        { kind: "options", id: options.doneness },
      ]),
    );

    await fx.db.execute(sql`delete from option_lists where id = ${options.doneness}`);

    expect(await attachmentCount()).toBe(1);
    expect(await run((tx) => readProductModifiers(tx, [dishes.burger]))).toEqual(
      new Map([[dishes.burger, [{ kind: "extras", id: extras.breads }]]]),
    );
  });

  it("removes a product's attachments when the product is deleted", async () => {
    await run((tx) =>
      writeProductModifiers(tx, dishes.burger, [{ kind: "extras", id: extras.breads }]),
    );
    await run((tx) =>
      writeProductModifiers(tx, dishes.salad, [{ kind: "options", id: options.dressing }]),
    );
    expect(await attachmentCount()).toBe(2);

    // Direct SQL because no route deletes a product row; the dashboard marks one unavailable
    // instead. The attachment's key is the only one of the three that is ON DELETE CASCADE from
    // `products` in this table, and the assertion below is what shows the cascade fired rather than
    // the delete being refused.
    await fx.db.execute(sql`delete from products where id = ${dishes.burger}`);

    expect(await attachmentCount()).toBe(1);
    expect(await run((tx) => readProductModifiers(tx, [dishes.salad]))).toEqual(
      new Map([[dishes.salad, [{ kind: "options", id: options.dressing }]]]),
    );
  });
});

describe("reading and writing a product's attachment list", () => {
  it("reads back the order the body was written in, extras and options mixed", async () => {
    await run((tx) =>
      writeProductModifiers(tx, dishes.burger, [
        { kind: "options", id: options.doneness },
        { kind: "extras", id: extras.sauces },
        { kind: "options", id: options.dressing },
        { kind: "extras", id: extras.breads },
      ]),
    );

    expect(await run((tx) => readProductModifiers(tx, [dishes.burger]))).toEqual(
      new Map([
        [
          dishes.burger,
          [
            { kind: "options", id: options.doneness },
            { kind: "extras", id: extras.sauces },
            { kind: "options", id: options.dressing },
            { kind: "extras", id: extras.breads },
          ],
        ],
      ]),
    );
  });

  it("reads several products in one call, keyed by product id", async () => {
    await run((tx) =>
      writeProductModifiers(tx, dishes.burger, [{ kind: "extras", id: extras.breads }]),
    );
    await run((tx) =>
      writeProductModifiers(tx, dishes.salad, [
        { kind: "options", id: options.dressing },
        { kind: "extras", id: extras.sauces },
      ]),
    );

    expect(await run((tx) => readProductModifiers(tx, [dishes.burger, dishes.salad]))).toEqual(
      new Map([
        [dishes.burger, [{ kind: "extras", id: extras.breads }]],
        [
          dishes.salad,
          [
            { kind: "options", id: options.dressing },
            { kind: "extras", id: extras.sauces },
          ],
        ],
      ]),
    );
  });

  it("leaves a product with no attachments out of the map entirely", async () => {
    await run((tx) =>
      writeProductModifiers(tx, dishes.burger, [{ kind: "extras", id: extras.breads }]),
    );

    const read = await run((tx) => readProductModifiers(tx, [dishes.burger, dishes.salad]));

    // An ABSENT key, not an empty array: the doc comment on `readProductModifiers` states it and
    // this is what pins it, because every caller reads `?? []` and would not notice either way.
    expect(read.has(dishes.salad)).toBe(false);
    expect([...read.keys()]).toEqual([dishes.burger]);
  });

  it("gives back an empty map for an empty product list", async () => {
    expect(await run((tx) => readProductModifiers(tx, []))).toEqual(new Map());
  });

  it("replaces the whole list on a second write rather than appending", async () => {
    await run((tx) =>
      writeProductModifiers(tx, dishes.burger, [
        { kind: "extras", id: extras.breads },
        { kind: "options", id: options.doneness },
      ]),
    );

    await run((tx) =>
      writeProductModifiers(tx, dishes.burger, [{ kind: "options", id: options.dressing }]),
    );

    expect(await run((tx) => readProductModifiers(tx, [dishes.burger]))).toEqual(
      new Map([[dishes.burger, [{ kind: "options", id: options.dressing }]]]),
    );
  });

  it("clears a product's list when the body is empty, and leaves another product's alone", async () => {
    await run((tx) =>
      writeProductModifiers(tx, dishes.burger, [{ kind: "extras", id: extras.breads }]),
    );
    await run((tx) =>
      writeProductModifiers(tx, dishes.salad, [{ kind: "extras", id: extras.sauces }]),
    );

    await run((tx) => writeProductModifiers(tx, dishes.burger, []));

    expect(await run((tx) => readProductModifiers(tx, [dishes.burger, dishes.salad]))).toEqual(
      new Map([[dishes.salad, [{ kind: "extras", id: extras.sauces }]]]),
    );
  });

  /**
   * This one measures the id COLUMN, not the code: a product id may arrive in either case and the
   * column settles it, so the row a write in upper case leaves behind is found by a read in lower
   * case, a second write in the other case REPLACES it rather than landing beside it (which
   * `product_modifiers_product_extra_uq` would refuse), and the map comes back keyed lower-case
   * either way.
   *
   * WHO settles it changed with the engine. It was the column: a PostgreSQL `uuid` normalises its
   * input, so the file lower-cased only the LIST ids, which it also compares in JavaScript. An id
   * is a plain `text` column here (`packages/db/src/schema/columns.ts`) and text compares byte for
   * byte, so the product id went unnormalised by anything — an upper-cased one reached
   * `product_modifiers.product_id` as a foreign key naming no product and came back as a raw
   * `FOREIGN KEY constraint failed` rather than a domain refusal. `writeProductModifiers` now
   * normalises the product id at the same boundary it normalises the list ids, which is what this
   * case is the RED for: put the id back unnormalised and the first write here fails with that
   * message.
   */
  it("settles a product id sent in upper case in the database, and keys the map lower-case", async () => {
    await run((tx) =>
      writeProductModifiers(tx, dishes.burger.toUpperCase(), [
        { kind: "extras", id: extras.breads },
      ]),
    );

    expect(await run((tx) => readProductModifiers(tx, [dishes.burger]))).toEqual(
      new Map([[dishes.burger, [{ kind: "extras", id: extras.breads }]]]),
    );
    await run((tx) =>
      writeProductModifiers(tx, dishes.burger, [{ kind: "extras", id: extras.breads }]),
    );
    expect(await run((tx) => readProductModifiers(tx, [dishes.burger.toUpperCase()]))).toEqual(
      new Map([[dishes.burger, [{ kind: "extras", id: extras.breads }]]]),
    );
  });

  it("matches a list id the caller sent in upper case", async () => {
    await run((tx) =>
      writeProductModifiers(tx, dishes.burger, [
        { kind: "extras", id: extras.breads.toUpperCase() },
      ]),
    );

    expect(await run((tx) => readProductModifiers(tx, [dishes.burger]))).toEqual(
      new Map([[dishes.burger, [{ kind: "extras", id: extras.breads }]]]),
    );
  });
});

describe("what a product's attachment write refuses", () => {
  it("refuses an extras list that does not exist, naming its position in the body", async () => {
    const error = await refusal((tx) =>
      writeProductModifiers(tx, dishes.burger, [
        { kind: "options", id: options.doneness },
        { kind: "extras", id: UNKNOWN_ID },
      ]),
    );

    expect(error).toEqual(
      expect.objectContaining({ code: "product.invalid", params: { field: "modifiers.1.id" } }),
    );
  });

  it("refuses an options list that does not exist, naming its position in the body", async () => {
    const error = await refusal((tx) =>
      writeProductModifiers(tx, dishes.burger, [{ kind: "options", id: UNKNOWN_ID }]),
    );

    expect(error).toEqual(
      expect.objectContaining({ code: "product.invalid", params: { field: "modifiers.0.id" } }),
    );
  });

  it("refuses an extras list id that names an OPTIONS list, and the other way round", async () => {
    const asExtras = await refusal((tx) =>
      writeProductModifiers(tx, dishes.burger, [{ kind: "extras", id: options.doneness }]),
    );
    expect(asExtras).toEqual(
      expect.objectContaining({ code: "product.invalid", params: { field: "modifiers.0.id" } }),
    );

    const asOptions = await refusal((tx) =>
      writeProductModifiers(tx, dishes.burger, [{ kind: "options", id: extras.breads }]),
    );
    expect(asOptions).toEqual(
      expect.objectContaining({ code: "product.invalid", params: { field: "modifiers.0.id" } }),
    );
  });

  /**
   * The refusal comes BEFORE the delete, and that is only measurable INSIDE one transaction: after
   * a rollback the caller's earlier list survives either way, because the rollback undoes the
   * delete as readily as the check prevents it. Run in one transaction, the two orders differ —
   * an `AppError` thrown from JavaScript leaves the transaction usable, so the read below still
   * answers.
   *
   * Measured, with `assertRefsExist` (product-modifiers.ts) moved to just AFTER the delete and
   * nothing else changed: this case alone went red, on the read, `expected Map{} to deeply equal
   * Map{ …(1) }` — the earlier list had already been deleted. Twenty-five of the twenty-six cases
   * here cannot see that move at all.
   */
  it("refuses before deleting anything, inside the caller's own transaction", async () => {
    await run(async (tx) => {
      await writeProductModifiers(tx, dishes.burger, [{ kind: "extras", id: extras.breads }]);

      const error = await captureError(() =>
        writeProductModifiers(tx, dishes.burger, [
          { kind: "extras", id: extras.sauces },
          { kind: "options", id: UNKNOWN_ID },
        ]),
      );
      expect(error).toEqual(
        expect.objectContaining({ code: "product.invalid", params: { field: "modifiers.1.id" } }),
      );

      expect(await readProductModifiers(tx, [dishes.burger])).toEqual(
        new Map([[dishes.burger, [{ kind: "extras", id: extras.breads }]]]),
      );
    });
  });

  it("refuses the same list named twice in one body, naming the second position", async () => {
    const error = await refusal((tx) =>
      writeProductModifiers(tx, dishes.burger, [
        { kind: "extras", id: extras.breads },
        { kind: "options", id: options.doneness },
        { kind: "extras", id: extras.breads },
      ]),
    );

    expect(error).toEqual(
      expect.objectContaining({ code: "product.invalid", params: { field: "modifiers.2.id" } }),
    );
  });

  it("refuses a duplicate that differs only in case", async () => {
    const error = await refusal((tx) =>
      writeProductModifiers(tx, dishes.burger, [
        { kind: "extras", id: extras.breads },
        { kind: "extras", id: extras.breads.toUpperCase() },
      ]),
    );

    expect(error).toEqual(
      expect.objectContaining({ code: "product.invalid", params: { field: "modifiers.1.id" } }),
    );
  });

  it("allows the same id under both kinds to be told apart", async () => {
    // Two DIFFERENT lists, one of each kind: the duplicate check is on the pair, not on the id
    // alone, so this body is legal and both rows land.
    await run((tx) =>
      writeProductModifiers(tx, dishes.burger, [
        { kind: "extras", id: extras.breads },
        { kind: "options", id: options.doneness },
      ]),
    );

    expect(await run((tx) => readProductModifiers(tx, [dishes.burger]))).toEqual(
      new Map([
        [
          dishes.burger,
          [
            { kind: "extras", id: extras.breads },
            { kind: "options", id: options.doneness },
          ],
        ],
      ]),
    );
  });
});

describe("a product's attachment list in the catalogue's configuration transfer", () => {
  const transferred = CATALOGUE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);

  it("copies both kinds of list before the rows that point at them", () => {
    // `importConfigurationTables` inserts in this order and deletes in its reverse
    // (apps/server/src/configuration-transfer.ts), so both parents have to come first: a row here
    // names an extras list or an options list, and `product_modifiers_extra_list_fk` /
    // `product_modifiers_option_list_fk` are what refuse it otherwise.
    // `toContain` first on all three, because `indexOf` answers -1 for a name the list does not
    // hold and -1 is less than every index, so a missing parent would satisfy the comparisons
    // below without being there at all. `products` is NOT asserted: the catalogue's transfer list
    // does not hold it (it belongs to the core set), so there is no position here to compare.
    for (const name of ["extra_lists", "option_lists", "product_modifiers"])
      expect(transferred).toContain(name);
    expect(transferred.indexOf("extra_lists")).toBeLessThan(
      transferred.indexOf("product_modifiers"),
    );
    expect(transferred.indexOf("option_lists")).toBeLessThan(
      transferred.indexOf("product_modifiers"),
    );
  });
});
