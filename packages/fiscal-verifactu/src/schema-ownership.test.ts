import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

/** Exactly the tables this package owns. Adding a table means editing this line, deliberately. */
const OWNED = [
  "acks",
  "cadenas",
  "contadores_instalacion",
  "envio_flujo",
  "envios",
  "registro_sif",
  "registros_facturacion",
];

/** Every table `packages/db` owns. None of these may ever appear in this package's output. */
const CORE = [
  "invoice_series",
  "locations",
  "sale_lines",
  "sales",
  "tenants",
  "tenders",
  "tills",
  "working_order_lines",
  "working_orders",
];

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

function generatedSql(): string {
  return readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(drizzleDir, f), "utf8"))
    .join("\n")
    .toLowerCase();
}

describe("the fiscal schema entrypoint owns exactly its own tables", () => {
  it("exports no table this package does not own", () => {
    // This inspects the same thing drizzle-kit inspects — the exported VALUES of the snapshot
    // entrypoint — so it fails for exactly the reason a duplicate CREATE TABLE would appear.
    const exported = Object.values(schema)
      .filter((v) => is(v, SQLiteTable))
      .map((t) => getTableName(t))
      .sort();
    expect(exported).toEqual([...OWNED].sort());
  });

  it("emits a CREATE TABLE for its own tables", () => {
    // The positive control: without it the negative assertions below would pass against an empty
    // string.
    const sqlText = generatedSql();
    for (const table of OWNED) {
      expect(sqlText).toContain(`create table \`${table}\``);
    }
  });

  it("emits no CREATE TABLE for any core table", () => {
    // Backticks, as above: a double-quoted needle matches nothing in this DDL at all.
    const sqlText = generatedSql();
    for (const table of CORE) {
      expect(sqlText).not.toContain(`create table \`${table}\``);
    }
  });

  it("does emit foreign keys onto core tables", () => {
    // Catches a "fix" that deletes the core-table imports to silence the re-export test.
    const sqlText = generatedSql();
    expect(sqlText).toContain("references `sales`(`id`)");
    expect(sqlText).toContain("references `tills`(`id`)");
  });
});
