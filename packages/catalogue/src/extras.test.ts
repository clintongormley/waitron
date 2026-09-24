import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  captureError,
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  engineErrorMessage,
  isRefusal,
  newId,
  refusalOn,
  RESTRICT_VIOLATION,
  UNIQUE_VIOLATION,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
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
import { writeProductModifiers } from "./product-modifiers.js";
import { setProductVariants, type VariantWrite } from "./variants.js";

// With no `content_languages` row, `readContentLanguages` falls back to the language passed in.
// `useVenueDb` empties every data table after each test, so the products are re-made per test.
const fx = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS], timeoutMs: 60_000 });
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
const refusal = (fn: (tx: Transaction) => Promise<unknown>) => captureError(() => run(fn));

const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";
const SECOND_UNKNOWN_ID = "88888888-8888-4888-8888-888888888888";

/**
 * Three breads with three DIFFERENT names and three DIFFERENT unit prices, so a read that picks up
 * the wrong row is visible in both the id and the resolved price. No unit or category, so the
 * product-delete probe below meets only the extras item's key.
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
    // Written straight to the tables: `sort` is not part of the authoring body. Inserted in an order
    // that matches neither the expected order nor plain id order, so dropping either half fails.
    const late = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const third = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await fx.db.execute(sql`
      insert into extra_lists (id, name, sort) values
        (${third}, 'Third', 1), (${second}, 'Second', 1), (${late}, 'Late', 5)`);
    // Each row names its own `id`: the column default is a drizzle `$defaultFn`, which raw SQL skips.
    await fx.db.execute(sql`
      insert into extra_list_items (id, list_id, product_id, sort) values
        (${newId()}, ${second}, ${breads.focaccia}, 1),
        (${newId()}, ${second}, ${breads.sourdough}, 0)`);

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
    // Hex letters, so upper-casing the id below actually changes it.
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

    // What must not happen is the list's own items reading as another list's because the id
    // comparison happens in JavaScript.
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
      sql`select count(*) as count from extra_list_items where id = ${dropped.id}`,
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
      sql`select count(*) as count from extra_list_items where list_id = ${created.id}`,
    );
    expect(before.rows[0]!.count).toBe(3); // the delete below has something to clear

    await run((tx) => deleteExtraList(tx, created.id));

    const after = await fx.db.execute<{ count: number }>(
      sql`select count(*) as count from extra_list_items where list_id = ${created.id}`,
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

  it("names every product that carries the list, by the product's staff name", async () => {
    const created = await run((tx) => createExtraList(tx, breadList(), "en"));
    const dishes = await run(async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Counter" });
      const made: string[] = [];
      // Two dishes with DIFFERENT names, so a join that reaches the wrong product row shows up
      // here rather than passing. A third carries nothing, so a read that simply listed every
      // product would fail too.
      for (const name of ["sandwich", "toastie", "soup"]) {
        const product = await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: null,
          name,
          unitId: null,
          unitPrice: "6.00",
          vatClass: "reduced",
        });
        if (name !== "soup")
          await writeProductModifiers(tx, product.id, [{ kind: "extras", id: created.id }]);
        made.push(product.id);
      }
      return made;
    });

    const dependants = await run((tx) => extraListDependants(tx, created.id));

    expect(dependants.products).toEqual([
      { id: dishes[0], name: "sandwich" },
      { id: dishes[1], name: "toastie" },
    ]);
    // Nothing publishes it on a menu: the two sides are separate reads, and this file has no menu.
    expect(dependants.menus).toEqual([]);
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

describe("an extras list and products with variants", () => {
  const variant = (
    name: string,
    flags: Partial<Pick<VariantWrite, "active" | "available">> = {},
  ) => ({
    name,
    customerName: null,
    kitchenName: null,
    image: null,
    unitPrice: null,
    available: true,
    ...flags,
  });

  it("refuses to create a list offering a product with an Active variant, naming the first such item", async () => {
    // Focaccia's only Active variant is Unavailable, so a check that read `available` would pass
    // it and name sourdough's position instead.
    await run((tx) =>
      setProductVariants(tx, breads.focaccia, [variant("Slab", { available: false })], "en"),
    );
    await run((tx) => setProductVariants(tx, breads.sourdough, [variant("Half loaf")], "en"));

    const error = await refusal((tx) =>
      createExtraList(
        tx,
        {
          name: "Bread",
          items: [
            { productId: breads.rye },
            { productId: breads.focaccia },
            { productId: breads.sourdough },
          ],
        },
        "en",
      ),
    );

    expect(error).toEqual(
      expect.objectContaining({
        code: "extras.product_has_variants",
        params: { field: "items.1.productId", productId: breads.focaccia },
      }),
    );
    expect(await run((tx) => listExtraLists(tx))).toEqual([]);
  });

  it("refuses to update a list to offer a product with an Active variant, leaving the list as it was", async () => {
    const created = await run((tx) =>
      createExtraList(tx, { name: "Bread", items: [{ productId: breads.rye }] }, "en"),
    );
    await run((tx) => setProductVariants(tx, breads.focaccia, [variant("Slab")], "en"));

    const error = await refusal((tx) =>
      updateExtraList(
        tx,
        created.id,
        { name: "Bread", items: [{ productId: breads.rye }, { productId: breads.focaccia }] },
        "en",
      ),
    );

    expect(error).toEqual(
      expect.objectContaining({
        code: "extras.product_has_variants",
        params: { field: "items.1.productId", productId: breads.focaccia },
      }),
    );
    const read = await run((tx) => getExtraList(tx, created.id));
    expect(read.items.map((item) => item.productId)).toEqual([breads.rye]);
  });

  it("offers a product whose only variant is Inactive", async () => {
    await run((tx) =>
      setProductVariants(tx, breads.focaccia, [variant("Slab", { active: false })], "en"),
    );

    const created = await run((tx) =>
      createExtraList(tx, { name: "Bread", items: [{ productId: breads.focaccia }] }, "en"),
    );

    expect(created.items.map((item) => item.productId)).toEqual([breads.focaccia]);
  });

  it("offers a variant itself as an item", async () => {
    const [slab] = await run((tx) =>
      setProductVariants(tx, breads.focaccia, [variant("Slab")], "en"),
    );

    const created = await run((tx) =>
      createExtraList(tx, { name: "Bread", items: [{ productId: slab!.id }] }, "en"),
    );

    expect(created.items.map((item) => item.productId)).toEqual([slab!.id]);
  });
});

describe("what the database refuses under an extras list", () => {
  it("refuses to remove a product an item still names", async () => {
    const created = await run((tx) => createExtraList(tx, breadList(), "en"));
    expect(created.items.map((item) => item.productId)).toContain(breads.rye);

    // Direct SQL, because no route or write path removes a product row.
    const error = await captureError(() =>
      Promise.resolve(fx.db.execute(sql`delete from products where id = ${breads.rye}`)),
    );

    // `RESTRICT_VIOLATION`, not `FOREIGN_KEY_VIOLATION`: SQLite reports a RESTRICT refusal under
    // the TRIGGER reason (`packages/db/src/sql-state.ts`). Its message names no key, so the class is
    // all that separates a RESTRICT key from a NO ACTION one.
    expect(isRefusal(error, RESTRICT_VIOLATION)).toBe(true);
  });

  it("refuses an item priced below zero", async () => {
    const created = await run((tx) =>
      createExtraList(tx, { name: "Sides", items: [{ productId: breads.rye }] }, "en"),
    );

    // The database backstop under `isProductPrice` (modifier-limits.ts).
    const error = await captureError(() =>
      Promise.resolve(
        fx.db.execute(
          sql`insert into extra_list_items (id, list_id, product_id, price)
            values (${newId()}, ${created.id}, ${breads.sourdough}, -100)`,
        ),
      ),
    );

    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("extra_list_items_price_ck");
  });

  it("refuses a second item naming the same product in one list", async () => {
    const created = await run((tx) => createExtraList(tx, breadList(), "en"));

    // The database backstop under `parseExtraListInput`, reached by a direct insert.
    const error = await captureError(() =>
      Promise.resolve(
        fx.db.execute(
          sql`insert into extra_list_items (id, list_id, product_id) values (${newId()}, ${created.id}, ${breads.rye})`,
        ),
      ),
    );

    // SQLite names the columns that collided, not the index.
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "extra_list_items",
        columns: ["list_id", "product_id"],
      }),
    ).toBe(true);
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
