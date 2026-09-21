import { describe, expect, it } from "vitest";
import {
  appendOnly,
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
    // `toEqual` rather than a check on the one key: the marker is what `orderedMigrationSets`
    // filters on, so a `classify` that started setting it would protect every ledger table again.
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
    // `order_amendments` is the real instance: classified `state`, and one of the ten tables
    // PostgreSQL's `reject_mutation()` triggers protected.
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
