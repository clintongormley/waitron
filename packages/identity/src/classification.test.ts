import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tablesCreatedBy } from "@waitron/sync-enrolment";
import { IDENTITY_CLASSIFICATION } from "./classification.js";

const DRIZZLE = join(import.meta.dirname, "..", "drizzle");

function tablesInDrizzle(): Set<string> {
  return tablesCreatedBy(
    readdirSync(DRIZZLE)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(DRIZZLE, f), "utf8")),
  );
}

describe("IDENTITY_CLASSIFICATION", () => {
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
  it("classifies exactly the tables this module's migrations create", () => {
    const classified = new Set(IDENTITY_CLASSIFICATION.map((c) => c.table));
    const created = tablesInDrizzle();
    // The control: the assertion below, which catches a NEW table nobody classified, passes
    // against an empty `created`.
    expect(created.size).toBeGreaterThan(0);
    expect([...created].filter((t) => !classified.has(t)).sort()).toEqual([]);
    expect([...classified].filter((t) => !created.has(t)).sort()).toEqual([]);
  });
});
