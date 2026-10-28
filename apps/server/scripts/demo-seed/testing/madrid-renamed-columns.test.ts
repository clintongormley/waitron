import { expect, it } from "vitest";
import { madridWithRenamedColumns, type MadridColumnRenames } from "./madrid-renamed-columns.js";
import type { CanonicalMadridSemantics, MadridColumn } from "./madrid-semantics.js";

const column = (name: string): MadridColumn => ({
  name,
  type: "INTEGER",
  notnull: 1,
  dflt_value: null,
  pk: 0,
});
const foreignKey = {
  id: 0,
  seq: 0,
  table: "sales",
  from: "sale_id",
  to: "id",
  on_update: "NO ACTION",
  on_delete: "NO ACTION",
  match: "NONE",
};
const plainKey = '{"guests":4,"sale_id":"@sales:a"}';
const original: CanonicalMadridSemantics = {
  tables: {
    sale_receipt_guests: {
      columns: [column("sale_id"), column("guests")],
      foreignKeys: [foreignKey],
      rows: { [plainKey]: { sale_id: "@sales:a", guests: 4 } },
    },
    tables_with_id: {
      columns: [column("id"), column("guests")],
      foreignKeys: [],
      rows: { "@tables_with_id:x": { id: "@tables_with_id:x", guests: 2 } },
    },
  },
};
const renames: MadridColumnRenames = {
  sale_receipt_guests: { guests: "guest_count", sale_id: "receipt_sale_id" },
  tables_with_id: { guests: "guest_count" },
};

it("renames the column, its foreign key and its row cells, leaving the capture untouched", () => {
  const before = structuredClone(original);
  const updated = madridWithRenamedColumns(original, renames);
  const receipts = updated.tables.sale_receipt_guests!;
  expect(receipts.columns.map((entry) => entry.name)).toEqual(["receipt_sale_id", "guest_count"]);
  expect(receipts.foreignKeys).toEqual([{ ...foreignKey, from: "receipt_sale_id" }]);
  expect(receipts.rows).toEqual({
    '{"guest_count":4,"receipt_sale_id":"@sales:a"}': {
      receipt_sale_id: "@sales:a",
      guest_count: 4,
    },
  });
  expect(updated.tables.tables_with_id!.rows).toEqual({
    "@tables_with_id:x": { id: "@tables_with_id:x", guest_count: 2 },
  });
  expect(original).toEqual(before);
});

it("sorts re-keyed rows as the canonical capture does", () => {
  const capture: CanonicalMadridSemantics = {
    tables: {
      t: {
        columns: [column("a"), column("b")],
        foreignKeys: [],
        rows: { '{"a":1,"b":2}': { a: 1, b: 2 }, '{"a":2,"b":1}': { a: 2, b: 1 } },
      },
    },
  };
  const updated = madridWithRenamedColumns(capture, { t: { a: "z" } });
  expect(Object.keys(updated.tables.t!.rows)).toEqual(['{"b":1,"z":2}', '{"b":2,"z":1}']);
});

it.each<[MadridColumnRenames, string]>([
  [{ missing_table: { guests: "guest_count" } }, "missing_table.guests"],
  [{ sale_receipt_guests: { missing: "guest_count" } }, "sale_receipt_guests.missing"],
  [{ sale_receipt_guests: { guests: "sale_id" } }, "sale_receipt_guests.guests"],
  [{ sale_receipt_guests: { guests: "guests" } }, "sale_receipt_guests.guests"],
  [
    { sale_receipt_guests: { guests: "guest_count", sale_id: "guest_count" } },
    "sale_receipt_guests.sale_id",
  ],
  [
    { sale_receipt_guests: { guests: "guest_count", guest_count: "count" } },
    "sale_receipt_guests.guest_count",
  ],
  [{ missing_table: {} }, "missing_table"],
  [{ sale_receipt_guests: {} }, "sale_receipt_guests"],
])("refuses an unused or invalid column rename %#", (invalid, cell) => {
  expect(() => madridWithRenamedColumns(original, invalid)).toThrow(
    `unused or invalid Madrid column rename: ${cell}`,
  );
});
