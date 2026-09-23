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
    // A textual grep for `export ... from "@waitron/db"` would miss `export const sales = ...`
    // and every aliased form.
    //
    // The class is `SQLiteTable`: the column vocabulary's `table` is `sqliteTable`
    // (packages/db/src/schema/columns.ts:298). Measured by printing both filters over this
    // entrypoint's exports — `is(v, PgTable)` selected 0 of them, `is(v, SQLiteTable)` selected
    // all 7 — so a `PgTable` filter here would compare an empty list and assert nothing.
    const exported = Object.values(schema)
      .filter((v) => is(v, SQLiteTable))
      .map((t) => getTableName(t))
      .sort();
    expect(exported).toEqual([...OWNED].sort());
  });

  it("emits a CREATE TABLE for its own tables", () => {
    // The positive control. Without it the three negative assertions below would pass against an
    // empty string — the exact vacuous shape that let seven tests through in plan 1.
    const sqlText = generatedSql();
    for (const table of OWNED) {
      expect(sqlText).toContain(`create table \`${table}\``);
    }
  });

  it("emits no CREATE TABLE for any core table", () => {
    // Spelled with the same backticks as the positive control above, and for the same reason: a
    // double-quoted needle matches nothing in this DDL at all, so it would hold whether or not a
    // core table were being created here.
    const sqlText = generatedSql();
    for (const table of CORE) {
      expect(sqlText).not.toContain(`create table \`${table}\``);
    }
  });

  it("does emit foreign keys onto core tables", () => {
    // Importing core tables is not merely allowed, it is required — and this asserts the import
    // actually produced something, so a future "fix" that deletes the imports to silence the
    // re-export test is caught. It is also what makes the ordering test in migrations.test.ts
    // non-vacuous: no cross-package FK, no ordering requirement to test.
    //
    // There is no `public.` qualifier to assert: the generated DDL spells a foreign key
    // ``FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`)`` (drizzle/0000_baseline.sql:104), all in
    // one file with no schema namespace. The referenced COLUMN is named here, which the
    // `"public"."sales"` needle this replaced did not pin.
    const sqlText = generatedSql();
    expect(sqlText).toContain("references `sales`(`id`)");
    expect(sqlText).toContain("references `tills`(`id`)");
  });
});
