import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { applyMigrations } from "../packages/migrations/src/apply.js";
import { migrationOptionsFor } from "../packages/migrations/src/manifest.js";
import type { ConfigurationTransferTable } from "../packages/module/src/module.js";
import { orderedMigrationSets } from "../packages/module/src/module.js";
import { scratchParent } from "./scratch-dir.mjs";

/**
 * A configuration import gives every row that has an `id` a new one and rewrites only `id`,
 * foreign-key columns and the columns a table declares in `references` (`importConfigurationTables`,
 * `apps/server/src/configuration-transfer.ts`); it overwrites `locationColumns` with the importing
 * venue's location, and the export leaves out `omit` columns. Any other column the export carries
 * that holds a row's id keeps the EXPORTING venue's id. This guard fails when a column of a
 * transferred table looks like it holds an id and the import would not rewrite it.
 *
 * Weaker than its name. It knows an id column only by its NAME — ending `_id` or `_ids` — so a
 * reference spelt otherwise (`parent`, `layout`) is invisible to it. It reads the schema a real
 * migrate builds, never the rows, so it cannot tell an allow-listed column from one that started
 * holding an id after it was listed. And a `_ids` column passes when declared, though the import
 * rewrites only a whole string value equal to an id, never ids inside a list.
 */

/** Id-shaped columns that hold no id of a transferred row, each with the reason. */
const NOT_REFERENCES: Readonly<Record<string, string>> = {
  "printers.poll_id":
    "free text the operator types for a cloud-poll printer (`apps/server/src/print-api.ts`), no row's id",
};

const ID_SHAPED = /_ids?$/;

interface TableSchema {
  readonly columns: readonly string[];
  readonly foreignKeys: readonly string[];
}

/** `table.column` for every id-shaped column the import would carry across unchanged. */
function unrewrittenIdColumns(
  declarations: readonly ConfigurationTransferTable[],
  schema: (table: string) => TableSchema,
  notReferences: Readonly<Record<string, string>>,
): string[] {
  const found: string[] = [];
  for (const declaration of declarations) {
    const { columns, foreignKeys } = schema(declaration.name);
    const handled = new Set([
      "id",
      ...foreignKeys,
      ...(declaration.references ?? []),
      ...(declaration.locationColumns ?? []),
      ...(declaration.omit ?? []),
    ]);
    for (const column of columns) {
      const name = `${declaration.name}.${column}`;
      if (ID_SHAPED.test(column) && !handled.has(column) && !(name in notReferences)) {
        found.push(name);
      }
    }
  }
  return found;
}

const declarations = ALL_MODULES.flatMap((module) =>
  module.configurationTransfer?.kind === "tables" ? module.configurationTransfer.tables : [],
);

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const directory = mkdtempSync(join(scratchParent(), "wt-id-columns-guard-"));
scratch.push(directory);
await applyMigrations(directory, migrationOptionsFor(orderedMigrationSets(ALL_MODULES), null));
const connection = new DatabaseSync(join(directory, "venue.db"));
afterAll(() => connection.close());

function realSchema(table: string): TableSchema {
  return {
    columns: connection
      .prepare("select name from pragma_table_info(?)")
      .all(table)
      .map((row) => String(row.name)),
    foreignKeys: connection
      .prepare(`select "from" from pragma_foreign_key_list(?)`)
      .all(table)
      .map((row) => String(row.from)),
  };
}

/** The real declarations with one table's `references` taken away. */
function withoutReferences(table: string): ConfigurationTransferTable[] {
  return declarations.map((declaration) =>
    declaration.name === table ? { ...declaration, references: [] } : declaration,
  );
}

describe("every id-holding column of a transferred table is rewritten on import", () => {
  it("finds none the import would carry across with the exporting venue's id", () => {
    expect(unrewrittenIdColumns(declarations, realSchema, NOT_REFERENCES)).toEqual([]);
  });

  // Proof by deletion, kept as cases: each declared `references` entry is what clears its column.
  it.each([
    ["option_lists", "option_lists.default_label_id"],
    ["device_profile_home_layouts", "device_profile_home_layouts.layout_id"],
  ])("reports %s's reference column once its declaration is gone", (table, column) => {
    expect(unrewrittenIdColumns(withoutReferences(table), realSchema, NOT_REFERENCES)).toEqual([
      column,
    ]);
  });

  // The other direction: an id-shaped column that holds no row id passes once listed, and only then.
  it("passes a listed id-shaped column that is not a reference, and reports it unlisted", () => {
    expect(unrewrittenIdColumns(declarations, realSchema, {})).toEqual(["printers.poll_id"]);
  });

  it("lists only columns that exist and that the import would otherwise leave alone", () => {
    for (const name of Object.keys(NOT_REFERENCES)) {
      const [table, column] = name.split(".");
      const declaration = declarations.find((entry) => entry.name === table);
      expect(declaration, name).toBeDefined();
      expect(realSchema(table!).columns, name).toContain(column);
      const others = { ...NOT_REFERENCES };
      delete others[name];
      expect(unrewrittenIdColumns([declaration!], realSchema, others), name).toEqual([name]);
    }
  });

  // An unknown table name reads back no columns and would pass every case above.
  it("reads columns for every transferred table", () => {
    expect(declarations.length).toBeGreaterThanOrEqual(40);
    for (const declaration of declarations) {
      expect(realSchema(declaration.name).columns.length, declaration.name).toBeGreaterThan(0);
    }
  });
});
