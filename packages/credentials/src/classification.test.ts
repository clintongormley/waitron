import { describe, expect, it } from "vitest";
import { CORE_CLASSIFICATION } from "@waitron/db";
import { CREDENTIALS_TABLES } from "./tables.js";

/** This module's share of the classification of the set that holds its tables. */
const CREDENTIALS_CLASSIFICATION = CORE_CLASSIFICATION.filter(({ table }) =>
  (CREDENTIALS_TABLES as readonly string[]).includes(table),
);

describe("CREDENTIALS_CLASSIFICATION", () => {
  it("has a valid class and a non-empty reason for every entry", () => {
    for (const c of CREDENTIALS_CLASSIFICATION) {
      expect(["ledger", "state", "local"]).toContain(c.class);
      expect(c.reason.trim().length).toBeGreaterThan(0);
    }
  });
  it("names each table at most once", () => {
    const names = CREDENTIALS_CLASSIFICATION.map((c) => c.table);
    expect(new Set(names).size).toBe(names.length);
  });
  it("classifies tenant_credentials as local", () => {
    const entry = CREDENTIALS_CLASSIFICATION.find((c) => c.table === "tenant_credentials");
    expect(entry?.class).toBe("local");
  });
  it("lists only tables the set holding them classifies", () => {
    const classified = new Set(CORE_CLASSIFICATION.map((c) => c.table));
    expect(CREDENTIALS_TABLES.length).toBeGreaterThan(0);
    expect(CREDENTIALS_TABLES.filter((t) => !classified.has(t))).toEqual([]);
  });
});
