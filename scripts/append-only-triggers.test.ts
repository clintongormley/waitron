import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { applyMigrations } from "../packages/migrations/src/apply.js";
import { migrationOptionsFor } from "../packages/migrations/src/manifest.js";
import { orderedMigrationSets } from "../packages/module/src/module.js";

/**
 * Every table a module declared `appendOnly()` refuses an update and a delete — checked against a
 * database the PRODUCT migrated, by trying both, not by reading SQL as text.
 *
 * **It migrates through `applyMigrations` rather than installing the triggers itself**: a guard
 * that supplies the step under test cannot see that step missing.
 *
 * **The declared set is NOT the `ledger` class**: ordinary product code updates or deletes several
 * `ledger` tables, and `order_amendments` is classified `state`. `EXPECTED` pins the difference.
 *
 * WHAT IT DOES NOT COVER. It proves the refusal for a plain `UPDATE` and a plain `DELETE` only.
 * The other two shapes a row can be rewritten through — `INSERT OR REPLACE` and
 * `INSERT … ON CONFLICT DO UPDATE` — need a conflicting key, which is per-table, so they are proven
 * once against the trigger pair in `packages/store/src/append-only.test.ts` instead. It also goes
 * through the DESCRIPTOR path (`orderedMigrationSets`); the manifest-JSON path is pinned equal to
 * it by `packages/composition/src/composition.test.ts` and driven end to end by
 * `packages/migrations/src/apply-append-only.test.ts`.
 */

/**
 * Every table the modules declare append-only, pinned by name rather than a floor: adding or
 * dropping one is a decision that should cost an edit here.
 */
const EXPECTED = [
  "daily_closes",
  "menu_version_images",
  "menu_versions",
  "order_amendments",
  "payment_resolutions",
  "registros_facturacion",
  "sale_lines",
  "sale_settlements",
  "sale_substitutions",
  "sale_voids",
  "sales",
  "tenders",
  "time_entries",
];

/** What the modules declare, through the same call boot makes. */
function declaredTables() {
  return orderedMigrationSets(ALL_MODULES).flatMap((set) => set.appendOnlyTables ?? []);
}

const scratch = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** The real tables, drizzle's own bookkeeping excluded. */
function realTables(connection) {
  return connection
    .prepare(`select name from sqlite_master where type = 'table' order by name`)
    .all()
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith("__drizzle") && !name.startsWith("sqlite_"));
}

/**
 * One row in every table, so that a row trigger has something to fire on: SQLite's triggers are
 * FOR EACH ROW only, so on an empty table an update and a delete succeed and change nothing.
 *
 * Foreign keys and check constraints are turned off for the seeding so one generic row satisfies
 * every table. Neither pragma touches triggers; the `payments` control below runs under the same
 * two. An INSERT is what the triggers permit, so seeding after they are installed is safe.
 */
function seedOneRowEverywhere(connection) {
  for (const table of realTables(connection)) {
    const columns = connection
      .prepare(`pragma table_info("${table}")`)
      .all()
      .filter((column) => column.notnull === 1 || column.pk === 1);
    const value = (type) => {
      const declared = type.toUpperCase();
      if (declared.includes("INT") || declared.includes("REAL") || declared.includes("NUM")) {
        return "1";
      }
      return declared.includes("BLOB") ? "x'00'" : "'1'";
    };
    connection.exec(
      columns.length === 0
        ? `insert into "${table}" default values`
        : `insert into "${table}" (${columns.map((c) => `"${String(c.name)}"`).join(", ")}) ` +
            `values (${columns.map((c) => value(String(c.type))).join(", ")})`,
    );
  }
}

/**
 * Takes off every trigger that is NOT one of the append-only pair. The behavioural rules a
 * migration writes refuse some of the generic seed rows (a tender after its sale's settlement, for
 * one); they are proven in `scripts/behavioural-triggers.test.ts`, and removing a trigger can only
 * make an append-only refusal harder to observe, never easier.
 */
function dropNonAppendOnlyTriggers(connection) {
  const triggers = connection
    .prepare(`select name from sqlite_master where type = 'trigger'`)
    .all()
    .map((row) => String(row.name))
    .filter(
      (name) => !name.endsWith("_append_only_update") && !name.endsWith("_append_only_delete"),
    );
  for (const name of triggers) connection.exec(`drop trigger "${name}"`);
}

/**
 * A venue file migrated by `applyMigrations`, reopened raw, with one row in every table. Raw
 * `node:sqlite` because the seeding needs two pragmas the product does not offer; a trigger belongs
 * to the file, so this connection fires the triggers the product created.
 *
 * `seeded` is counted before any case runs: the cases share this connection, so a table whose
 * triggers are MISSING has its row deleted by its own failing case.
 */
async function migratedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "wt-append-only-guard-"));
  scratch.push(directory);
  await applyMigrations(directory, migrationOptionsFor(orderedMigrationSets(ALL_MODULES), null));
  const connection = new DatabaseSync(join(directory, "venue.db"));
  connection.exec("pragma recursive_triggers = on");
  connection.exec("pragma foreign_keys = off");
  connection.exec("pragma ignore_check_constraints = on");
  dropNonAppendOnlyTriggers(connection);
  seedOneRowEverywhere(connection);
  const seeded = new Map(
    realTables(connection).map((table) => [
      table,
      Number(connection.prepare(`select count(*) as n from "${table}"`).get().n),
    ]),
  );
  return { connection, seeded };
}

/** What the driver said, or `undefined` if the statement was accepted. */
function refusalFor(connection, statement) {
  try {
    connection.exec(statement);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const tables = declaredTables();
const { connection, seeded } = await migratedDatabase();

describe("every table declared append-only refuses an update and a delete", () => {
  it.each(tables)("%s refuses an update", (table) => {
    const column = connection.prepare(`pragma table_info("${table}")`).all()[0];
    expect(
      refusalFor(
        connection,
        `update "${table}" set "${String(column.name)}" = "${String(column.name)}"`,
      ),
    ).toBe(`${table} is append-only`);
  });

  it.each(tables)("%s refuses a delete", (table) => {
    expect(refusalFor(connection, `delete from "${table}"`)).toBe(`${table} is append-only`);
  });

  // The control, in the other direction. Without it every case above would also pass if the
  // seeding had failed, the pragmas had broken every statement, or `refusalFor` always reported a
  // refusal. `payments` is the sharp choice: it is classified `ledger` and is NOT append-only,
  // because `packages/payments/src/store.ts` moves a card payment's row through its states.
  it("leaves a ledger table nobody declared append-only writable", () => {
    expect(tables).not.toContain("payments");
    expect(refusalFor(connection, `delete from "payments"`)).toBeUndefined();
  });

  // `it.each([])` reports NOTHING and exits 0, so an empty declaration set, a migrate that created
  // nothing, or a schema with no tables would all look identical to a fully protected tree.
  it("declares exactly the tables whose rows can never be corrected", () => {
    expect([...tables].sort()).toEqual(EXPECTED);
  });

  it("migrated the whole schema, at a floor", () => {
    expect(realTables(connection).length).toBeGreaterThanOrEqual(100);
  });

  it("seeds a row into every declared table, so a row trigger has something to fire on", () => {
    for (const table of tables) expect(seeded.get(table)).toBeGreaterThanOrEqual(1);
  });
});
