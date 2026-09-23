import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { captureError, CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { menuItems } from "./schema/menu.js";
import { createCatalogue, createMenuItem, createMenuSection, createProduct } from "./operations.js";
import { writeProductModifiers } from "./product-modifiers.js";
import { CATALOGUE_CLASSIFICATION } from "./classification.js";
import { CATALOGUE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";
import {
  createOptionList,
  deleteOptionList,
  getOptionList,
  listOptionLists,
  optionListDependants,
  readOptionListsByIds,
  updateOptionList,
} from "./options.js";

// One SQLite file with the real migrations applied.
// Nothing is seeded at the suite level: with no `content_languages` row, `readContentLanguages`
// falls back to the language passed in (packages/catalogue/src/content-languages.ts), and
// `useVenueDb` empties every data table after each test on its own
// (packages/db/src/testing/venue-db.ts). The tests that create products seed the taxpayer row
// themselves.
const fx = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS], timeoutMs: 60_000 });
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
const refusal = (fn: (tx: Transaction) => Promise<unknown>) => captureError(() => run(fn));

const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

/** The three names carry three DIFFERENT texts, so a function reading the wrong column fails. */
const cookedList = () => ({
  name: "Cooked",
  customerName: { en: "How would you like it cooked?" },
  kitchenName: "Cook",
  labels: [
    { name: "Medium rare", customerName: { en: "Cooked medium rare" }, kitchenName: "MR" },
    { name: "Well done", customerName: { en: "Cooked all the way through" }, kitchenName: "WD" },
    {
      name: "Blue",
      customerName: { en: "Barely cooked at all" },
      kitchenName: "BL",
      available: false,
    },
  ],
});

describe("option list CRUD", () => {
  it("keeps the list's three names and each label's three names apart", async () => {
    const created = await run((tx) => createOptionList(tx, cookedList(), "en"));
    const read = await run((tx) => getOptionList(tx, created.id));

    expect(read.name).toBe("Cooked");
    expect(read.customerName).toEqual({ en: "How would you like it cooked?" });
    expect(read.kitchenName).toBe("Cook");
    expect(read.active).toBe(true);
    expect(read.labels.map((label) => [label.name, label.customerName, label.kitchenName])).toEqual(
      [
        ["Medium rare", { en: "Cooked medium rare" }, "MR"],
        ["Well done", { en: "Cooked all the way through" }, "WD"],
        ["Blue", { en: "Barely cooked at all" }, "BL"],
      ],
    );
    expect(read.labels.map((label) => label.available)).toEqual([true, true, false]);
  });

  it("saves an absent customer or kitchen name as nothing rather than refusing the save", async () => {
    const created = await run((tx) =>
      createOptionList(tx, { name: "Spice", labels: [{ name: "Mild" }] }, "en"),
    );

    expect(created.customerName).toBeNull();
    expect(created.kitchenName).toBeNull();
    expect(created.labels[0]!.customerName).toBeNull();
    expect(created.labels[0]!.kitchenName).toBeNull();
  });

  it("gives every label an id and keeps a default that names one of them", async () => {
    const labelId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const created = await run((tx) =>
      createOptionList(
        tx,
        {
          name: "Cooked",
          defaultLabelId: labelId,
          labels: [{ id: labelId, name: "Medium rare" }, { name: "Well done" }],
        },
        "en",
      ),
    );

    expect(created.defaultLabelId).toBe(labelId);
    expect(created.labels.map((label) => label.name)).toEqual(["Medium rare", "Well done"]);
    expect(created.labels[0]!.id).toBe(labelId);
    expect(created.labels[1]!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("returns the lists in sort order then id order, each with its labels in sort order", async () => {
    // Written straight to the tables: `sort` is not part of the authoring body, so a list saved
    // through `createOptionList` always keeps the column default. The three rows are inserted in an
    // order that matches neither the expected order nor plain id order, so the assertion fails if
    // either half of the ordering is dropped.
    const late = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const third = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await fx.db.execute(sql`
      insert into option_lists (id, name, sort) values
        (${third}, 'Third', 1), (${second}, 'Second', 1), (${late}, 'Late', 5)`);
    // The label ids are given explicitly and in the OPPOSITE order to the labels' `sort`, so this
    // test's label assertion fails when the `sort` key is dropped. Left to `defaultRandom()` the
    // two ids land in either order and the assertion passes about half the time — seen doing
    // exactly that while proving `readOptionListsByIds` below by deletion.
    const lastLabel = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const firstLabel = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await fx.db.execute(sql`
      insert into option_labels (id, list_id, name, sort) values
        (${lastLabel}, ${second}, 'Last label', 1), (${firstLabel}, ${second}, 'First label', 0)`);

    const lists = await run((tx) => listOptionLists(tx));

    expect(lists.map((list) => list.name)).toEqual(["Second", "Third", "Late"]);
    expect(lists[0]!.labels.map((label) => label.name)).toEqual(["First label", "Last label"]);
    expect(lists[1]!.labels).toEqual([]);
  });

  it("keeps a renamed label's id and moves it to its new place", async () => {
    const created = await run((tx) => createOptionList(tx, cookedList(), "en"));
    const wellDone = created.labels[1]!;

    const updated = await run((tx) =>
      updateOptionList(
        tx,
        created.id,
        {
          name: "Cooked",
          labels: [
            { id: wellDone.id, name: "Cooked through", kitchenName: "CT" },
            { id: created.labels[0]!.id, name: "Medium rare" },
          ],
        },
        "en",
      ),
    );

    expect(updated.labels.map((label) => label.name)).toEqual(["Cooked through", "Medium rare"]);
    expect(updated.labels[0]!.id).toBe(wellDone.id);
    expect(updated.labels[0]!.kitchenName).toBe("CT");
  });

  it("removes a label the new body leaves out and adds the one it introduces", async () => {
    const created = await run((tx) => createOptionList(tx, cookedList(), "en"));
    const dropped = created.labels[2]!;

    const updated = await run((tx) =>
      updateOptionList(
        tx,
        created.id,
        {
          name: "Cooked",
          labels: [
            { id: created.labels[0]!.id, name: "Medium rare" },
            { id: created.labels[1]!.id, name: "Well done" },
            { name: "Charred" },
          ],
        },
        "en",
      ),
    );

    expect(updated.labels.map((label) => label.name)).toEqual([
      "Medium rare",
      "Well done",
      "Charred",
    ]);
    const left = await fx.db.execute<{ count: number }>(
      sql`select count(*) as count from option_labels where id = ${dropped.id}`,
    );
    expect(left.rows[0]!.count).toBe(0);
  });

  it("updates a label whose id the body sends in upper case", async () => {
    // Hex letters, so upper-casing the id below actually changes it. PostgreSQL stores a uuid
    // case-insensitively and hands it back lower-cased, which is what the body has to match.
    const labelId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const created = await run((tx) =>
      createOptionList(
        tx,
        { name: "Cooked", labels: [{ id: labelId, name: "Medium rare" }] },
        "en",
      ),
    );
    expect(created.labels[0]!.id).toBe(labelId); // the row the update below has to find

    const updated = await run((tx) =>
      updateOptionList(
        tx,
        created.id,
        { name: "Cooked", labels: [{ id: labelId.toUpperCase(), name: "Rare" }] },
        "en",
      ),
    );

    expect(updated.labels.map((label) => [label.id, label.name])).toEqual([[labelId, "Rare"]]);
  });

  it("treats a list's own labels as its own when the list id arrives in upper case", async () => {
    const created = await run((tx) => createOptionList(tx, cookedList(), "en"));

    // A `uuid` column compares case-insensitively, so an upper-cased list id still names this list;
    // what must not happen is the list's own labels reading as another list's because the comparison
    // moved into JavaScript. `PATCH /management-api/modifiers/options/:id` checks only the SHAPE of
    // the id it is given (`requireUuidParam`, apps/server/src/catalogue-api.ts), so the case a caller
    // sends is the case this function receives.
    const updated = await run((tx) =>
      updateOptionList(
        tx,
        created.id.toUpperCase(),
        { name: "Cooked", labels: [{ id: created.labels[0]!.id, name: "Rare" }] },
        "en",
      ),
    );

    expect(updated.id).toBe(created.id);
    expect(updated.labels.map((label) => [label.id, label.name])).toEqual([
      [created.labels[0]!.id, "Rare"],
    ]);
  });

  it("refuses a label id that belongs to a different list", async () => {
    const other = await run((tx) => createOptionList(tx, cookedList(), "en"));
    const mine = await run((tx) =>
      createOptionList(tx, { name: "Spice", labels: [{ name: "Mild" }] }, "en"),
    );

    const error = await refusal((tx) =>
      updateOptionList(
        tx,
        mine.id,
        { name: "Spice", labels: [{ id: other.labels[0]!.id, name: "Mild" }] },
        "en",
      ),
    );

    expect(error).toEqual(
      expect.objectContaining({ code: "options.invalid", params: { field: "labels.0.id" } }),
    );
  });

  it("refuses a foreign label id before deleting the list's own labels", async () => {
    const other = await run((tx) => createOptionList(tx, cookedList(), "en"));
    const mine = await run((tx) =>
      createOptionList(tx, { name: "Spice", labels: [{ name: "Mild" }] }, "en"),
    );

    // The read-back happens INSIDE the refused save's own transaction. `withTransaction` rolls a
    // delete back on the way out, so reading afterwards cannot tell a refusal that deleted first
    // from one that refused first — which is the whole difference this test exists to see.
    const left = await withTransaction(fx.db, async (tx) => {
      const error = await captureError(() =>
        updateOptionList(
          tx,
          mine.id,
          { name: "Spice", labels: [{ id: other.labels[0]!.id, name: "Mild" }] },
          "en",
        ),
      );
      expect(error).toEqual(
        expect.objectContaining({ code: "options.invalid", params: { field: "labels.0.id" } }),
      );
      return tx.execute<{ name: string }>(
        sql`select name from option_labels where list_id = ${mine.id}`,
      );
    });

    expect(left.rows.map((row) => row.name)).toEqual(["Mild"]);
  });

  it("deletes the list's labels with it", async () => {
    const created = await run((tx) => createOptionList(tx, cookedList(), "en"));
    const before = await fx.db.execute<{ count: number }>(
      sql`select count(*) as count from option_labels where list_id = ${created.id}`,
    );
    expect(before.rows[0]!.count).toBe(3); // the delete below has something to clear

    await run((tx) => deleteOptionList(tx, created.id));

    const after = await fx.db.execute<{ count: number }>(
      sql`select count(*) as count from option_labels where list_id = ${created.id}`,
    );
    expect(after.rows[0]!.count).toBe(0);
    expect(await run((tx) => listOptionLists(tx))).toEqual([]);
  });

  it("reports no products or menus holding a list", async () => {
    const created = await run((tx) => createOptionList(tx, cookedList(), "en"));

    expect(await run((tx) => optionListDependants(tx, created.id))).toEqual({
      products: [],
      menus: [],
    });
  });

  it("names the products carrying the list, and the menu offers of those dishes", async () => {
    const created = await run((tx) => createOptionList(tx, cookedList(), "en"));
    await seedTenant(fx.db);
    const dishes = await run(async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Deli" });
      const section = await createMenuSection(tx, { menuId: catalogue.id, name: { en: "Mains" } });
      const made: Record<string, string> = {};
      for (const name of ["steak", "burger", "chips"]) {
        const product = await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: null,
          name,
          unitId: null,
          unitPrice: "12.00",
          vatClass: "reduced",
        });
        made[name] = product.id;
        // The steak and the burger carry the list; the chips do not.
        if (name !== "chips")
          await writeProductModifiers(tx, product.id, [{ kind: "options", id: created.id }]);
      }
      // The steak and the chips are on the menu; the burger is not. So a `menus` side that listed
      // every offer, or every carrying product, gets a different answer from the one below.
      for (const name of ["steak", "chips"])
        made[`${name}Offer`] = (
          await createMenuItem(tx, {
            menuId: catalogue.id,
            productId: made[name]!,
            sectionId: section.id,
            grossPrice: "12.00",
          })
        ).id;
      return made;
    });

    const dependants = await run((tx) => optionListDependants(tx, created.id));

    expect(dependants.products).toEqual([
      { id: dishes.burger, name: "burger" },
      { id: dishes.steak, name: "steak" },
    ]);
    expect(dependants.menus).toEqual([{ id: dishes.steakOffer, name: "steak" }]);
  });

  it("refuses to read an id that names no list", async () => {
    const error = await refusal((tx) => getOptionList(tx, UNKNOWN_ID));

    expect(error).toEqual(
      expect.objectContaining({
        code: "options.not_found",
        params: { optionListId: UNKNOWN_ID },
      }),
    );
  });

  it("refuses to update an id that names no list", async () => {
    const error = await refusal((tx) => updateOptionList(tx, UNKNOWN_ID, cookedList(), "en"));

    expect(error).toEqual(
      expect.objectContaining({
        code: "options.not_found",
        params: { optionListId: UNKNOWN_ID },
      }),
    );
  });

  it("refuses to delete an id that names no list", async () => {
    const error = await refusal((tx) => deleteOptionList(tx, UNKNOWN_ID));

    expect(error).toEqual(
      expect.objectContaining({
        code: "options.not_found",
        params: { optionListId: UNKNOWN_ID },
      }),
    );
  });

  it("refuses to report the dependants of an id that names no list", async () => {
    const error = await refusal((tx) => optionListDependants(tx, UNKNOWN_ID));

    expect(error).toEqual(
      expect.objectContaining({
        code: "options.not_found",
        params: { optionListId: UNKNOWN_ID },
      }),
    );
  });

  it("refuses a list customer name with no text in the venue's default language", async () => {
    const error = await refusal((tx) =>
      createOptionList(
        tx,
        { name: "Cooked", customerName: { fr: "Cuisson" }, labels: [{ name: "Medium rare" }] },
        "en",
      ),
    );

    expect(error).toEqual(
      expect.objectContaining({
        code: "options.translation_required",
        params: { field: "customerName", language: "en" },
      }),
    );
  });

  it("refuses a label customer name with no text in the venue's default language", async () => {
    // Two labels, and the SECOND is the one with the gap, so a refusal that always reported the
    // first label would fail here.
    const error = await refusal((tx) =>
      createOptionList(
        tx,
        {
          name: "Cooked",
          labels: [
            { name: "Medium rare", customerName: { en: "Cooked medium rare" } },
            { name: "Well done", customerName: { fr: "Bien cuit" } },
          ],
        },
        "en",
      ),
    );

    expect(error).toEqual(
      expect.objectContaining({
        code: "options.translation_required",
        params: { field: "labels.1.customerName", language: "en" },
      }),
    );
  });

  it("saves an all-blank customer name as nothing rather than refusing it", async () => {
    const created = await run((tx) =>
      createOptionList(
        tx,
        { name: "Spice", customerName: { en: "  " }, labels: [{ name: "Mild", customerName: {} }] },
        "en",
      ),
    );

    expect(created.customerName).toBeNull();
    expect(created.labels[0]!.customerName).toBeNull();
  });

  it("refuses an unknown list id before validating its names", async () => {
    const error = await refusal((tx) =>
      updateOptionList(
        tx,
        UNKNOWN_ID,
        { name: "Cooked", customerName: { fr: "Cuisson" }, labels: [{ name: "Medium rare" }] },
        "en",
      ),
    );

    expect(error).toEqual(
      expect.objectContaining({
        code: "options.not_found",
        params: { optionListId: UNKNOWN_ID },
      }),
    );
  });
});

describe("reading the named option lists", () => {
  /**
   * Three lists written straight to the tables, because `sort` is not part of the authoring body and
   * a list saved through `createOptionList` always keeps the column default. The ids are chosen so
   * that sort order, id order and the order the ids are asked in are three DIFFERENT orders — an
   * assertion on the names below therefore fails if the `sort` key is dropped, if the `id` tiebreak
   * is dropped, or if the rows come back in the caller's order.
   */
  const late = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const third = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  const seedLists = async () => {
    await fx.db.execute(sql`
      insert into option_lists (id, name, sort) values
        (${third}, 'Third', 1), (${second}, 'Second', 1), (${late}, 'Late', 5)`);
    // The label ids are given explicitly and in the OPPOSITE order to the labels' `sort`, so the
    // label assertion below fails if the `sort` key is dropped. Left to `defaultRandom()` the two
    // ids land in either order and the same assertion passes about half the time — seen doing
    // exactly that, with `optionLabels.sort` removed from the shared helper.
    await fx.db.execute(sql`
      insert into option_labels (id, list_id, name, sort) values
        ('11111111-1111-4111-8111-111111111111', ${third}, 'Last label', 1),
        ('22222222-2222-4222-8222-222222222222', ${third}, 'First label', 0)`);
  };

  it("returns only the named lists, in the catalogue's own order", async () => {
    await seedLists();

    const lists = await run((tx) => readOptionListsByIds(tx, [late, third]));

    expect(lists.map((list) => list.name)).toEqual(["Third", "Late"]);
  });

  it("carries each list's labels in label order, and an empty array for a list with none", async () => {
    await seedLists();

    const lists = await run((tx) => readOptionListsByIds(tx, [second, third]));

    expect(lists.map((list) => list.labels.map((label) => label.name))).toEqual([
      [],
      ["First label", "Last label"],
    ]);
  });

  it("hands back exactly what getOptionList hands back for the same list", async () => {
    const created = await run((tx) => createOptionList(tx, cookedList(), "en"));

    const [read] = await run((tx) => readOptionListsByIds(tx, [created.id]));

    expect(read).toEqual(await run((tx) => getOptionList(tx, created.id)));
  });

  it("leaves out an id that names no list, rather than refusing", async () => {
    await seedLists();

    const lists = await run((tx) => readOptionListsByIds(tx, [UNKNOWN_ID, second]));

    expect(lists.map((list) => list.name)).toEqual(["Second"]);
  });

  it("asks the database nothing for an empty id list", async () => {
    // A `Transaction`-shaped stub whose `select` throws, so this pins "no query at all" rather than
    // "an empty answer": against the real connection an implementation that queried anyway would
    // still return `[]` and pass.
    const refuses = {
      select: () => {
        throw new Error("readOptionListsByIds queried the database for an empty id list");
      },
    } as unknown as Transaction;

    expect(await readOptionListsByIds(refuses, [])).toEqual([]);
  });
});

describe("option lists in the catalogue's configuration transfer", () => {
  const transferred = CATALOGUE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);

  it("copies a list before the labels that point at it", () => {
    expect(transferred).toContain("option_lists");
    expect(transferred).toContain("option_labels");
    // `importConfigurationTables` inserts in this order and deletes in its reverse
    // (apps/server/src/configuration-transfer.ts), so the parent has to come first.
    expect(transferred.indexOf("option_lists")).toBeLessThan(transferred.indexOf("option_labels"));
  });

  // Not "the same tables": every other package in the repository transfers a SUBSET of what it
  // classifies (packages/db 21 of 49, identity 1 of 9, workforce 3 of 9, venue-service 5 of 8,
  // payments 1 of 5), so equality holds here by coincidence and a catalogue table deliberately
  // kept out of a standby copy would fail this for the wrong reason.
  it("transfers only tables the catalogue classifies", () => {
    const classified = new Set(CATALOGUE_CLASSIFICATION.map(({ table }) => table));

    expect(transferred.filter((table) => !classified.has(table))).toEqual([]);
  });
});

describe("the menus a list's delete preview names", () => {
  it("lists the menu offers in offer-id order, not in the products' name order", async () => {
    const created = await run((tx) => createOptionList(tx, cookedList(), "en"));
    await seedTenant(fx.db);
    // Offer ids chosen against the products' alphabetical order, so the preview's own query order
    // (by product name) and the offer-id order it promises are different answers.
    const offerIds = {
      alpha: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      beta: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      gamma: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };
    await run(async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Deli" });
      const section = await createMenuSection(tx, { menuId: catalogue.id, name: { en: "Mains" } });
      for (const [name, offerId] of Object.entries(offerIds)) {
        const product = await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: null,
          name,
          unitId: null,
          unitPrice: "12.00",
          vatClass: "reduced",
        });
        await writeProductModifiers(tx, product.id, [{ kind: "options", id: created.id }]);
        await tx.insert(menuItems).values({
          id: offerId,
          menuId: catalogue.id,
          productId: product.id,
          sectionId: section.id,
          grossPrice: 1200,
        });
      }
    });

    const dependants = await run((tx) => optionListDependants(tx, created.id));

    expect(dependants.products.map((product) => product.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(dependants.menus).toEqual([
      { id: offerIds.beta, name: "beta" },
      { id: offerIds.gamma, name: "gamma" },
      { id: offerIds.alpha, name: "alpha" },
    ]);
  });
});
