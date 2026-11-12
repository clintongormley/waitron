import { describe, expect, it } from "vitest";
import { CORE_CLASSIFICATION } from "@waitron/db";
import { IDENTITY_CHANGE_SOURCES, IDENTITY_TABLES } from "./classification.js";

/** This module's share of the classification of the set that holds its tables. */
const IDENTITY_CLASSIFICATION = CORE_CLASSIFICATION.filter(({ table }) =>
  (IDENTITY_TABLES as readonly string[]).includes(table),
);

describe("IDENTITY_CLASSIFICATION", () => {
  it("owns job roles and refreshes a holder when their job roles change", () => {
    expect(IDENTITY_TABLES).toContain("staff_roles");
    expect(IDENTITY_TABLES).toContain("person_staff_roles");
    expect(IDENTITY_CHANGE_SOURCES).toContainEqual({ table: "staff_roles", type: "staff_roles" });
    expect(IDENTITY_CHANGE_SOURCES).toContainEqual({
      table: "person_staff_roles",
      type: "person_staff_roles",
      related: [{ type: "persons", column: "person_id" }],
    });
  });
  it("has a valid class and a non-empty reason for every entry", () => {
    for (const c of IDENTITY_CLASSIFICATION) {
      expect(["ledger", "state", "local"]).toContain(c.class);
      expect(c.reason.trim().length).toBeGreaterThan(0);
    }
  });
  it("names each table at most once", () => {
    const names = IDENTITY_CLASSIFICATION.map((c) => c.table);
    expect(new Set(names).size).toBe(names.length);
  });
  it("lists only tables the set holding them classifies", () => {
    const classified = new Set(CORE_CLASSIFICATION.map((c) => c.table));
    expect(IDENTITY_TABLES.length).toBeGreaterThan(0);
    expect(IDENTITY_TABLES.filter((t) => !classified.has(t))).toEqual([]);
  });
});
