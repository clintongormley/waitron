import { describe, expect, it } from "vitest";
import { PAYMENTS_CLASSIFICATION } from "@waitron/payments";
import { SCHEDULER_TABLES } from "./tables.js";

/** This module's share of the classification of the set that holds its tables. */
const SCHEDULER_CLASSIFICATION = PAYMENTS_CLASSIFICATION.filter(({ table }) =>
  (SCHEDULER_TABLES as readonly string[]).includes(table),
);

describe("SCHEDULER_CLASSIFICATION", () => {
  it("has a valid class and a non-empty reason for every entry", () => {
    for (const c of SCHEDULER_CLASSIFICATION) {
      expect(["ledger", "state", "local"]).toContain(c.class);
      expect(c.reason.trim().length).toBeGreaterThan(0);
    }
  });
  it("names each table at most once", () => {
    const names = SCHEDULER_CLASSIFICATION.map((c) => c.table);
    expect(new Set(names).size).toBe(names.length);
  });
  it("lists only tables the set holding them classifies", () => {
    const classified = new Set(PAYMENTS_CLASSIFICATION.map((c) => c.table));
    expect(SCHEDULER_TABLES.length).toBeGreaterThan(0);
    expect(SCHEDULER_TABLES.filter((t) => !classified.has(t))).toEqual([]);
  });
});
