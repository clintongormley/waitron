import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tablesCreatedBy } from "@waitron/sync-enrolment";
import { CORE_CHANGE_SOURCES, CORE_CLASSIFICATION } from "./classification.js";

const DRIZZLE = join(import.meta.dirname, "..", "drizzle");

/** The tables core's migrations LEAVE IN EXISTENCE — CREATEs minus later DROPs, filename order
 * (`readdirSync` does not sort). */
function tablesInDrizzle(): Set<string> {
  const files = readdirSync(DRIZZLE)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(DRIZZLE, f), "utf8"));
  return tablesCreatedBy(files);
}

describe("CORE_CLASSIFICATION", () => {
  it("has a valid class and a non-empty reason for every entry", () => {
    for (const c of CORE_CLASSIFICATION) {
      expect(["ledger", "state", "local"]).toContain(c.class);
      expect(c.reason.trim().length).toBeGreaterThan(0);
    }
  });
  it("names each table at most once", () => {
    const names = CORE_CLASSIFICATION.map((c) => c.table);
    expect(new Set(names).size).toBe(names.length);
  });
  it("classifies exactly the tables core's migrations create", () => {
    const classified = new Set(CORE_CLASSIFICATION.map((c) => c.table));
    const created = tablesInDrizzle();
    expect([...created].filter((t) => !classified.has(t)).sort()).toEqual([]);
    expect([...classified].filter((t) => !created.has(t)).sort()).toEqual([]);
  });
});

describe("CORE_CHANGE_SOURCES", () => {
  it("is not a change source for the table it writes into", () => {
    // `change_log` is classified like every other core table, so the completeness check above
    // passes — but a change trigger on it would insert a row for every row it writes, and that row
    // would trigger another.
    expect(CORE_CLASSIFICATION.map((c) => c.table)).toContain("change_log");
    expect(CORE_CHANGE_SOURCES.map((s) => s.table)).not.toContain("change_log");
  });
});
