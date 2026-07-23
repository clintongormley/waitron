import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

/** Exactly the tables this package owns. Adding a table means editing this line, deliberately. */
const OWNED = ["payments", "payment_refunds"];

/**
 * Every core table this package's schema files import (to declare foreign keys) or otherwise
 * risk re-exporting. None of these may ever appear in this package's output.
 */
const CORE = ["working_orders", "sales", "tenants", "tenders", "invoice_series"];

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

function generatedSql(): string {
  return readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(drizzleDir, f), "utf8"))
    .join("\n")
    .toLowerCase();
}

describe("the payments schema entrypoint owns exactly its own tables", () => {
  it("exports no table this package does not own", () => {
    // This inspects the same thing drizzle-kit inspects — the exported VALUES of the snapshot
    // entrypoint — so it fails for exactly the reason a duplicate CREATE TABLE would appear.
    // A textual grep for `export ... from "@waitron/db"` would miss `export const sales = ...`
    // and every aliased form.
    const exported = Object.values(schema)
      .filter((v) => is(v, PgTable))
      .map((t) => getTableName(t))
      .sort();
    expect(exported).toEqual([...OWNED].sort());
  });

  it("emits a CREATE TABLE for its own tables", () => {
    // The positive control. Without it the negative assertion below would pass against an empty
    // string — the exact vacuous shape that let seven tests through in fiscal-verifactu's plan 1.
    const sqlText = generatedSql();
    for (const table of OWNED) {
      expect(sqlText).toContain(`create table "${table}"`);
    }
  });

  it("emits no CREATE TABLE for any core table", () => {
    const sqlText = generatedSql();
    for (const table of CORE) {
      expect(sqlText).not.toContain(`create table "${table}"`);
    }
  });

  it("does emit foreign keys onto core tables", () => {
    // Importing core tables is not merely allowed, it is required — and this asserts the import
    // actually produced something, so a future "fix" that deletes the imports to silence the
    // re-export test is caught.
    const sqlText = generatedSql();
    expect(sqlText).toContain(`references "public"."working_orders"`);
    expect(sqlText).toContain(`references "public"."sales"`);
  });
});
