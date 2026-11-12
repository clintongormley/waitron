import { expect, it } from "vitest";
import type { CanonicalMadridSemantics } from "./madrid-semantics.js";
import { madridWithFoldedTables } from "./madrid-folded-tables.js";

it("folds side rows and their column/key metadata, defaults unmatched rows, and retains the capture", () => {
  const capture: CanonicalMadridSemantics = {
    tables: {
      zones: { columns: [], foreignKeys: [], rows: { a: { id: "a" }, b: { id: "b" } } },
      policies: {
        columns: [
          { name: "department_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
          { name: "override", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
          { name: "counter", type: "INTEGER", notnull: 1, dflt_value: "false", pk: 0 },
        ],
        foreignKeys: [
          {
            id: 1,
            seq: 0,
            table: "departments",
            from: "department_id",
            to: "id",
            on_update: "NO ACTION",
            on_delete: "NO ACTION",
            match: "NONE",
          },
        ],
        rows: { policy: { zone_id: "a", department_id: "d", override: "table", counter: 1 } },
      },
      days: {
        columns: [],
        foreignKeys: [
          {
            id: 0,
            seq: 0,
            table: "policies",
            from: "zone_id",
            to: "zone_id",
            on_update: "NO ACTION",
            on_delete: "CASCADE",
            match: "NONE",
          },
        ],
        rows: {},
      },
    },
  };
  const updated = madridWithFoldedTables(capture, [
    {
      from: "policies",
      into: "zones",
      match: { from: "zone_id", into: "id" },
      columns: { department_id: "department_id", override: "order_start", counter: "counter" },
    },
  ]);
  expect(Object.keys(updated.tables)).toEqual(["zones", "days"]);
  expect(updated.tables.zones!.rows).toEqual({
    a: { id: "a", department_id: "d", order_start: "table", counter: 1 },
    b: { id: "b", department_id: null, order_start: null, counter: 0 },
  });
  expect(updated.tables.zones!.columns).toEqual([
    { name: "department_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "order_start", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
    { name: "counter", type: "INTEGER", notnull: 1, dflt_value: "false", pk: 0 },
  ]);
  expect(updated.tables.zones!.foreignKeys).toEqual([
    {
      id: 0,
      seq: 0,
      table: "departments",
      from: "department_id",
      to: "id",
      on_update: "NO ACTION",
      on_delete: "NO ACTION",
      match: "NONE",
    },
  ]);
  expect(updated.tables.days!.foreignKeys).toEqual([
    {
      id: 0,
      seq: 0,
      table: "zones",
      from: "zone_id",
      to: "id",
      on_update: "NO ACTION",
      on_delete: "CASCADE",
      match: "NONE",
    },
  ]);
  expect(capture.tables.zones!.rows).toEqual({ a: { id: "a" }, b: { id: "b" } });
  expect(capture.tables).toHaveProperty("policies");
});
