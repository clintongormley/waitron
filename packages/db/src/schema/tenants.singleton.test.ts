import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { CHECK_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { seedTenant } from "../testing/seed.js";

describe("tenants is one row, keyed 1", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  let db: Database;

  beforeAll(async () => {
    db = suite.db;
    await seedTenant(db);
  });

  it("holds exactly one row, and its id is 1", () => {
    const rows = db.all<{ n: number; id: number }>(
      sql`select cast(count(*) as int) as n, cast(min(id) as int) as id from tenants`,
    );
    expect(rows[0]).toEqual({ n: 1, id: 1 });
  });

  it("refuses a second row, and any id but 1", async () => {
    // `created_at` is stated on every raw insert below because it takes its value from a
    // `$defaultFn` Drizzle applies CLIENT-side, and the row would otherwise be refused NOT NULL
    // rather than by the constraint under test.
    const at = new Date().toISOString();
    const second = await captureError(() =>
      Promise.resolve(
        db.run(
          sql`insert into tenants (id, country, tax_id, legal_name, created_at)
              values (1, 'ES', 'B99999999', 'Second SL', ${at})`,
        ),
      ),
    );
    expect(isRefusal(second, UNIQUE_VIOLATION)).toBe(true); // the primary key

    const otherId = await captureError(() =>
      Promise.resolve(
        db.run(
          sql`insert into tenants (id, country, tax_id, legal_name, created_at)
              values (2, 'ES', 'B99999999', 'Second SL', ${at})`,
        ),
      ),
    );
    expect(isRefusal(otherId, CHECK_VIOLATION)).toBe(true); // tenants_singleton_ck

    const still = db.all<{ n: number }>(sql`select cast(count(*) as int) as n from tenants`);
    expect(still[0]!.n).toBe(1);
  });

  // An `INTEGER PRIMARY KEY` is a rowid alias, so raw SQL omitting the id takes the next rowid;
  // the singleton check is what stops that writer adding a second taxpayer. Not checked: that a row
  // written without an id is row 1 — that holds only for an empty table.
  it("refuses a row that omits the id, by the singleton check", async () => {
    const omitted = await captureError(() =>
      Promise.resolve(
        db.run(
          sql`insert into tenants (country, tax_id, legal_name, created_at)
              values ('ES', 'B77777777', 'Third SL', ${new Date().toISOString()})`,
        ),
      ),
    );
    expect(isRefusal(omitted, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(omitted)).toMatch(/tenants_singleton_ck/);

    const still = db.all<{ n: number }>(sql`select cast(count(*) as int) as n from tenants`);
    expect(still[0]!.n).toBe(1);
  });
});
