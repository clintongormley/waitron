import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { readTenant } from "./read-tenant.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { usePgliteDb } from "./testing/lifecycle.js";
import { withTransaction } from "./tenancy.js";

// PGlite, not real Postgres: this is one SELECT against the singleton row, with no privilege or
// contention behaviour to observe, so it is the right, lighter target (CLAUDE.md §4). That
// `app_user` holds SELECT on `tenants` and no INSERT is pinned separately by
// `schema/tenants.singleton.pg.test.ts`, which needs the real server for the role switch.

describe("readTenant", () => {
  const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

  it("returns undefined on a database with no taxpayer row yet", async () => {
    expect(await withTransaction(pg.db, readTenant)).toBeUndefined();
  });

  it("returns the taxpayer's country, tax id and legal name", async () => {
    await pg.db.execute(sql`
      insert into tenants (id, country, tax_id, legal_name)
      values (1, 'ES', 'B12345678', 'Deli SL')`);

    // toEqual, not toMatchObject: a key left out of a matcher is never checked at all, and the
    // point of this helper is that every caller gets exactly these three fields.
    expect(await withTransaction(pg.db, readTenant)).toEqual({
      country: "ES",
      taxId: "B12345678",
      legalName: "Deli SL",
    });
  });
});
