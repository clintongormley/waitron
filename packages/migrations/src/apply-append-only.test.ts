// A real venue directory migrated by the product's own entry point: a mock asserting
// `installAppendOnlyTriggers` was called would pass with the triggers absent.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { openVenueDatabase, type Database } from "@waitron/db";
import { applyMigrations } from "./apply.js";
import { manifestSets, migrationOptionsFor } from "./manifest.js";

/**
 * Three declared tables, from two different migration sets and both classes.
 *
 * `sales` and `order_amendments` belong to `core` — the second classified `state`, so a wiring that
 * read the CLASS would miss it — and `time_entries` belongs to `workforce`, which is what shows the
 * install running for more than the first set. The fiscal set's own table is asserted by
 * `scripts/append-only-triggers.test.ts`; it cannot be named in this package, because
 * `scripts/english-only.test.ts` gives a fiscal term one declaring home.
 */
const APPEND_ONLY_TABLES = ["sales", "order_amendments", "time_entries"] as const;
/**
 * The controls, in the other direction — both must still take a delete after the same migrate.
 *
 * `payments` is the sharp one: it is classified `ledger` and is deliberately NOT append-only,
 * because `packages/payments/src/store.ts` moves a card payment's row through its states. A wiring
 * that read the CLASS rather than the `appendOnly()` declaration would refuse those.
 * `locations` is an ordinary `state` table.
 */
const WRITABLE_TABLES = ["payments", "locations"] as const;

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function freshVenue(): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-append-only-"));
  scratch.push(dir);
  return dir;
}

/**
 * The refusal the DRIVER raised, dug out of the chain Drizzle wraps it in. Drizzle's wrapper
 * message is `Failed to run the query '<the statement>'`, so a match on the table name would pass
 * whether a trigger fired or not.
 */
function refusal(body: () => unknown): { message: string; errcode: number } {
  try {
    body();
  } catch (error) {
    let layer: unknown = error;
    while (layer !== null && typeof layer === "object") {
      const { errcode, message } = layer as { errcode?: unknown; message?: unknown };
      if (typeof errcode === "number" && typeof message === "string") return { message, errcode };
      layer = (layer as { cause?: unknown }).cause;
    }
    throw new Error("no driver refusal in the cause chain", { cause: error });
  }
  throw new Error("the statement was accepted");
}

/**
 * One row in `table`, so that a row trigger has something to fire on.
 *
 * A `BEFORE UPDATE`/`BEFORE DELETE` trigger is FOR EACH ROW — the only kind SQLite has — so on an
 * EMPTY table both statements succeed and change nothing, and every assertion below would pass
 * whether the triggers existed or not. Foreign keys and check constraints are turned off around the
 * insert, which is what lets one generic row satisfy a table without building its parents; neither
 * pragma touches triggers.
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
    if (declared.includes("INT") || declared.includes("REAL") || declared.includes("NUM")) {
      return "1";
    }
    return declared.includes("BLOB") ? "x'00'" : "'1'";
  };
  db.run(
    sql.raw(
      columns.length === 0
        ? `insert into "${table}" default values`
        : `insert into "${table}" (${columns.map((c) => `"${c.name}"`).join(", ")}) ` +
            `values (${columns.map((c) => value(c.type)).join(", ")})`,
    ),
  );
}

/** Rows in `table`. */
function rowCount(db: Database, table: string): number {
  return db.all<{ n: number }>(sql.raw(`select cast(count(*) as int) as n from "${table}"`))[0]!.n;
}

/** Opens the migrated venue file, runs `body` against it, and closes both files. */
async function withVenue<T>(directory: string, body: (db: Database) => T): Promise<T> {
  const store = await openVenueDatabase(directory);
  try {
    return body(store.venue);
  } finally {
    await store.close();
  }
}

describe("applyMigrations installs the append-only triggers on the product's own path", () => {
  it("leaves every declared table refusing an update and a delete", async () => {
    const venue = freshVenue();
    await applyMigrations(venue, migrationOptionsFor(manifestSets(), null));

    await withVenue(venue, (db) => {
      for (const table of APPEND_ONLY_TABLES) {
        seedOneRow(db, table);
        expect(
          refusal(() => db.run(sql.raw(`update "${table}" set "rowid" = "rowid"`))),
        ).toMatchObject({ message: `${table} is append-only`, errcode: 1811 });
        expect(refusal(() => db.run(sql.raw(`delete from "${table}"`)))).toMatchObject({
          message: `${table} is append-only`,
          errcode: 1811,
        });
        // The row the statements tried to change is still the row that was written.
        expect(rowCount(db, table)).toBe(1);
      }
    });
  });

  it("leaves a ledger table nobody declared append-only writable — the control", async () => {
    const venue = freshVenue();
    await applyMigrations(venue, migrationOptionsFor(manifestSets(), null));

    await withVenue(venue, (db) => {
      for (const table of WRITABLE_TABLES) {
        seedOneRow(db, table);
        db.run(sql.raw(`delete from "${table}"`));
        expect(rowCount(db, table)).toBe(0);
      }
    });
  });

  it("applies a partial set list, protecting only the tables that set created", async () => {
    // Boot in trading mode hands over the ENABLED modules only, and some demo scripts a named
    // subset, so a run that reached for every declared name rather than the ones belonging to the
    // sets in front of it would ask for a table nothing had created.
    const venue = freshVenue();
    const core = manifestSets().filter((set) => set.name === "core");
    await expect(applyMigrations(venue, migrationOptionsFor(core, null))).resolves.toBeUndefined();

    await withVenue(venue, (db) => {
      seedOneRow(db, "sales");
      expect(refusal(() => db.run(sql.raw(`delete from "sales"`))).message).toBe(
        "sales is append-only",
      );
      // …and `workforce`'s own declared table was never reached, because its set never ran.
      expect(
        db.all(sql.raw(`select name from sqlite_master where name = 'time_entries'`)),
      ).toHaveLength(0);
    });
  });

  it("is a no-op on a second run over a database that already carries them", async () => {
    // This is what lets the install sit on the boot path rather than in a one-shot install: every
    // boot of a healthy box runs it again.
    const venue = freshVenue();
    const options = migrationOptionsFor(manifestSets(), null);
    await applyMigrations(venue, options);
    await expect(applyMigrations(venue, options)).resolves.toBeUndefined();

    await withVenue(venue, (db) => {
      seedOneRow(db, "time_entries");
      expect(refusal(() => db.run(sql.raw(`delete from "time_entries"`))).message).toBe(
        "time_entries is append-only",
      );
    });
  });
});
