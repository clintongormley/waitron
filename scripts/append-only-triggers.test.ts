import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { packageDirOf } from "../packages/module/src/module.js";
import { installAppendOnlyTriggers } from "../packages/store/src/append-only.js";
import { drizzleNodeSqlite } from "../packages/store/src/node-sqlite-adapter.js";

/**
 * Every table classified `ledger` refuses an update and a delete — checked by trying both against a
 * real database built from the tree's own migrations, not by reading SQL as text.
 *
 * The enforcement moved from the schema to the runtime with the storage switch. PostgreSQL carried
 * `reject_mutation()` triggers written into each migration, and the guard that stood here before
 * (`append-only-enable-always.test.ts`) paired each one with an `ENABLE ALWAYS`, because the
 * replication apply worker skipped ordinary triggers. SQLite has neither an apply worker nor
 * `ENABLE ALWAYS`, and the triggers are now installed by `installAppendOnlyTriggers` from the
 * modules' own `ledger` classification. So the thing worth guarding changed shape: not "is each
 * written trigger also enabled", but "does the classification actually reach every ledger table".
 *
 * WHY A TREE-WIDE ROOT-PROJECT PROGRAM. The classification is assembled in one package
 * (`@waitron/composition`), the tables are created by every domain package's `drizzle/` directory,
 * and the installer lives in a third (`@waitron/store`). No package suite can see all three, so
 * this sits in the root Vitest project beside `classification-complete.test.ts` — and, like
 * everything under `scripts/`, it is NOT typechecked, so it stays plain.
 *
 * WHAT IT DOES NOT COVER. It proves the refusal for a plain `UPDATE` and a plain `DELETE` only.
 * The other two shapes a ledger row can be rewritten through — `INSERT OR REPLACE` and
 * `INSERT … ON CONFLICT DO UPDATE` — need a conflicting key, which is per-table, so they are proven
 * once against the trigger pair in `packages/store/src/append-only.test.ts` instead. And nothing
 * here runs the installer on the BOOT path: what calls it in production is still to be wired, and
 * `docs/handoffs/2026-09-21-f1-the-flip.md` names the step that owes it.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/** Every table the modules classify `ledger`, from the descriptors themselves. */
function ledgerTables(): string[] {
  return ALL_MODULES.flatMap((module) => module.classification ?? [])
    .filter((entry) => entry.class === "ledger")
    .map((entry) => entry.table);
}

/** Every `drizzle/*.sql` a descriptor points at, in a fixed order. */
function migrationSql(): string[] {
  const statements: string[] = [];
  for (const module of ALL_MODULES) {
    const drizzleDir = join(PACKAGES_DIR, packageDirOf(module), "drizzle");
    let entries: string[];
    try {
      entries = readdirSync(drizzleDir);
    } catch {
      // A descriptor pointing at a package with no `drizzle/` dir (`fiscal-none` ships only
      // `meta/`). The table-count floor below catches a discovery that found too little.
      continue;
    }
    for (const name of entries.filter((n) => n.endsWith(".sql")).sort()) {
      statements.push(readFileSync(join(drizzleDir, name), "utf8"));
    }
  }
  return statements;
}

/** The real tables, drizzle's own bookkeeping excluded. */
function realTables(connection: DatabaseSync): string[] {
  return connection
    .prepare(`select name from sqlite_master where type = 'table' order by name`)
    .all()
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith("__drizzle") && !name.startsWith("sqlite_"));
}

/**
 * One row in every table, so that a row trigger has something to fire on.
 *
 * This matters more than it looks: a `BEFORE UPDATE`/`BEFORE DELETE` trigger is FOR EACH ROW — the
 * only kind SQLite has — so on an empty table both statements succeed and change nothing, and a
 * guard that skipped the seeding would pass whether the triggers existed or not.
 *
 * Foreign keys and check constraints are both turned off for the seeding, which is what lets one
 * generic row satisfy every table: measured on this tree, 64 of 108 tables take the row with checks
 * on and all 108 take it with them off. Neither pragma touches triggers, which is the thing under
 * test — and the "a state table still accepts both statements" case below is the control that says
 * so, because it runs under exactly the same two pragmas.
 */
function seedOneRowEverywhere(connection: DatabaseSync): void {
  for (const table of realTables(connection)) {
    const columns = connection
      .prepare(`pragma table_info("${table}")`)
      .all()
      .filter((column) => column.notnull === 1 || column.pk === 1);
    const value = (type: string) => {
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
 * A database carrying every migration set, one row per table, and the append-only triggers.
 *
 * `seeded` is counted before any case runs and not re-read afterwards. The cases share this one
 * connection, so a table whose triggers are MISSING has its row deleted by its own failing case,
 * and a live count taken later would report the seeding as the thing that went wrong.
 */
function buildDatabase(tables: readonly string[]): {
  connection: DatabaseSync;
  seeded: Map<string, number>;
} {
  const connection = new DatabaseSync(":memory:");
  connection.exec("pragma recursive_triggers = on");
  connection.exec("pragma foreign_keys = off");
  connection.exec("pragma ignore_check_constraints = on");
  for (const statements of migrationSql()) connection.exec(statements);
  seedOneRowEverywhere(connection);
  const seeded = new Map(
    realTables(connection).map((table) => [
      table,
      Number(connection.prepare(`select count(*) as n from "${table}"`).get().n),
    ]),
  );
  installAppendOnlyTriggers(drizzleNodeSqlite(connection, { schema: {} }), tables);
  return { connection, seeded };
}

/** What the driver said, or `undefined` if the statement was accepted. */
function refusalFor(connection: DatabaseSync, statement: string): string | undefined {
  try {
    connection.exec(statement);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("every ledger table refuses an update and a delete", () => {
  const tables = ledgerTables();
  const { connection, seeded } = buildDatabase(tables);

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
  // refusal. A `state` table is not given triggers and must still take both statements.
  it("leaves a state table writable", () => {
    const state = ALL_MODULES.flatMap((module) => module.classification ?? []).find(
      (entry) => entry.class === "state",
    );
    expect(state).toBeDefined();
    expect(refusalFor(connection, `delete from "${state.table}"`)).toBeUndefined();
  });

  // Vacuous-pass anchors. `it.each([])` reports NOTHING and exits 0, so an empty classification, a
  // discovery that read no migrations, or a schema with no tables would all look identical to a
  // fully protected tree.
  it("discovers the known ledger tables and the whole schema, at a floor", () => {
    expect(tables).toContain("registros_facturacion");
    expect(tables).toContain("sales");
    expect(tables).toContain("time_entries");
    expect(tables.length).toBeGreaterThanOrEqual(20);
    expect(realTables(connection).length).toBeGreaterThanOrEqual(100);
  });

  it("seeds a row into every ledger table, so a row trigger has something to fire on", () => {
    for (const table of tables) expect(seeded.get(table)).toBeGreaterThanOrEqual(1);
  });
});
