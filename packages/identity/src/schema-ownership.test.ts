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

/** Core tables that must never appear in this package's generated SQL. Both were once imported here
 * to declare a foreign key; no schema file in this package imports a core table today (the storage
 * switch removed sessions' key to `tills`), and the list stays because what it guards against is a
 * core table finding its way back into this snapshot, not the imports of any one moment. */
const CORE = ["tenants", "tills"];

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Every table name this package's generated migrations CREATE.
 *
 * Read as names rather than searched for as a substring, and under either quoting: drizzle-kit
 * writes a SQLite identifier in backticks where it wrote a PostgreSQL one in double quotes, and a
 * name may arrive unquoted. The same treatment `classification.test.ts` carries, and for the same
 * reason — a scan looking for one dialect's punctuation finds nothing and reports it as absence.
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
    // The control, and the reason this line exists: the loop below passes against an EMPTY scan, so
    // it says nothing at all unless the scan actually read the migrations. It read none for exactly
    // as long as it matched only double quotes, and stayed green throughout.
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
