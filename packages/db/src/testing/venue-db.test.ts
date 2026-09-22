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

/**
 * One row in `table`, with foreign keys and check constraints turned off so one generic value
 * satisfies every column. The technique — and the reason for it — is
 * `scripts/append-only-triggers.test.ts`'s: neither pragma touches TRIGGERS, which is what the
 * cases below are about, and the control case runs under exactly the same two.
 *
 * Both pragmas are issued outside a transaction: inside one `pragma foreign_keys` is a silent no-op
 * (measured on this branch, recorded on `packages/media/drizzle/0001_image_references.sql`).
 */
function seedOneRow(db: Database, table: string): void {
  db.run(sql.raw("pragma foreign_keys = off"));
  db.run(sql.raw("pragma ignore_check_constraints = on"));
  const columns = db
    .all<{ name: string; type: string; notnull: number; pk: number }>(
      sql.raw(`pragma table_info("${table}")`),
    )
    .filter((column) => column.notnull === 1 || column.pk === 1);
  const value = (type: string) => {
    const declared = type.toUpperCase();
    if (declared.includes("INT") || declared.includes("REAL") || declared.includes("NUM"))
      return "1";
    return declared.includes("BLOB") ? "x'00'" : "'1'";
  };
  db.run(
    sql.raw(
      `insert into "${table}" (${columns.map((c) => `"${c.name}"`).join(", ")}) ` +
        `values (${columns.map((c) => value(c.type)).join(", ")})`,
    ),
  );
}

/**
 * What the ENGINE said, or `undefined` if the statement was accepted.
 *
 * The engine's own words, never drizzle's: its wrapper message is
 * `Failed to run the query '<the statement>'`, so a `toThrow(/sales is append-only/)` against the
 * wrapper reads the STATEMENT it quoted and passes with no trigger installed at all — measured here
 * on the way to this helper, and the same false-pass shape
 * `scripts/append-only-triggers.test.ts` records for its own case.
 */
function refusalFor(db: Database, statement: string): string | undefined {
  try {
    db.run(sql.raw(statement));
    return undefined;
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    return cause instanceof Error
      ? cause.message
      : error instanceof Error
        ? error.message
        : String(error);
  }
}

/**
 * A suite's database refuses what the box refuses: every table the migrated set's own module
 * declared `appendOnly()` carries the refusal triggers.
 *
 * Why this is the helper's business and not the product's alone: the product installs them in
 * `applyMigrations` (`packages/migrations/src/apply.ts`), which a suite does not go through — it
 * hands `runMigrations` a folder and a table name. Without the install here, a test that rewrites a
 * filed sale passes and proves nothing about the box, in the one area CLAUDE.md §5 says cannot be
 * repaired afterwards.
 */
describe("a migrated set's append-only tables", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("refuses an update of a row in a table core declared append-only", () => {
    seedOneRow(suite.db, "sales");
    expect(refusalFor(suite.db, "update sales set locale = 'es-ES'")).toBe("sales is append-only");
  });

  it("refuses a delete", () => {
    seedOneRow(suite.db, "sales");
    expect(refusalFor(suite.db, "delete from sales")).toBe("sales is append-only");
  });

  // The control, in the other direction: a table nobody declared append-only takes both statements
  // under the same two pragmas. Without it, a seeding failure would look like a refusal.
  it("leaves a table nobody declared append-only writable", () => {
    seedOneRow(suite.db, "tills");
    suite.db.run(sql.raw("update tills set name = 'renamed'"));
    suite.db.run(sql.raw("delete from tills"));
    expect(count(suite.db, "tills")).toBe(0);
  });
});
