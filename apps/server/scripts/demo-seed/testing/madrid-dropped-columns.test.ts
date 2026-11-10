import { expect, it } from "vitest";
import { madridWithDroppedColumns } from "./madrid-dropped-columns.js";
import type { CanonicalMadridSemantics, MadridColumn } from "./madrid-semantics.js";

const column = (name: string): MadridColumn => ({
  name,
  type: "TEXT",
  notnull: 1,
  dflt_value: null,
  pk: 0,
});
const original: CanonicalMadridSemantics = {
  tables: {
    departments: {
      columns: [column("id"), column("location_id"), column("name")],
      foreignKeys: [
        {
          id: 0,
          seq: 0,
          table: "locations",
          from: "location_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "RESTRICT",
          match: "NONE",
        },
      ],
      rows: {
        "@departments:a": { id: "@departments:a", location_id: "@locations:a", name: "Bar" },
      },
    },
  },
};

it("drops the named column and its foreign key, keeps other cells, and leaves the capture unchanged", () => {
  const before = structuredClone(original);
  const updated = madridWithDroppedColumns(original, { departments: ["location_id"] });
  expect(updated.tables.departments!.columns.map((entry) => entry.name)).toEqual(["id", "name"]);
  expect(updated.tables.departments!.foreignKeys).toEqual([]);
  expect(updated.tables.departments!.rows).toEqual({
    "@departments:a": { id: "@departments:a", name: "Bar" },
  });
  expect(original).toEqual(before);
});

it("refuses a table missing from the frozen capture", () => {
  expect(() => madridWithDroppedColumns(original, { missing: ["location_id"] })).toThrow(
    "missing Madrid table: missing",
  );
});

it("rekeys routing cells and their references when location leaves their identity", () => {
  const old = '@routing_cells:["@locations:a","@categories:drinks",null,null]';
  const capture: CanonicalMadridSemantics = {
    tables: {
      routing_cells: {
        columns: ["id", "location_id", "category_id", "product_id", "zone_id"].map(column),
        foreignKeys: [],
        rows: {
          [old]: {
            id: old,
            location_id: "@locations:a",
            category_id: "@categories:drinks",
            product_id: null,
            zone_id: null,
          },
        },
      },
      routing_cell_periods: {
        columns: [column("id"), column("cell_id")],
        foreignKeys: [],
        rows: { "@periods:one": { id: "@periods:one", cell_id: old } },
      },
    },
  };
  const updated = madridWithDroppedColumns(capture, { routing_cells: ["location_id"] });
  const key = '@routing_cells:["@categories:drinks",null,null]';
  expect(updated.tables.routing_cells!.rows).toEqual({
    [key]: { id: key, category_id: "@categories:drinks", product_id: null, zone_id: null },
  });
  expect(updated.tables.routing_cell_periods!.rows).toEqual({
    "@periods:one": { id: "@periods:one", cell_id: key },
  });
});
