import { expect, it } from "vitest";
import { madridWithNameChanges, type MadridNameChange } from "./madrid-name-changes.js";
import type { CanonicalMadridSemantics } from "./madrid-semantics.js";

const key = '@products:["bread.webp"]';
const original: CanonicalMadridSemantics = {
  tables: {
    products: {
      columns: [],
      foreignKeys: [],
      rows: { [key]: { id: key, name: "House bread", kitchen_name: null, unit_price: 250 } },
    },
    menu_versions: { columns: [], foreignKeys: [], rows: {} },
  },
};
const change: MadridNameChange = {
  table: "products",
  row: key,
  column: "name",
  old: "House bread",
  new: "Bread",
};

it("accepts a named cell while retaining the original price and capture", () => {
  const updated = madridWithNameChanges(original, [change]);
  expect(updated.tables.products!.rows[key]).toEqual({
    id: key,
    name: "Bread",
    kitchen_name: null,
    unit_price: 250,
  });
  expect(original.tables.products!.rows[key]!.name).toBe("House bread");
});

it.each([
  [{ ...change, column: "unit_price", old: 250, new: "300" }],
  [{ ...change, column: "customer_name", old: null }],
  [{ ...change, row: "missing" }],
  [{ ...change, old: "Wrong original" }],
  [{ ...change, new: "House bread" }],
  [change, change],
])("refuses an unreviewed, unused or repeated name allowance %#", (...changes) => {
  expect(() => madridWithNameChanges(original, changes)).toThrow(
    "unused or invalid Madrid name change",
  );
});
