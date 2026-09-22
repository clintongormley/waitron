import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { readTenant } from "./read-tenant.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { useVenueDb } from "./testing/venue-db.js";
import { withTransaction } from "./tenancy.js";

// One SELECT against the singleton row. That `tenants` holds exactly one row, keyed 1, is pinned
// separately by `schema/tenants.singleton.pg.test.ts`.

describe("readTenant", () => {
  const pg = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("returns null on a database with no taxpayer row yet", async () => {
    expect(await withTransaction(pg.db, readTenant)).toBeNull();
  });

  it("returns the taxpayer's country, tax id and legal name", async () => {
    // `created_at` is stated because this insert is RAW SQL. The column's default is
    // `$defaultFn(now)`, which drizzle evaluates in JavaScript per insert and binds as a
    // parameter (`schema/columns.ts`) — it is not a SQL DEFAULT, so a statement that does not go
    // through drizzle's insert builder never reaches it, and the row is refused
    // `NOT NULL constraint failed: tenants.created_at`. Every other raw insert into this table
    // states it for the same reason (`schema/tenants.singleton.pg.test.ts`,
    // `testing/venue-db.test.ts`).
    await pg.db.execute(sql`
      insert into tenants (id, country, tax_id, legal_name, created_at)
      values (1, 'ES', 'B12345678', 'Deli SL', ${new Date().toISOString()})`);

    // toEqual, not toMatchObject: a key left out of a matcher is never checked at all, and the
    // point of this helper is that every caller gets exactly these three fields.
    expect(await withTransaction(pg.db, readTenant)).toEqual({
      country: "ES",
      taxId: "B12345678",
      legalName: "Deli SL",
    });
  });
});
