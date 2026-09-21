import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { installAppendOnlyTriggers } from "@waitron/store";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "./venue-db.js";

/**
 * The first three cases are about the CONTRACT a caller relies on — a migrated database, and data
 * emptied between tests. They came from plan task P2 and their assertions are untouched. Two things
 * about the STATEMENTS had to change, both measured on Node v26.7.0:
 *
 * - `count(*)::int` is `unrecognized token: ":"` (errcode 1); `cast(count(*) as int)` asks the
 *   engine the same question.
 * - the insert now states `created_at`. On PostgreSQL that column defaulted to `now()` SERVER-side,
 *   so a raw insert omitting it still got a value; the SQLite schema's default is `$defaultFn`,
 *   which Drizzle applies CLIENT-side and a raw insert never reaches, so the column arrives NULL
 *   and the engine answers `NOT NULL constraint failed: tenants.created_at`.
 *
 * Everything below them is new with the SQLite body: the reset is a `delete` per table rather than
 * one `TRUNCATE … CASCADE`, so the foreign keys, the append-only triggers and the identity
 * counters each need their own case.
 */
const where = (db: Database) =>
  db.all<{ file: string }>(sql`select file from pragma_database_list where name = 'main'`)[0].file;

const count = (db: Database, table: string) =>
  db.all<{ n: number }>(sql.raw(`select cast(count(*) as int) as n from "${table}"`))[0].n;

describe("useVenueDb", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("yields a migrated database", async () => {
    const result = await suite.db.execute(sql`select cast(count(*) as int) as n from tenants`);
    expect(result.rows[0]).toEqual({ n: 0 });
  });

  it("accepts a write", async () => {
    await suite.db.execute(
      sql`insert into tenants (id, country, tax_id, legal_name, created_at) values (1, 'ES', 'B00000000', 'Probe', '2026-09-21T00:00:00.000Z')`,
    );
    const result = await suite.db.execute(sql`select cast(count(*) as int) as n from tenants`);
    expect(result.rows[0]).toEqual({ n: 1 });
  });

  // The case that matters: a helper that silently stopped resetting would pass the two above.
  it("emptied the previous test's row", async () => {
    const result = await suite.db.execute(sql`select cast(count(*) as int) as n from tenants`);
    expect(result.rows[0]).toEqual({ n: 0 });
  });

  it("left the migration journal alone", () => {
    // The reset must not empty this one: the migration state has to outlive the data, or the next
    // `runMigrations` against the same file would replay every set.
    expect(count(suite.db, CORE_MIGRATIONS.migrationsTable)).toBeGreaterThan(0);
  });

  it("opens a real file on disk, not an in-memory database", () => {
    // `pragma database_list` reports the empty string for `:memory:` — measured 2026-09-21 on Node
    // v26.7.0 — so this discriminates the two.
    const file = where(suite.db);
    expect(file.endsWith(`${"/"}venue.db`)).toBe(true);
    expect(existsSync(file)).toBe(true);
  });
});

/**
 * The reset's three SQLite-only problems, each with its own table in `setup`:
 * a foreign key that makes delete ORDER matter, an append-only trigger that refuses the delete
 * outright, and an `AUTOINCREMENT` counter that `restart identity` used to reset.
 */
describe("the per-test reset", () => {
  const suite = useVenueDb({
    migrations: [],
    setup: async (db) => {
      // Named so the PARENT sorts FIRST: the reset empties tables in name order, so these two are
      // the pair that needs the foreign-key check deferred. With the names the other way round the
      // child is already empty when the parent's turn comes and the case passes whether the
      // deferral is there or not — measured, and the reason this fixture reads oddly.
      db.run(sql`create table parent (id integer primary key, name text)`);
      db.run(
        sql`create table parent_child (id integer primary key, parent_id integer not null references parent(id))`,
      );
      db.run(sql`create table guarded (id integer primary key, v text)`);
      db.run(sql`create table counted (id integer primary key autoincrement, v text)`);
      installAppendOnlyTriggers(db, ["guarded"]);
      await Promise.resolve();
    },
  });

  it("takes rows on both sides of a foreign key", () => {
    suite.db.run(sql`insert into parent (id, name) values (1, 'p')`);
    suite.db.run(sql`insert into parent_child (id, parent_id) values (1, 1)`);
    suite.db.run(sql`insert into guarded (id, v) values (1, 'a')`);
    suite.db.run(sql`insert into counted (v) values ('a')`);
    suite.db.run(sql`insert into counted (v) values ('b')`);
    expect(count(suite.db, "parent_child")).toBe(1);
  });

  it("emptied the parent as well as the row pointing at it", () => {
    expect(count(suite.db, "parent")).toBe(0);
    expect(count(suite.db, "parent_child")).toBe(0);
  });

  it("emptied the append-only table too", () => {
    expect(count(suite.db, "guarded")).toBe(0);
  });

  it("left the append-only trigger refusing an update", () => {
    // Seeded here rather than in `setup`: `FOR EACH ROW` is SQLite's only granularity, so an
    // UPDATE against an EMPTY protected table succeeds whether the trigger is there or not
    // (measured 2026-09-21) — the false pass this repository has already been bitten by.
    suite.db.run(sql`insert into guarded (id, v) values (2, 'b')`);
    expect(() => suite.db.run(sql`update guarded set v = 'c' where id = 2`)).toThrow();
    expect(count(suite.db, "guarded")).toBe(1);
  });

  it("left the append-only trigger refusing a delete", () => {
    suite.db.run(sql`insert into guarded (id, v) values (3, 'c')`);
    expect(() => suite.db.run(sql`delete from guarded where id = 3`)).toThrow();
    expect(count(suite.db, "guarded")).toBe(1);
  });

  it("restarted the identity counter", () => {
    suite.db.run(sql`insert into counted (v) values ('z')`);
    expect(suite.db.all<{ id: number }>(sql`select id from counted`)[0].id).toBe(1);
  });
});

describe("resetPerTest: false", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  it("takes a row", async () => {
    await suite.db.execute(
      sql`insert into tenants (id, country, tax_id, legal_name, created_at) values (1, 'ES', 'B00000000', 'Probe', '2026-09-21T00:00:00.000Z')`,
    );
    expect(count(suite.db, "tenants")).toBe(1);
  });

  it("still has it in the next test", () => {
    expect(count(suite.db, "tenants")).toBe(1);
  });
});

/**
 * Read at describe-body time — before any `beforeAll` has run — the same way `lifecycle.test.ts`
 * reads its accessors. The message names no function, because after the storage swap the one it
 * used to name does not exist.
 */
describe("the accessor before the suite has started", () => {
  const suite = useVenueDb({ migrations: [] });
  const early = ((): unknown => {
    try {
      return suite.db;
    } catch (error) {
      return error;
    }
  })();

  it("throws rather than handing back undefined", () => {
    expect(early).toBeInstanceOf(Error);
    // Pinned exactly rather than by a pattern: what the plan asked for is a message naming no
    // function, and only the whole string says that.
    expect((early as Error).message).toBe(
      "test database not started: the accessor was read before beforeAll ran",
    );
  });
});

/** Recorded by the two suites below and read by the one after them, once both have torn down. */
const directories: string[] = [];

describe("one temporary directory", () => {
  const suite = useVenueDb({ migrations: [] });

  it("holds both of the store's files", () => {
    const directory = dirname(where(suite.db));
    directories.push(directory);
    expect(existsSync(join(directory, "venue.db"))).toBe(true);
    expect(existsSync(join(directory, "node.db"))).toBe(true);
  });
});

describe("a second suite's temporary directory", () => {
  const suite = useVenueDb({ migrations: [] });

  it("is its own", () => {
    directories.push(dirname(where(suite.db)));
    expect(directories[1]).not.toEqual(directories[0]);
  });
});

describe("after both of those suites finished", () => {
  it("each removed its own directory", () => {
    expect(directories).toHaveLength(2);
    expect(directories.map((directory) => existsSync(directory))).toEqual([false, false]);
  });
});
