import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as core from "@waitron/db";
import * as schema from "./schema/index.js";

/** Exactly the tables this package owns. Adding a table means editing this line, deliberately. */
const OWNED = [
  "node_mirror_link",
  "node_mode",
  "node_primary_key",
  "node_recovery_key",
  "node_signing_key",
];

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

function tableNames(module: Record<string, unknown>): string[] {
  return Object.values(module)
    .filter((v) => is(v, SQLiteTable))
    .map((t) => getTableName(t))
    .sort();
}

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

describe("the node-db schema entrypoint owns exactly its own tables", () => {
  it("exports no table this package does not own", () => {
    expect(tableNames(schema)).toEqual([...OWNED].sort());
  });

  it("emits no CREATE TABLE for a table @waitron/db exports", () => {
    const coreTables = tableNames(core);
    expect(coreTables).toContain("nodes");
    const sqlText = generatedSql();
    for (const table of coreTables) {
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
