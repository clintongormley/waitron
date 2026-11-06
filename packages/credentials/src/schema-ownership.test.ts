import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "@waitron/db/schema/credentials.js";

/** Exactly the tables this package owns. Adding a table means editing this line, deliberately. */
const OWNED = ["tenant_credentials"];

/** Core tables this package reads (`credentialProvisioned` reads `tenants`). The core set, which
 * now holds this package's tables, must create each of these exactly once. */
const CORE = ["tenants"];

const drizzleDir = fileURLToPath(new URL("../../db/drizzle", import.meta.url));

/** How many times the core set's generated SQL creates each table, under any quoting. */
function createCounts(): Map<string, number> {
  const sql = readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(drizzleDir, f), "utf8"))
    .join("\n");
  const counts = new Map<string, number>();
  for (const m of sql.matchAll(/create table (?:if not exists )?[`"]?([a-z0-9_]+)[`"]?/gi)) {
    const name = m[1]!.toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

describe("the credentials schema entrypoint owns exactly its own tables", () => {
  it("exports no table this package does not own", () => {
    const exported = Object.values(schema)
      .filter((v) => is(v, SQLiteTable))
      .map((t) => getTableName(t))
      .sort();
    expect(exported).toEqual([...OWNED].sort());
  });

  it("adds no second CREATE TABLE for a core table", () => {
    const counts = createCounts();
    for (const table of CORE) {
      expect(counts.get(table)).toBe(1);
    }
  });

  it("has a CREATE TABLE in the core set for every table it owns", () => {
    const counts = createCounts();
    for (const table of OWNED) {
      expect(counts.get(table) ?? 0).toBeGreaterThan(0);
    }
  });
});
