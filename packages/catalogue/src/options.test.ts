import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, captureError, CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { CATALOGUE_CLASSIFICATION } from "./classification.js";
import { CATALOGUE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";
import {
  createOptionList,
  deleteOptionList,
  getOptionList,
  listOptionLists,
  optionListDependants,
  updateOptionList,
} from "./options.js";

// An options list references no product, catalogue or venue, and nothing here turns on who connected
// or on two writers racing, so PGlite is the lighter target that still runs the real migrations —
// including the grants walkthrough at the foot of this file, which assumes app_user with
// `asAppUser` and is enforced from there (CLAUDE.md §4). What needs a container is the concurrent
// save, and that lives in options.pg.test.ts.
// Nothing is seeded: with no `content_languages` row, `readContentLanguages` falls back to the
// language passed in (packages/catalogue/src/content-languages.ts), and `usePgliteDb` empties every
// data table after each test on its own (packages/db/src/testing/lifecycle.ts:132,148-151).
const fx = usePgliteDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS], timeoutMs: 60_000 });
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
    await fx.db.execute(sql`
      insert into option_labels (list_id, name, sort) values
        (${second}, 'Last label', 1), (${second}, 'First label', 0)`);

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
      sql`select count(*)::int as count from option_labels where id = ${dropped.id}`,
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
      sql`select count(*)::int as count from option_labels where list_id = ${created.id}`,
    );
    expect(before.rows[0]!.count).toBe(3); // the delete below has something to clear

    await run((tx) => deleteOptionList(tx, created.id));

    const after = await fx.db.execute<{ count: number }>(
      sql`select count(*)::int as count from option_labels where list_id = ${created.id}`,
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

/**
 * The walkthrough that answers to drizzle/0003_option_lists_grants_sql.sql. Every test above runs on
 * PGlite's superuser connection, which is handed every privilege and so exercises no grant at all;
 * `asAppUser` makes the session assume the application role and PGlite enforces the two tables'
 * grants from there — a container adds nothing (CLAUDE.md §4).
 *
 * Proven rather than assumed: with `DELETE` removed from `option_labels` in that migration, the
 * create below failed with `42501 permission denied for table option_labels`.
 */
describe("option list CRUD as the non-superuser application role", () => {
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

      const created = await createOptionList(tx, cookedList(), "en");
      expect(created.name).toBe("Cooked");
      expect(created.customerName).toEqual({ en: "How would you like it cooked?" });
      expect(created.kitchenName).toBe("Cook");
      expect(created.labels.map((label) => label.name)).toEqual([
        "Medium rare",
        "Well done",
        "Blue",
      ]);
      expect(await getOptionList(tx, created.id)).toEqual(created);

      // Deleting the LIST is the one step here that does NOT answer to `option_labels`' grants: its
      // labels go through the foreign key's ON DELETE CASCADE, which PostgreSQL runs without
      // consulting the role's privileges. Checked, because it reads like the opposite: with that
      // table's DELETE grant removed, a list created as the owner still deleted BOTH its labels
      // through `deleteOptionList` as app_user. Every save above reaches that grant instead —
      // `writeLabels` clears the labels the body does not name on a create as well as an update.
      const updated = await updateOptionList(
        tx,
        created.id,
        {
          name: "Doneness",
          customerName: { en: "Choose a doneness" },
          kitchenName: "DONE",
          labels: [{ id: created.labels[0]!.id, name: "Medium rare", kitchenName: "MR" }],
        },
        "en",
      );
      expect(updated.name).toBe("Doneness");
      expect(updated.customerName).toEqual({ en: "Choose a doneness" });
      expect(updated.kitchenName).toBe("DONE");
      expect(updated.labels.map((label) => label.name)).toEqual(["Medium rare"]);

      await deleteOptionList(tx, created.id);
      expect(await listOptionLists(tx)).toEqual([]);
    });
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
