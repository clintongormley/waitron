// Weaker than its name: it finds a person's table only through declared foreign keys, so a person
// id held without one, or inside a JSON column, is not seen; and it proves a column was
// classified, not that STAFFING_PERSONAL_DATA honours the classification (personal-data.test.ts's
// exact-files cases do that).
import { is } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

const CLASSIFIED: Record<
  string,
  { readonly in: readonly string[]; readonly out: readonly string[] }
> = {
  person_staff_roles: {
    in: ["staff_role_id"],
    out: ["person_id"],
  },
  shift_assignments: {
    in: ["department_id", "station_id", "staff_role_id", "shift_id"],
    out: [],
  },
};

const tables = Object.values(schema as Record<string, unknown>).flatMap((value) =>
  is(value, SQLiteTable) ? [value] : [],
);

/**
 * Whether a foreign key leads from `table` to `persons`, directly or through other tables, other
 * packages' included (`shift_assignments` reaches it through workforce's `shifts`).
 */
function reachesPersons(table: SQLiteTable, visited = new Set<SQLiteTable>()): boolean {
  if (visited.has(table)) return false;
  visited.add(table);
  return getTableConfig(table).foreignKeys.some((key) => {
    const target = key.reference().foreignTable;
    return getTableConfig(target).name === "persons" || reachesPersons(target, visited);
  });
}

const personTables = tables.filter((table) => reachesPersons(table)).map(getTableConfig);

describe("staffing personal-data classification", () => {
  it("covers every staffing table that reaches a person by foreign key, and no other", () => {
    expect(personTables.map((config) => config.name).sort()).toEqual(
      Object.keys(CLASSIFIED).sort(),
    );
  });

  it.each(personTables.map((config) => [config.name, config] as const))(
    "classifies every column of %s exactly once",
    (name, config) => {
      expect(Object.keys(CLASSIFIED)).toContain(name);
      const { in: included, out: excluded } = CLASSIFIED[name]!;
      expect(included.filter((column) => excluded.includes(column))).toEqual([]);
      expect(config.columns.map((c) => c.name).sort()).toEqual([...included, ...excluded].sort());
    },
  );
});
