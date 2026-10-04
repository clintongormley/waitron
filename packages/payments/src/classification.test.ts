import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tablesCreatedBy } from "@waitron/sync-enrolment";
import { PAYMENTS_CLASSIFICATION } from "./classification.js";

const DRIZZLE = join(import.meta.dirname, "..", "drizzle");

/** The tables the migrations LEAVE IN EXISTENCE — CREATEs minus later DROPs, a RENAME counting as a
 * drop of the old name and a create of the new, in filename order (`readdirSync` does not sort). */
function tablesInDrizzle(): Set<string> {
  const files = readdirSync(DRIZZLE)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(DRIZZLE, f), "utf8"));
  return tablesCreatedBy(files);
}

describe("PAYMENTS_CLASSIFICATION", () => {
  it("has a valid class and a non-empty reason for every entry", () => {
    for (const c of PAYMENTS_CLASSIFICATION) {
      expect(["ledger", "state", "local"]).toContain(c.class);
      expect(c.reason.trim().length).toBeGreaterThan(0);
    }
  });
  it("names each table at most once", () => {
    const names = PAYMENTS_CLASSIFICATION.map((c) => c.table);
    expect(new Set(names).size).toBe(names.length);
  });
  it("classifies exactly the tables this module's migrations create", () => {
    const classified = new Set(PAYMENTS_CLASSIFICATION.map((c) => c.table));
    const created = tablesInDrizzle();
    // The control: the next assertion passes against an empty `created`.
    expect(created.size).toBeGreaterThan(0);
    expect([...created].filter((t) => !classified.has(t)).sort()).toEqual([]);
    expect([...classified].filter((t) => !created.has(t)).sort()).toEqual([]);
  });
});
