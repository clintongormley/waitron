// A real venue file, not `:memory:`: the triggers under test are ordinary SQLite triggers, so what
// they write is visible to the one handle the store gives a file.
//
// A table with no `id` column and a row whose `id` is null both produce an identity with no `id`
// key. `new."id"` is a PREPARE error on a table with no such column, so the keyless case is one of
// its own.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { ResourceChange } from "@waitron/shared";
import { installChangeFeed, removeChangeFeed } from "./change-feed.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import type { Database } from "./client.js";
import { useVenueDb } from "./testing/venue-db.js";

describe("database change feed", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS],
    setup: async (db: Database) => {
      // Probe tables rather than real ones, so the cases state the SHAPE each covers instead of
      // depending on whichever product table happens to have it today.
      db.run(
        sql.raw(`create table live_probe (id text primary key, printer_id text, secret text)`),
      );
      db.run(sql.raw(`create table live_probe_alone (id text primary key)`));
      db.run(
        sql.raw(`create table live_probe_counted (id integer primary key, parent_id integer)`),
      );
      db.run(
        sql.raw(
          `create table live_probe_keyless (left_id text not null, right_id text not null,` +
            ` primary key (left_id, right_id))`,
        ),
      );
      db.run(
        sql.raw(`create table live_probe_suffixed (module text primary key not null, doc text)`),
      );
      db.run(sql.raw(`create table live_probe_nullable (id text primary key, module text)`));
      await installChangeFeed(db, [
        { table: "live_probe_suffixed", type: "suffixed", typeSuffixColumn: "module" },
        {
          table: "live_probe",
          type: "print-job",
          related: [{ type: "printer", column: "printer_id" }],
        },
        // A source with no related objects at all — most of the real sources are this shape, and
        // an omitted list has to become an empty list rather than the word "undefined".
        { table: "live_probe_alone", type: "alone" },
        { table: "live_probe_keyless", type: "keyless" },
        {
          table: "live_probe_counted",
          type: "counted",
          related: [{ type: "parent", column: "parent_id" }],
        },
      ]);
    },
  });

  /**
   * What the change log holds, sorted by its rendered JSON rather than read in write order. What
   * the assertions rest on is the event COUNT and each event's contents, and the sort leaves both
   * alone.
   */
  function changes(): ResourceChange[] {
    return suite.db
      .execute<{ payload: string }>(sql`select payload from change_log`)
      .rows.map((row) => JSON.parse(row.payload) as ResourceChange)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  it("types a suffixed source by its column value, without an id", () => {
    suite.db.run(sql.raw(`insert into live_probe_suffixed values ('menu', '{}')`));
    expect(changes()).toEqual([{ resources: [{ type: "suffixed.menu" }] }]);
    suite.db.run(sql.raw(`delete from change_log`));
    suite.db.run(sql.raw(`update live_probe_suffixed set doc = '{"note":"changed"}'`));
    expect(changes()).toEqual([
      { resources: [{ type: "suffixed.menu" }] },
      { resources: [{ type: "suffixed.menu" }] },
    ]);
    suite.db.run(sql.raw(`delete from change_log`));
    suite.db.run(sql.raw(`delete from live_probe_suffixed`));
    expect(changes()).toEqual([{ resources: [{ type: "suffixed.menu" }] }]);
  });
  it("refuses missing, unsafe and nullable suffix columns without breaking the installed feed", async () => {
    for (const [table, column, message] of [
      ["live_probe_suffixed", "nope", "no column named nope"],
      ["live_probe_suffixed", 'a"b', "not a plain column name"],
      ["live_probe_nullable", "module", "module may be null"],
    ])
      await expect(
        installChangeFeed(suite.db, [
          { table: table!, type: "suffixed", typeSuffixColumn: column! },
        ]),
      ).rejects.toThrow(message);
    suite.db.run(sql.raw(`insert into live_probe_suffixed values ('menu', '{}')`));
    expect(changes()).toEqual([{ resources: [{ type: "suffixed.menu" }] }]);
  });

  it("writes the changed row's own identity and its related object's, and nothing else", () => {
    suite.db.run(
      sql.raw(`insert into live_probe values ('j1', 'p1', 'must not leave the database')`),
    );
    expect(changes()).toEqual([
      {
        resources: [
          { type: "print-job", id: "j1" },
          { type: "printer", id: "p1" },
        ],
      },
    ]);
  });

  it("omits a related identity the changed row does not carry", () => {
    suite.db.run(sql.raw(`insert into live_probe values ('j2', null, null)`));
    expect(changes()).toEqual([{ resources: [{ type: "print-job", id: "j2" }] }]);
  });

  it("records a source that declares no related objects, carrying only its own identity", () => {
    suite.db.run(sql.raw(`insert into live_probe_alone values ('a1')`));
    expect(changes()).toEqual([{ resources: [{ type: "alone", id: "a1" }] }]);
  });

  it("carries the type alone for a source table that has no id column", () => {
    suite.db.run(sql.raw(`insert into live_probe_keyless values ('l1', 'r1')`));
    expect(changes()).toEqual([{ resources: [{ type: "keyless" }] }]);
  });

  it("names an integer id, and an integer related column, as text on insert, update and delete", () => {
    suite.db.run(sql.raw(`insert into live_probe_counted values (1, 7)`));
    suite.db.run(sql.raw(`update live_probe_counted set parent_id = 8 where id = 1`));
    suite.db.run(sql.raw(`delete from live_probe_counted where id = 1`));
    const named = (parent: string) => ({
      resources: [
        { type: "counted", id: "1" },
        { type: "parent", id: parent },
      ],
    });
    expect(changes()).toEqual([named("7"), named("7"), named("8"), named("8")]);
  });

  it("invalidates both sides of a relationship change on an update", () => {
    suite.db.run(sql.raw(`insert into live_probe values ('moving', 'p-before', null)`));
    suite.db.run(sql.raw(`delete from change_log`));
    suite.db.run(sql.raw(`update live_probe set printer_id = 'p-after' where id = 'moving'`));
    expect(changes()).toEqual([
      {
        resources: [
          { type: "print-job", id: "moving" },
          { type: "printer", id: "p-after" },
        ],
      },
      {
        resources: [
          { type: "print-job", id: "moving" },
          { type: "printer", id: "p-before" },
        ],
      },
    ]);
  });

  // SQLite fires a row trigger for an UPDATE that changes nothing, so the silence is bought with a
  // `when` clause — and the case above is this one's control, because a `when` clause that refused
  // everything would pass here and fail there.
  it("writes nothing for an update that leaves every column as it was", () => {
    suite.db.run(sql.raw(`insert into live_probe values ('still', 'p', null)`));
    suite.db.run(sql.raw(`delete from change_log`));
    suite.db.run(sql.raw(`update live_probe set printer_id = printer_id where id = 'still'`));
    expect(changes()).toEqual([]);
  });

  it("writes the removed row's identities on a delete", () => {
    suite.db.run(sql.raw(`insert into live_probe values ('going', 'p-gone', null)`));
    suite.db.run(sql.raw(`delete from change_log`));
    suite.db.run(sql.raw(`delete from live_probe where id = 'going'`));
    expect(changes()).toEqual([
      {
        resources: [
          { type: "print-job", id: "going" },
          { type: "printer", id: "p-gone" },
        ],
      },
    ]);
  });

  it("discards rolled-back changes, with a committed change as the control", async () => {
    await expect(
      suite.db.transaction(async (tx) => {
        tx.run(sql.raw(`insert into live_probe values ('rolled-back', null, null)`));
        throw new Error("rollback probe");
      }),
    ).rejects.toThrow("rollback probe");
    suite.db.run(sql.raw(`insert into live_probe values ('committed', null, null)`));
    expect(changes()).toEqual([{ resources: [{ type: "print-job", id: "committed" }] }]);
  });

  // Every change row needs an identity of its own, and `change_log.id` is a plain `text` primary
  // key whose default is supplied in JavaScript (`newId`, `schema/columns.ts`) — which a trigger's
  // raw INSERT never reaches. Without a value generated in SQL the very first change is refused
  // `NOT NULL constraint failed`; without a DISTINCT one the second is refused `UNIQUE constraint
  // failed`, so two rows is the smallest case that separates the two.
  it("gives each change row a distinct identity", () => {
    suite.db.run(sql.raw(`insert into live_probe_alone values ('one')`));
    suite.db.run(sql.raw(`insert into live_probe_alone values ('two')`));
    const ids = suite.db
      .execute<{ id: string }>(sql`select id from change_log`)
      .rows.map((row) => row.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("today-only changes", () => {
  const source = {
    table: "live_today_probe",
    type: "dining_tables",
    quiet: { type: "dining_tables.today", columns: ["today_x"] },
  };
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS],
    setup: async (db) => {
      db.run(
        sql.raw("create table live_today_probe (id text primary key, label text, today_x integer)"),
      );
      await installChangeFeed(db, [source]);
    },
  });
  const resources = () =>
    suite.db
      .execute<{ payload: string }>(sql`select payload from change_log`)
      .rows.map(({ payload }) => (JSON.parse(payload) as ResourceChange).resources);

  it.each([
    ["today_x only", sql`update live_today_probe set today_x = 1`, "dining_tables.today"],
    ["today_x to null", sql`update live_today_probe set today_x = null`, "dining_tables.today"],
    ["label only", sql`update live_today_probe set label = 'Changed'`, "dining_tables"],
    [
      "mixed values",
      sql`update live_today_probe set today_x = 1, label = 'Changed'`,
      "dining_tables",
    ],
    [
      "unchanged label",
      sql`update live_today_probe set today_x = 1, label = label`,
      "dining_tables.today",
    ],
  ])("routes actual changes in %s", (_name, statement, type) => {
    suite.db.run(sql.raw("insert into live_today_probe values ('table-1', 'Table 1', 0)"));
    suite.db.run(sql`delete from change_log`);
    suite.db.run(statement);
    expect(resources()).toEqual([[{ type, id: "table-1" }], [{ type, id: "table-1" }]]);
  });
  it.each([null, "Changed"])(
    "routes a saved field changing to %s through the base type",
    (label) => {
      suite.db.run(
        sql`insert into live_today_probe values ('table-1', ${label === null ? "Table 1" : null}, 0)`,
      );
      suite.db.run(sql`delete from change_log`);
      suite.db.run(sql`update live_today_probe set label = ${label}`);
      expect(resources()).toEqual([
        [{ type: "dining_tables", id: "table-1" }],
        [{ type: "dining_tables", id: "table-1" }],
      ]);
    },
  );
  it("retains insert/delete identities and silences unchanged values", () => {
    suite.db.run(sql.raw("insert into live_today_probe values ('table-1', 'Table 1', null)"));
    expect(resources()).toEqual([[{ type: "dining_tables", id: "table-1" }]]);
    suite.db.run(sql`delete from change_log`);
    suite.db.run(sql.raw("update live_today_probe set today_x = null, label = label"));
    expect(resources()).toEqual([]);
    suite.db.run(sql.raw("delete from live_today_probe"));
    expect(resources()).toEqual([[{ type: "dining_tables", id: "table-1" }]]);
  });
  it.each([
    ["missing", "no column named missing"],
    ['a"b', "not a plain column name"],
  ])(
    "refuses invalid quiet column %s before replacing the installed feed",
    async (column, message) => {
      await expect(
        installChangeFeed(suite.db, [{ ...source, quiet: { type: "quiet", columns: [column!] } }]),
      ).rejects.toThrow(message);
      suite.db.run(sql.raw("insert into live_today_probe values ('table-1', 'Table 1', 0)"));
      suite.db.run(sql`delete from change_log`);
      suite.db.run(sql.raw("update live_today_probe set today_x = 1"));
      expect(resources()).toEqual([
        [{ type: "dining_tables.today", id: "table-1" }],
        [{ type: "dining_tables.today", id: "table-1" }],
      ]);
    },
  );
  it("replaces an existing base-only feed with quiet routing", async () => {
    await installChangeFeed(suite.db, [{ table: source.table, type: source.type }]);
    suite.db.run(sql.raw("insert into live_today_probe values ('table-1', 'Table 1', 0)"));
    suite.db.run(sql`delete from change_log`);
    suite.db.run(sql.raw("update live_today_probe set today_x = 1"));
    expect(resources()).toEqual([
      [{ type: "dining_tables", id: "table-1" }],
      [{ type: "dining_tables", id: "table-1" }],
    ]);
    await installChangeFeed(suite.db, [source]);
    suite.db.run(sql`delete from change_log`);
    suite.db.run(sql.raw("update live_today_probe set today_x = 2"));
    expect(resources()).toEqual([
      [{ type: "dining_tables.today", id: "table-1" }],
      [{ type: "dining_tables.today", id: "table-1" }],
    ]);
  });
});

describe("removing the change feed", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS],
    setup: async (db: Database) => {
      db.run(sql.raw(`create table live_probe (id text primary key)`));
      db.run(sql.raw(`create table other_probe (id text primary key)`));
      // A trigger the feed did not install, which removing the feed must leave alone.
      db.run(
        sql.raw(
          `create trigger other_probe_copy after insert on live_probe for each row ` +
            `begin insert into other_probe values (new.id); end`,
        ),
      );
      await installChangeFeed(db, [{ table: "live_probe", type: "probe" }]);
    },
  });

  // The feed goes back at the end because the suite's reset replays the triggers it found after
  // setup, and a drop of one that is gone fails it.
  it("stops recording changes and leaves a trigger it did not install in place", async () => {
    try {
      removeChangeFeed(suite.db);
      suite.db.run(sql.raw(`insert into live_probe values ('p1')`));
      expect(suite.db.execute(sql`select * from change_log`).rows).toEqual([]);
      expect(
        suite.db.execute<{ id: string }>(sql`select id from other_probe`).rows.map((r) => r.id),
      ).toEqual(["p1"]);
    } finally {
      await installChangeFeed(suite.db, [{ table: "live_probe", type: "probe" }]);
    }
  });
});
