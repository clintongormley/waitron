import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

/** Exactly the tables this package owns. Adding a table means editing this line, deliberately. */
const OWNED = ["persons", "sessions", "management_sessions"];

/** Every core table this package's schema files import to declare foreign keys. None of these may
 * ever appear in this package's generated SQL. sessions imports `tills` (which pulls in `locations`
 * transitively); only the tables named here as FK targets are asserted absent. */
const CORE = ["tenants", "tills"];

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

function generatedSql(): string {
  return readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(drizzleDir, f), "utf8"))
    .join("\n")
    .toLowerCase();
}

describe("the identity schema entrypoint owns exactly its own tables", () => {
  it("exports no table this package does not own", () => {
    const exported = Object.values(schema)
      .filter((v) => is(v, PgTable))
      .map((t) => getTableName(t))
      .sort();
    expect(exported).toEqual([...OWNED].sort());
  });

  it("emits no CREATE TABLE for a core table", () => {
    const sqlText = generatedSql();
    for (const table of CORE) {
      expect(sqlText).not.toContain(`create table "${table}"`);
    }
  });

  it("emits a CREATE TABLE for every table it owns", () => {
    const sqlText = generatedSql();
    for (const table of OWNED) {
      expect(sqlText).toContain(`create table "${table}"`);
    }
  });
});
