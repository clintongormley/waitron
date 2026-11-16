import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { madridWithRenamedTables } from "./madrid-renamed-tables.js";
import { stable, type CanonicalMadridSemantics } from "./madrid-semantics.js";

const captured: CanonicalMadridSemantics = {
  tables: {
    catalogues: {
      columns: [],
      foreignKeys: [],
      rows: { '@catalogues:["Lunch"]': { id: '@catalogues:["Lunch"]', name: "Lunch" } },
    },
    sections: {
      columns: [],
      foreignKeys: [
        {
          id: 0,
          seq: 0,
          table: "catalogues",
          from: "owner_menu_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "RESTRICT",
          match: "NONE",
        },
      ],
      rows: {
        '@sections:["@catalogues:[\\"Lunch\\"]","root"]': {
          id: '@sections:["@catalogues:[\\"Lunch\\"]","root"]',
          owner_menu_id: '@catalogues:["Lunch"]',
        },
      },
    },
    menu_versions: {
      columns: [],
      foreignKeys: [],
      rows: {
        version: {
          id: "version",
          content_hash: "old-hash",
          document: { menuId: '@catalogues:["Lunch"]' },
        },
      },
    },
    menu_publications: {
      columns: [],
      foreignKeys: [],
      rows: { publication: { id: "publication", content_hash: "old-hash" } },
    },
  },
};

it.each([
  ["sessions", "till_sessions"],
  ["management_sessions", "dashboard_sessions"],
  ["management_account_actions", "account_actions"],
])("renames captured %s row identities", (oldName, newName) => {
  const source = structuredClone(captured);
  source.tables[oldName!] = {
    columns: [],
    foreignKeys: [],
    rows: { [`@${oldName}:["person"]`]: { id: `@${oldName}:["person"]`, person_id: "person" } },
  };
  const result = madridWithRenamedTables(source, { [oldName!]: newName! });
  expect(result.tables[newName!]!.rows).toEqual({
    [`@${newName}:["person"]`]: { id: `@${newName}:["person"]`, person_id: "person" },
  });
});
it("renames a table, every key targeting it, nested identities and document hashes", () => {
  const original = structuredClone(captured);
  const result = madridWithRenamedTables(captured, { catalogues: "menus" });
  expect(result.tables.catalogues).toBeUndefined();
  expect(result.tables.menus!.rows).toEqual({
    '@menus:["Lunch"]': { id: '@menus:["Lunch"]', name: "Lunch" },
  });
  expect(result.tables.sections!.foreignKeys[0]!.table).toBe("menus");
  expect(result.tables.sections!.rows).toEqual({
    '@sections:["@menus:[\\"Lunch\\"]","root"]': {
      id: '@sections:["@menus:[\\"Lunch\\"]","root"]',
      owner_menu_id: '@menus:["Lunch"]',
    },
  });
  const hash = createHash("sha256")
    .update(stable({ menuId: '@menus:["Lunch"]' }))
    .digest("hex");
  expect(result.tables.menu_versions!.rows.version).toEqual({
    id: "version",
    document: { menuId: '@menus:["Lunch"]' },
    content_hash: hash,
  });
  expect(result.tables.menu_publications!.rows.publication!.content_hash).toBe(hash);
  expect(captured).toEqual(original);
});
it.each<Record<string, string>>([
  { absent: "menus" },
  { catalogues: "sections" },
  { catalogues: "catalogues" },
])("refuses an unused rename %j", (renames) => {
  expect(() => madridWithRenamedTables(captured, renames)).toThrow(
    "unused or invalid Madrid table rename",
  );
});

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
