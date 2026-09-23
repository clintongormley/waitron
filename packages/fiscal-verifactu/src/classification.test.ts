import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FISCAL_CLASSIFICATION } from "./classification.js";

const DRIZZLE = join(import.meta.dirname, "..", "drizzle");

// The generated DDL quotes table names with BACKTICKS, not double quotes: drizzle-kit's sqlite
// dialect emits ``CREATE TABLE `acks` (`` (drizzle/0000_baseline.sql:1). The double-quote-only
// pattern this replaced matched zero tables there, which made the "created minus classified"
// assertion below pass against an empty set — hence the explicit non-empty assertion.
// Both quoting characters are accepted here so the extraction does not go silently empty again
// if the emitted spelling changes.
function tablesInDrizzle(): string[] {
  const names: string[] = [];
  for (const file of readdirSync(DRIZZLE).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(DRIZZLE, file), "utf8");
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?[`"]?([a-z0-9_]+)[`"]?/gi)) {
      names.push(m[1]!);
    }
  }
  return names;
}

describe("FISCAL_CLASSIFICATION", () => {
  it("has a valid class and a non-empty reason for every entry", () => {
    for (const c of FISCAL_CLASSIFICATION) {
      expect(["ledger", "state", "local"]).toContain(c.class);
      expect(c.reason.trim().length).toBeGreaterThan(0);
    }
  });
  it("names each table at most once", () => {
    const names = FISCAL_CLASSIFICATION.map((c) => c.table);
    expect(new Set(names).size).toBe(names.length);
  });
  it("classifies exactly the tables this module's migrations create", () => {
    const classified = new Set(FISCAL_CLASSIFICATION.map((c) => c.table));
    const created = new Set(tablesInDrizzle());
    // An extraction that reads no table names at all satisfies the first comparison below while
    // proving nothing, so it is named here rather than left to the second one to catch.
    expect([...created].sort()).not.toEqual([]);
    expect([...created].filter((t) => !classified.has(t)).sort()).toEqual([]);
    expect([...classified].filter((t) => !created.has(t)).sort()).toEqual([]);
  });
});
