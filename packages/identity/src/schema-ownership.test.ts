import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

/** Exactly the tables this package owns. Adding a table means editing this line, deliberately. */
const OWNED = [
  "persons",
  "sessions",
  "management_sessions",
  "management_account_actions",
  "recovery_codes",
  "totp_enrollments",
  "google_oidc_states",
  "webauthn_credentials",
  "webauthn_challenges",
];

/** Core tables that must never appear in this package's generated SQL. */
const CORE = ["tenants", "tills"];

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Every table name this package's generated migrations CREATE, under any quoting: a scan looking
 * for one quoting style finds nothing and reports it as absence.
 */
function tablesCreated(): Set<string> {
  const sql = readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(drizzleDir, f), "utf8"))
    .join("\n");
  const names = new Set<string>();
  for (const m of sql.matchAll(/create table (?:if not exists )?[`"]?([a-z0-9_]+)[`"]?/gi)) {
    names.add(m[1]!.toLowerCase());
  }
  return names;
}

describe("the identity schema entrypoint owns exactly its own tables", () => {
  it("exports no table this package does not own", () => {
    const exported = Object.values(schema)
      .filter((v) => is(v, SQLiteTable))
      .map((t) => getTableName(t))
      .sort();
    expect(exported).toEqual([...OWNED].sort());
  });

  it("emits no CREATE TABLE for a core table", () => {
    const created = tablesCreated();
    // The control: the loop below passes against an EMPTY scan.
    expect(created.size).toBeGreaterThan(0);
    for (const table of CORE) {
      expect([...created]).not.toContain(table);
    }
  });

  it("emits a CREATE TABLE for every table it owns", () => {
    const created = tablesCreated();
    for (const table of OWNED) {
      expect([...created]).toContain(table);
    }
  });
});
