// A real venue file, not `:memory:` and not a container: the triggers under test are ordinary
// SQLite triggers, so what they write is visible to the one handle the engine gives a file
// (CLAUDE.md §4). The suite this replaces ran on a container because it watched the change rows
// from a SECOND connection while the writing transaction was open, and because one case set
// `session_replication_role = replica`. Neither survives the storage switch: there is one writer
// per file here, and this engine has no apply worker and no `ENABLE ALWAYS`.
//
// EVERY expectation below is what PostgreSQL's `waitron_record_change()` wrote, measured rather
// than remembered — `origin/main`'s function body run on PGlite over three probe tables, one per
// shape (2026-09-22). The keyless and null-identity cases are that measurement's answer: the
// PL/pgSQL read `changed_row ->> 'id'` out of a row rendered as JSON, so a missing column and a
// null column both gave null, and `jsonb_strip_nulls` then dropped the key. `new."id"` is a
// PREPARE error on a table with no such column, so the same answer has to be reached a different
// way, and sixteen of the eighty-nine declared sources are keyless.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { ResourceChange } from "@waitron/shared";
import { installChangeFeed } from "./change-feed.js";
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
        sql.raw(
          `create table live_probe_keyless (left_id text not null, right_id text not null,` +
            ` primary key (left_id, right_id))`,
        ),
      );
      await installChangeFeed(db, [
        {
          table: "live_probe",
          type: "print-job",
          related: [{ type: "printer", column: "printer_id" }],
        },
        // A source with no related objects at all — most of the real sources are this shape, and
        // an omitted list has to become an empty list rather than the word "undefined".
        { table: "live_probe_alone", type: "alone" },
        { table: "live_probe_keyless", type: "keyless" },
      ]);
    },
  });

  /**
   * What the change log holds, sorted by its rendered JSON rather than read in write order.
   *
   * Nothing downstream reads the order two changes arrive in: the dashboard's live API gathers a
   * batch's identities into a `Map` and flushes the values (`apps/server/src/live-api.ts`, `const
   * pending = new Map<…>`). What the assertions rest on is the event COUNT and each event's
   * contents, and the sort leaves both alone.
   */
  function changes(): ResourceChange[] {
    return suite.db
      .execute<{ payload: string }>(sql`select payload from change_log`)
      .rows.map((row) => JSON.parse(row.payload) as ResourceChange)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

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

  // The PL/pgSQL opened with `if TG_OP = 'UPDATE' and NEW is not distinct from OLD then return
  // null`. SQLite fires a row trigger for an UPDATE that changes nothing, so the same silence has
  // to be bought with a `when` clause — and the case above is this one's control, because a `when`
  // clause that refused everything would pass here and fail there.
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
