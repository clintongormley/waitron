import { describe, expect, it } from "vitest";
import {
  appendOnly,
  appendOnlyTablesIn,
  classify,
  tablesForPublication,
  type ClassifiedTable,
} from "./classification.js";

describe("classify", () => {
  it("records the table name, class and reason", () => {
    expect(classify("sales", "ledger", "what happened")).toEqual({
      table: "sales",
      class: "ledger",
      reason: "what happened",
    });
  });

  it("does not mark a table append-only, whatever its class", () => {
    // The marker is what `orderedMigrationSets` filters on, so a `classify` that set it would
    // protect every ledger table.
    expect(classify("payments", "ledger", "r").appendOnly).toBeUndefined();
  });
});

describe("appendOnly", () => {
  it("records the same three fields and marks the table", () => {
    expect(appendOnly("sales", "ledger", "what happened")).toEqual({
      table: "sales",
      class: "ledger",
      reason: "what happened",
      appendOnly: true,
    });
  });

  it("marks a `state` table too — the class and the marker are independent", () => {
    expect(appendOnly("order_amendments", "state", "hash-chained").appendOnly).toBe(true);
  });
});

describe("tablesForPublication", () => {
  const set: ClassifiedTable[] = [
    classify("sales", "ledger", "r"),
    classify("payments", "ledger", "r"),
    classify("tenants", "state", "r"),
    classify("deployment", "local", "r"),
  ];
  it("returns only the ledger tables for the ledger class", () => {
    expect(tablesForPublication(set, "ledger").sort()).toEqual(["payments", "sales"]);
  });
  it("returns only the state tables for the state class", () => {
    expect(tablesForPublication(set, "state")).toEqual(["tenants"]);
  });
  it("never returns a local table, for either class", () => {
    expect(tablesForPublication(set, "ledger")).not.toContain("deployment");
    expect(tablesForPublication(set, "state")).not.toContain("deployment");
  });
});

describe("appendOnlyTablesIn", () => {
  const set: ClassifiedTable[] = [
    appendOnly("sale_voids", "ledger", "what happened"),
    classify("payments", "ledger", "a card payment's progress is updated"),
    appendOnly("order_amendments", "state", "hash-chained"),
    classify("deployment", "local", "this node's own record"),
  ];

  it("returns the names of the marked tables and nothing else", () => {
    // A filter written on the class instead would get both directions above wrong.
    expect(appendOnlyTablesIn(set)).toEqual(["sale_voids", "order_amendments"]);
  });

  it("keeps declaration order", () => {
    // `installAppendOnlyTriggers` is handed this list, and the migration descriptors compared by
    // `scripts/append-only-migration-sets.test.ts` are compared as sequences.
    expect(appendOnlyTablesIn([...set].reverse())).toEqual(["order_amendments", "sale_voids"]);
  });

  it("returns nothing for a set that marks nothing", () => {
    expect(appendOnlyTablesIn([classify("tenants", "state", "r")])).toEqual([]);
  });
});
