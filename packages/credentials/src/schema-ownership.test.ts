import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

/** Exactly the tables this package owns. Adding a table means editing this line, deliberately. */
const OWNED = ["tenant_credentials"];

/** Core tables this package reads (`credentialProvisioned` reads `tenants`). None of these may
 * ever appear in this package's generated SQL as a CREATE TABLE. */
const CORE = ["tenants"];

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

/** How drizzle-kit writes a table name in this package's generated SQL. */
function createTable(table: string): string {
  return `create table \`${table}\``;
}

function generatedSql(): string {
  return readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(drizzleDir, f), "utf8"))
    .join("\n")
    .toLowerCase();
}

describe("the credentials schema entrypoint owns exactly its own tables", () => {
  it("exports no table this package does not own", () => {
    const exported = Object.values(schema)
      .filter((v) => is(v, SQLiteTable))
      .map((t) => getTableName(t))
      .sort();
    expect(exported).toEqual([...OWNED].sort());
  });

  it("emits no CREATE TABLE for a core table", () => {
    const sqlText = generatedSql();
    for (const table of CORE) {
      expect(sqlText).not.toContain(createTable(table));
    }
  });

  it("emits a CREATE TABLE for every table it owns", () => {
    const sqlText = generatedSql();
    for (const table of OWNED) {
      expect(sqlText).toContain(createTable(table));
    }
  });
});
