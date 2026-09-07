import { describe, expect, it } from "vitest";
import { classify, tablesForPublication, type ClassifiedTable } from "./classification.js";

describe("classify", () => {
  it("records the table name, class and reason", () => {
    expect(classify("sales", "ledger", "what happened")).toEqual({
      table: "sales",
      class: "ledger",
      reason: "what happened",
    });
  });
});

describe("tablesForPublication", () => {
  const set: ClassifiedTable[] = [
    classify("sales", "ledger", "r"),
    classify("payments", "ledger", "r"),
    classify("tenants", "state", "r"),
    classify("deployment", "local", "r"),
  ];
  it("returns only the ledger tables for the ledger publication", () => {
    expect(tablesForPublication(set, "ledger").sort()).toEqual(["payments", "sales"]);
  });
  it("returns only the state tables for the state publication", () => {
    expect(tablesForPublication(set, "state")).toEqual(["tenants"]);
  });
  it("excludes local tables from both publications", () => {
    expect(tablesForPublication(set, "ledger")).not.toContain("deployment");
    expect(tablesForPublication(set, "state")).not.toContain("deployment");
  });
});
