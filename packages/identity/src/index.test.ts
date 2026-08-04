import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./index.js";
import * as api from "./index.js";

describe("@waitron/identity barrel", () => {
  it("exports the migration descriptor with the identity journal table", () => {
    expect(IDENTITY_MIGRATIONS.migrationsTable).toBe("__drizzle_migrations_identity");
  });
});

/**
 * drizzle invokes each table's `(t) => [...]` extraConfig callback LAZILY — a plain import never runs
 * it, which is why persons.ts's FK/index/check block shows as uncovered even though the barrel imports
 * the table. Calling `getTableConfig` forces the callback to run, and the assertions below are the
 * meaningful check that persons' constraints exist under the names the migration and the RLS policy
 * depend on — not a coverage stunt. Mirrors packages/credentials/src/index.test.ts.
 */
describe("persons constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares persons' primary key, foreign key and check constraints", () => {
    const config = getTableConfig(api.persons);

    // The PK is inline on `id` (a column flag), not a composite in extraConfig; the FK, index and
    // checks below ARE in extraConfig, so asserting them is what forces the lazy callback to run.
    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toContain("persons_tenant_fk");

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("persons_display_name_ck");
    expect(checkNames).toContain("persons_pin_hash_ck");
  });
});
