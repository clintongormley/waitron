import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { is } from "drizzle-orm";
import { fromDeclaration } from "../testing/schema-conformance.js";
import * as hosted from "./hosted.js";
import * as core from "./index.js";

// The module sets' own conformance suites, which build these tables from their migrations, live in
// the module packages: a `packages/db` test cannot import a module's migration set. This suite reads
// the declarations alone.

function tablesIn(module: Record<string, unknown>): SQLiteTable[] {
  return Object.values<unknown>(module).filter((value): value is SQLiteTable =>
    is(value, SQLiteTable),
  );
}

const hostedTables = tablesIn(hosted);
const coreNames = new Set(tablesIn(core).map((table) => getTableConfig(table).name));
const knownNames = new Set([
  ...coreNames,
  ...hostedTables.map((table) => getTableConfig(table).name),
]);

describe("tables a module's set creates, declared in @waitron/db", () => {
  it("declares tables", () => {
    expect(hostedTables.length).toBeGreaterThan(0);
  });

  it.each(hostedTables.map((table) => [getTableConfig(table).name, table] as const))(
    "%s is not also in core's barrel, so core's generator never claims it",
    (name) => {
      expect(coreNames.has(name)).toBe(false);
    },
  );

  it.each(hostedTables.map((table) => [getTableConfig(table).name, table] as const))(
    "%s's foreign keys point at declared tables and columns",
    (_name, table) => {
      for (const key of getTableConfig(table).foreignKeys) {
        const reference = key.reference();
        const target = getTableConfig(reference.foreignTable);
        expect(knownNames.has(target.name)).toBe(true);
        const targetColumns = new Set(target.columns.map((column) => column.name));
        for (const column of reference.foreignColumns) {
          expect(targetColumns.has(column.name)).toBe(true);
        }
      }
      // Builds every index, check and unique constraint the declaration's callback returns.
      expect(fromDeclaration(table).columns).not.toEqual({});
    },
  );

  const computedDefaults = hostedTables.flatMap((table) => {
    const config = getTableConfig(table);
    return config.columns
      .filter((column) => column.defaultFn !== undefined)
      .map((column) => [`${config.name}.${column.name}`, column] as const);
  });

  it.each(computedDefaults)(
    "%s's computed default gives a value the column can store",
    (_, column) => {
      const first = column.defaultFn!();
      const second = column.defaultFn!();
      expect(first).toBeDefined();
      expect(() => column.mapToDriverValue(first)).not.toThrow();
      // A default that is an object must be a fresh one per row, never one shared and mutable.
      if (typeof first === "object" && first !== null) expect(second).not.toBe(first);
    },
  );
});
