import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  asAppUser,
  captureError,
  CORE_MIGRATIONS,
  pgErrorCode,
  pgErrorMessage,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { CATALOGUE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";
import { createCatalogue, createProduct } from "./operations.js";
import {
  createExtraList,
  deleteExtraList,
  extraListDependants,
  getExtraList,
  listExtraLists,
  resolveExtraPrice,
  updateExtraList,
} from "./extras.js";

// An extras list names products, and nothing here turns on who connected or on two writers racing,
// so PGlite is the lighter target that still runs the real migrations — including the grants
// walkthrough at the foot of this file, which assumes app_user with `asAppUser` and is enforced from
// there (CLAUDE.md §4). What needs a container is the concurrent save, and that lives in
// extras.pg.test.ts.
// Only the tenant row is seeded outside each test's own setup: with no `content_languages` row,
// `readContentLanguages` falls back to the language passed in
// (packages/catalogue/src/content-languages.ts), and `usePgliteDb` empties every data table after
// each test on its own (packages/db/src/testing/lifecycle.ts:148-151), which is why the three
// products below are re-made per test.
const fx = usePgliteDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS], timeoutMs: 60_000 });
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
const refusal = (fn: (tx: Transaction) => Promise<unknown>) => captureError(() => run(fn));

const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";
const SECOND_UNKNOWN_ID = "88888888-8888-4888-8888-888888888888";

/**
 * Three breads with three DIFFERENT names and three DIFFERENT unit prices, so a read that picks up
 * the wrong row is visible in both the id and the resolved price. Created with `unitId: null` and
 * `categoryId: null` so no `product_units` or `product_categories` row points at them — which is
 * what lets the product-delete probe below name the one foreign key it is about.
 */
const breads: { sourdough: string; focaccia: string; rye: string } = {
  sourdough: "",
  focaccia: "",
  rye: "",
};
const unitPrices = { sourdough: "2.50", focaccia: "4.00", rye: "3.25" };

beforeEach(async () => {
  await seedTenant(fx.db);
  await run(async (tx) => {
    const catalogue = await createCatalogue(tx, { name: "Deli" });
    for (const [key, unitPrice] of Object.entries(unitPrices)) {
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

const breadList = () => ({
  name: "Bread",
  customerName: { en: "Choose your bread" },
  kitchenName: "BRD",
  minPicks: 1,
  maxPicks: 1,
  items: [
    { productId: breads.focaccia, maxQuantity: 2, preselected: true },
    { productId: breads.sourdough, price: "1.00" },
    { productId: breads.rye },
  ],
});

describe("extra list CRUD", () => {
  it("keeps each item's own terms, in the body's order, and leaves a null price to the product", async () => {
    const created = await run((tx) => createExtraList(tx, breadList(), "en"));
    const read = await run((tx) => getExtraList(tx, created.id));

    expect(read.name).toBe("Bread");
    expect(read.customerName).toEqual({ en: "Choose your bread" });
    expect(read.kitchenName).toBe("BRD");
    expect(read.active).toBe(true);
    expect(
      read.items.map(({ productId, price, maxQuantity, preselected }) => ({
        productId,
        price,
        maxQuantity,
        preselected,
      })),
    ).toEqual([
      { productId: breads.focaccia, price: null, maxQuantity: 2, preselected: true },
      { productId: breads.sourdough, price: "1.00", maxQuantity: 1, preselected: false },
      { productId: breads.rye, price: null, maxQuantity: 1, preselected: false },
    ]);
    // The three products are priced differently, so an item paired with the wrong product's row
    // resolves to the wrong money here rather than passing.
    expect(resolveExtraPrice(read.items[0]!, { unitPrice: unitPrices.focaccia })).toBe("4.00");
    expect(resolveExtraPrice(read.items[1]!, { unitPrice: unitPrices.sourdough })).toBe("1.00");
    expect(resolveExtraPrice(read.items[2]!, { unitPrice: unitPrices.rye })).toBe("3.25");
  });

  it("stores the exactly-one-bread shape as minPicks and maxPicks of one", async () => {
    const created = await run((tx) => createExtraList(tx, breadList(), "en"));

    expect([created.minPicks, created.maxPicks]).toEqual([1, 1]);
    expect(await run((tx) => getExtraList(tx, created.id))).toEqual(created);
  });

  it("saves an absent customer or kitchen name as nothing rather than refusing the save", async () => {
    const created = await run((tx) =>
      createExtraList(tx, { name: "Sides", items: [{ productId: breads.rye }] }, "en"),
    );

    expect(created.customerName).toBeNull();
    expect(created.kitchenName).toBeNull();
    expect([created.minPicks, created.maxPicks]).toEqual([0, null]);
  });

  it("returns the lists in sort order then id order, each with its items in sort order", async () => {
    // Written straight to the tables: `sort` is not part of the authoring body, so a list saved
    // through `createExtraList` always keeps the column default. The three rows are inserted in an
    // order that matches neither the expected order nor plain id order, so the assertion fails if
    // either half of the ordering is dropped.
    const late = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const third = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await fx.db.execute(sql`
      insert into extra_lists (id, name, sort) values
        (${third}, 'Third', 1), (${second}, 'Second', 1), (${late}, 'Late', 5)`);
    await fx.db.execute(sql`
      insert into extra_list_items (list_id, product_id, sort) values
        (${second}, ${breads.focaccia}, 1), (${second}, ${breads.sourdough}, 0)`);

    const lists = await run((tx) => listExtraLists(tx));

    expect(lists.map((list) => list.name)).toEqual(["Second", "Third", "Late"]);
    expect(lists[0]!.items.map((item) => item.productId)).toEqual([
      breads.sourdough,
      breads.focaccia,
    ]);
    expect(lists[1]!.items).toEqual([]);
  });

  it("keeps a repriced item's id and moves it to its new place", async () => {
    const created = await run((tx) => createExtraList(tx, breadList(), "en"));
    const sourdough = created.items[1]!;

    const updated = await run((tx) =>
      updateExtraList(
        tx,
        created.id,
        {
          name: "Bread",
          items: [
            { id: sourdough.id, productId: breads.sourdough, price: "1.75", maxQuantity: 3 },
            { id: created.items[0]!.id, productId: breads.focaccia },
            { id: created.items[2]!.id, productId: breads.rye },
          ],
        },
        "en",
      ),
    );

    expect(updated.items.map((item) => item.productId)).toEqual([
      breads.sourdough,
      breads.focaccia,
      breads.rye,
    ]);
    expect(updated.items[0]!.id).toBe(sourdough.id);
    expect(updated.items[0]!.price).toBe("1.75");
    expect(updated.items[0]!.maxQuantity).toBe(3);
    // The focaccia item's own terms were not resent, so they fall back to the body's defaults rather
    // than lingering from the create.
    expect([updated.items[1]!.maxQuantity, updated.items[1]!.preselected]).toEqual([1, false]);
  });

  it("updates an item whose id the body sends in upper case", async () => {
    // Hex letters, so upper-casing the id below actually changes it. PostgreSQL stores a uuid
    // case-insensitively and hands it back lower-cased, which is what the body has to match.
    const itemId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const created = await run((tx) =>
      createExtraList(
        tx,
        { name: "Bread", items: [{ id: itemId, productId: breads.sourdough }] },
        "en",
      ),
    );
    expect(created.items[0]!.id).toBe(itemId); // the row the update below has to find

    const updated = await run((tx) =>
      updateExtraList(
        tx,
        created.id,
        {
          name: "Bread",
          items: [{ id: itemId.toUpperCase(), productId: breads.sourdough, price: "2.00" }],
        },
        "en",
      ),
    );

    expect(updated.items.map((item) => [item.id, item.price])).toEqual([[itemId, "2.00"]]);
  });

  it("treats a list's own items as its own when the list id arrives in upper case", async () => {
    const created = await run((tx) => createExtraList(tx, breadList(), "en"));

    // A `uuid` column compares case-insensitively, so an upper-cased list id still names this list;
    // what must not happen is the list's own items reading as another list's because the comparison
    // moved into JavaScript.
    const updated = await run((tx) =>
      updateExtraList(
        tx,
        created.id.toUpperCase(),
        {
          name: "Bread",
          items: [{ id: created.items[0]!.id, productId: breads.focaccia, price: "3.00" }],
        },
        "en",
      ),
    );

    expect(updated.id).toBe(created.id);
    expect(updated.items.map((item) => [item.id, item.productId, item.price])).toEqual([
      [created.items[0]!.id, breads.focaccia, "3.00"],
    ]);
  });

  it("adds an item for the product a retained item is moving away from", async () => {
    const created = await run((tx) =>
      createExtraList(tx, { name: "Bread", items: [{ productId: breads.sourdough }] }, "en"),
    );
    const held = created.items[0]!.id;

    // The body's final products are sourdough and rye — one each, which the list allows. The only
    // clash is between the new item and the state the retained item is leaving behind.
    const updated = await run((tx) =>
      updateExtraList(
        tx,
        created.id,
        {
          name: "Bread",
          items: [{ productId: breads.sourdough }, { id: held, productId: breads.rye }],
        },
        "en",
      ),
    );

    expect(updated.items.map((item) => item.productId)).toEqual([breads.sourdough, breads.rye]);
    expect(updated.items[1]!.id).toBe(held);
  });

  it("removes an item the new body leaves out and adds the one it introduces", async () => {
    const created = await run((tx) => createExtraList(tx, breadList(), "en"));
    const dropped = created.items[2]!;

    const updated = await run((tx) =>
      updateExtraList(
        tx,
        created.id,
        {
          name: "Bread",
          items: [
            { id: created.items[0]!.id, productId: breads.focaccia },
            { productId: breads.rye, price: "0.00" },
          ],
        },
        "en",
      ),
    );

    expect(updated.items.map((item) => item.productId)).toEqual([breads.focaccia, breads.rye]);
    // A free bread: "0.00" is a price the venue chose, kept rather than falling back to the product.
    expect(updated.items[1]!.price).toBe("0.00");
    expect(updated.items[1]!.id).not.toBe(dropped.id);
    const left = await fx.db.execute<{ count: number }>(
      sql`select count(*)::int as count from extra_list_items where id = ${dropped.id}`,
    );
    expect(left.rows[0]!.count).toBe(0);
  });

  it("refuses an item id that belongs to a different list", async () => {
    const other = await run((tx) => createExtraList(tx, breadList(), "en"));
    const mine = await run((tx) =>
      createExtraList(tx, { name: "Sides", items: [{ productId: breads.rye }] }, "en"),
    );

    const error = await refusal((tx) =>
      updateExtraList(
        tx,
        mine.id,
        {
          name: "Sides",
          items: [{ id: other.items[1]!.id, productId: breads.sourdough }],
        },
        "en",
      ),
    );

    expect(error).toEqual(
      expect.objectContaining({ code: "extras.invalid", params: { field: "items.0.id" } }),
    );
  });

  it("refuses a foreign item id before deleting the list's own items", async () => {
    const other = await run((tx) => createExtraList(tx, breadList(), "en"));
    const mine = await run((tx) =>
      createExtraList(tx, { name: "Sides", items: [{ productId: breads.rye }] }, "en"),
    );

    // The read-back happens INSIDE the refused save's own transaction. `withTransaction` rolls a
    // delete back on the way out, so reading afterwards cannot tell a refusal that deleted first
    // from one that refused first — which is the whole difference this test exists to see.
    const left = await withTransaction(fx.db, async (tx) => {
      const error = await captureError(() =>
        updateExtraList(
          tx,
          mine.id,
          { name: "Sides", items: [{ id: other.items[1]!.id, productId: breads.sourdough }] },
          "en",
        ),
      );
      expect(error).toEqual(
        expect.objectContaining({ code: "extras.invalid", params: { field: "items.0.id" } }),
      );
      return tx.execute<{ product_id: string }>(
        sql`select product_id from extra_list_items where list_id = ${mine.id}`,
      );
    });

    expect(left.rows.map((row) => row.product_id)).toEqual([breads.rye]);
  });

  it("deletes the list's items with it", async () => {
    const created = await run((tx) => createExtraList(tx, breadList(), "en"));
    const before = await fx.db.execute<{ count: number }>(
      sql`select count(*)::int as count from extra_list_items where list_id = ${created.id}`,
    );
    expect(before.rows[0]!.count).toBe(3); // the delete below has something to clear

    await run((tx) => deleteExtraList(tx, created.id));

    const after = await fx.db.execute<{ count: number }>(
      sql`select count(*)::int as count from extra_list_items where list_id = ${created.id}`,
    );
    expect(after.rows[0]!.count).toBe(0);
    expect(await run((tx) => listExtraLists(tx))).toEqual([]);
  });

  it("reports no products or menus holding a list", async () => {
    const created = await run((tx) => createExtraList(tx, breadList(), "en"));

    expect(await run((tx) => extraListDependants(tx, created.id))).toEqual({
      products: [],
      menus: [],
    });
  });

  it("refuses to read an id that names no list", async () => {
    const error = await refusal((tx) => getExtraList(tx, UNKNOWN_ID));

    expect(error).toEqual(
      expect.objectContaining({ code: "extras.not_found", params: { extraListId: UNKNOWN_ID } }),
    );
  });

  it("refuses to update an id that names no list", async () => {
    const error = await refusal((tx) => updateExtraList(tx, UNKNOWN_ID, breadList(), "en"));

    expect(error).toEqual(
      expect.objectContaining({ code: "extras.not_found", params: { extraListId: UNKNOWN_ID } }),
    );
  });

  it("refuses to delete an id that names no list", async () => {
    const error = await refusal((tx) => deleteExtraList(tx, UNKNOWN_ID));

    expect(error).toEqual(
      expect.objectContaining({ code: "extras.not_found", params: { extraListId: UNKNOWN_ID } }),
    );
  });

  it("refuses to report the dependants of an id that names no list", async () => {
    const error = await refusal((tx) => extraListDependants(tx, UNKNOWN_ID));

    expect(error).toEqual(
      expect.objectContaining({ code: "extras.not_found", params: { extraListId: UNKNOWN_ID } }),
    );
  });

  it("refuses to create a list whose item names a product that does not exist", async () => {
    // Two unknown products, and a real one first: the field path has to name the FIRST missing item
    // at ITS OWN position, so a hardcoded `items.0` and a path taken from the last miss both fail.
    const error = await refusal((tx) =>
      createExtraList(
        tx,
        {
          name: "Bread",
          items: [
            { productId: breads.rye },
            { productId: UNKNOWN_ID },
            { productId: SECOND_UNKNOWN_ID },
          ],
        },
        "en",
      ),
    );

    expect(error).toEqual(
      expect.objectContaining({ code: "extras.invalid", params: { field: "items.1.productId" } }),
    );
  });

  it("refuses to update a list to an item naming a product that does not exist", async () => {
    const created = await run((tx) => createExtraList(tx, breadList(), "en"));

    const error = await refusal((tx) =>
      updateExtraList(
        tx,
        created.id,
        { name: "Bread", items: [{ productId: UNKNOWN_ID }, { productId: breads.rye }] },
        "en",
      ),
    );

    expect(error).toEqual(
      expect.objectContaining({ code: "extras.invalid", params: { field: "items.0.productId" } }),
    );
    // The refused save left the list as it was, items included.
    const read = await run((tx) => getExtraList(tx, created.id));
    expect(read.items.map((item) => item.productId)).toEqual([
      breads.focaccia,
      breads.sourdough,
      breads.rye,
    ]);
  });

  it("refuses a customer name with no text in the venue's default language", async () => {
    const error = await refusal((tx) =>
      createExtraList(
        tx,
        { name: "Bread", customerName: { fr: "Votre pain" }, items: [{ productId: breads.rye }] },
        "en",
      ),
    );

    expect(error).toEqual(
      expect.objectContaining({
        code: "extras.translation_required",
        params: { field: "customerName", language: "en" },
      }),
    );
  });

  it("saves an all-blank customer name as nothing rather than refusing it", async () => {
    const created = await run((tx) =>
      createExtraList(
        tx,
        { name: "Sides", customerName: { en: "  " }, items: [{ productId: breads.rye }] },
        "en",
      ),
    );

    expect(created.customerName).toBeNull();
  });

  it("refuses an unknown list id before validating its name", async () => {
    const error = await refusal((tx) =>
      updateExtraList(
        tx,
        UNKNOWN_ID,
        { name: "Bread", customerName: { fr: "Votre pain" }, items: [{ productId: breads.rye }] },
        "en",
      ),
    );

    expect(error).toEqual(
      expect.objectContaining({ code: "extras.not_found", params: { extraListId: UNKNOWN_ID } }),
    );
  });
});

describe("what the database refuses under an extras list", () => {
  it("refuses to remove a product an item still names", async () => {
    const created = await run((tx) => createExtraList(tx, breadList(), "en"));
    expect(created.items.map((item) => item.productId)).toContain(breads.rye);

    // Done as direct SQL because nothing in the tree removes a product ROW. Receipts, run on
    // 2026-09-19: `grep -rn "deleteProduct" packages apps --include="*.ts"` matches only the
    // dashboard's `#deleteProduct` (apps/dashboard/src/screens/catalogue-screen.ts:235), which sets
    // `available: false` through the product editor rather than deleting anything; and
    // `grep -rn 'app.delete("/management-api/products' apps/server/src` matches nothing, so there is
    // no product DELETE route either. The constraint name is asserted below so a key that stopped
    // being ON DELETE RESTRICT, or a different row refusing first, fails here rather than passing.
    const error = await captureError(() =>
      fx.db.execute(sql`delete from products where id = ${breads.rye}`),
    );

    // `23001 restrict_violation`, not the `23503 foreign_key_violation` a NO ACTION key raises:
    // measured here, PostgreSQL uses the RESTRICT code for a RESTRICT key. Printed by this very
    // test before the expectation was corrected — it read `expected '23001' to be '23503'`.
    expect(pgErrorCode(error)).toBe("23001");
    expect(pgErrorMessage(error)).toContain("extra_list_items_product_fk");
  });

  it("refuses an item priced below zero", async () => {
    const created = await run((tx) =>
      createExtraList(tx, { name: "Sides", items: [{ productId: breads.rye }] }, "en"),
    );

    // `isProductPrice` (modifier-limits.ts) refuses a leading minus before the write, so a negative
    // price cannot arrive through the contract; this is the database backstop under that, in the
    // shape `product_variants.unit_price` and `menu_item_variants.unit_price` already carry
    // (schema/variants.ts). An item's price becomes a sale line and so reaches a fiscal record.
    const error = await captureError(() =>
      fx.db.execute(
        sql`insert into extra_list_items (list_id, product_id, price)
            values (${created.id}, ${breads.sourdough}, '-1.00')`,
      ),
    );

    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toContain("extra_list_items_price_ck");
  });

  it("refuses a second item naming the same product in one list", async () => {
    const created = await run((tx) => createExtraList(tx, breadList(), "en"));

    // `parseExtraListInput` already refuses the pair in one authoring body (extra-contract.ts); this
    // index is what enforces the same rule in the database, reached here by a direct insert that
    // goes through no contract at all.
    const error = await captureError(() =>
      fx.db.execute(
        sql`insert into extra_list_items (list_id, product_id) values (${created.id}, ${breads.rye})`,
      ),
    );

    expect(pgErrorCode(error)).toBe("23505"); // unique_violation
    expect(pgErrorMessage(error)).toContain("extra_list_items_list_product_uq");
  });
});

/**
 * The walkthrough that answers to drizzle/0005_extra_lists_grants.sql. Every test above runs on
 * PGlite's superuser connection, which is handed every privilege and so exercises no grant at all;
 * `asAppUser` makes the session assume the application role and PGlite enforces the two tables'
 * grants from there — a container adds nothing (CLAUDE.md §4).
 *
 * Seen red rather than assumed: with `DELETE` removed from the grant in that migration, this
 * walkthrough failed with `42501 permission denied for table extra_list_items`; with the grant put
 * back it passed again.
 */
describe("extra list CRUD as the non-superuser application role", () => {
  const app = <T>(fn: (tx: Transaction) => Promise<T>) =>
    withTransaction(fx.db, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });

  it("creates, reads, edits and deletes a list under the application role's grants", async () => {
    await app(async (tx) => {
      const role = await tx.execute<{ role: string; superuser: boolean }>(
        sql`select current_user as role, rolsuper as superuser from pg_roles where rolname = current_user`,
      );
      expect(role.rows).toEqual([{ role: "app_user", superuser: false }]);

      const created = await createExtraList(tx, breadList(), "en");
      expect(created.name).toBe("Bread");
      expect(created.customerName).toEqual({ en: "Choose your bread" });
      expect(created.items.map((item) => item.productId)).toEqual([
        breads.focaccia,
        breads.sourdough,
        breads.rye,
      ]);
      expect(await getExtraList(tx, created.id)).toEqual(created);

      // What reaches `extra_list_items`' own DELETE grant is a SAVE, not the list delete:
      // `writeItems` clears every one of the list's items before inserting the body's, on a create
      // as well as an update, so the statement runs even when it matches nothing. Measured, with
      // `DELETE` removed from the grant in 0005_extra_lists_grants.sql: this test failed inside
      // `createExtraList` at
      // `delete from "extra_list_items" where "extra_list_items"."list_id" = $1`, with
      // `42501 permission denied for table extra_list_items`.
      const updated = await updateExtraList(
        tx,
        created.id,
        {
          name: "Bread basket",
          customerName: { en: "Pick a bread" },
          kitchenName: "BSK",
          minPicks: 1,
          maxPicks: 2,
          items: [{ id: created.items[0]!.id, productId: breads.focaccia, price: "0.50" }],
        },
        "en",
      );
      expect(updated.name).toBe("Bread basket");
      expect(updated.customerName).toEqual({ en: "Pick a bread" });
      expect(updated.kitchenName).toBe("BSK");
      expect([updated.minPicks, updated.maxPicks]).toEqual([1, 2]);
      expect(updated.items.map((item) => [item.productId, item.price])).toEqual([
        [breads.focaccia, "0.50"],
      ]);

      await deleteExtraList(tx, created.id);
      expect(await listExtraLists(tx)).toEqual([]);
    });
  });
});

describe("extra lists in the catalogue's configuration transfer", () => {
  const transferred = CATALOGUE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);

  it("copies a list before the items that point at it", () => {
    expect(transferred).toContain("extra_lists");
    expect(transferred).toContain("extra_list_items");
    // `importConfigurationTables` inserts in this order and deletes in its reverse
    // (apps/server/src/configuration-transfer.ts), so the parent has to come first.
    expect(transferred.indexOf("extra_lists")).toBeLessThan(
      transferred.indexOf("extra_list_items"),
    );
  });
});
