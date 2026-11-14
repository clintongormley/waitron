import { expect, it } from "vitest";
import { madridWithRenamedTables } from "./madrid-renamed-tables.js";
import type { CanonicalMadridSemantics } from "./madrid-semantics.js";

const foreignKey = {
  id: 0,
  seq: 0,
  table: "old_table",
  from: "owner_id",
  to: "id",
  on_update: "NO ACTION",
  on_delete: "NO ACTION",
  match: "NONE",
};
const original: CanonicalMadridSemantics = {
  tables: {
    old_table: { columns: [], foreignKeys: [], rows: { one: { id: 1, legal_name: "Venue SL" } } },
    nodes: { columns: [], foreignKeys: [foreignKey], rows: { node: { owner_id: 1 } } },
  },
};

it("renames the captured table and every foreign key target without changing its rows", () => {
  const before = structuredClone(original);
  const result = madridWithRenamedTables(original, { old_table: "new_table" });
  expect(Object.keys(result.tables)).toEqual(["new_table", "nodes"]);
  expect(result.tables.new_table).toEqual({
    columns: [],
    foreignKeys: [],
    rows: { one: { id: 1, legal_name: "Venue SL" } },
  });
  expect(result.tables.nodes!.foreignKeys).toEqual([{ ...foreignKey, table: "new_table" }]);
  expect(original).toEqual(before);
});

it("leaves tables and foreign keys not named by the map unchanged", () => {
  const result = madridWithRenamedTables(original, {});
  expect(result).toEqual(original);
});
