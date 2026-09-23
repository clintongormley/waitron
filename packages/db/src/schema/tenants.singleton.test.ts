// LOSS, from the storage swap: "a row written without an id IS row 1" is gone with the column
// default that made it true; the last case in this file carries that loss and what replaced it.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { CHECK_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isPgError } from "../unique-violation.js";
import { captureError, pgErrorMessage } from "../testing/errors.js";
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
    // `$defaultFn` Drizzle applies CLIENT-side: a raw statement reaches none of them, and the row
    // would be refused `NOT NULL constraint failed: tenants.created_at` rather than by the
    // constraint under test.
    const at = new Date().toISOString();
    const second = await captureError(() =>
      Promise.resolve(
        db.run(
          sql`insert into tenants (id, country, tax_id, legal_name, created_at)
              values (1, 'ES', 'B99999999', 'Second SL', ${at})`,
        ),
      ),
    );
    expect(isPgError(second, UNIQUE_VIOLATION)).toBe(true); // the primary key

    const otherId = await captureError(() =>
      Promise.resolve(
        db.run(
          sql`insert into tenants (id, country, tax_id, legal_name, created_at)
              values (2, 'ES', 'B99999999', 'Second SL', ${at})`,
        ),
      ),
    );
    expect(isPgError(otherId, CHECK_VIOLATION)).toBe(true); // tenants_singleton_ck

    const still = db.all<{ n: number }>(sql`select cast(count(*) as int) as n from tenants`);
    expect(still[0]!.n).toBe(1);
  });

  // WHICH CONSTRAINT REFUSES AN ID-OMITTING INSERT HAS CHANGED, and the property this case used to
  // hold is gone. On PostgreSQL `id` carried a column `DEFAULT 1`, so an insert omitting it took
  // that 1 and collided with the seeded row's PRIMARY KEY — and the collision was readable as
  // proof the default had put the 1 there. On SQLite an `INTEGER PRIMARY KEY` is an alias for the
  // rowid, which takes the next rowid instead, so the default never applied. It has been dropped
  // from the schema (owner decision 2026-09-22; `packages/db/src/schema/tenants.ts`) and the
  // writers state the id.
  //
  // Probed 2026-09-22 on Node v26.7.0, two one-table `node:sqlite` databases differing only in the
  // clause — `id integer primary key default 1 not null` and `id integer primary key not null`,
  // each with the same singleton CHECK. Into an EMPTY table a statement omitting the id COLUMN
  // stored id 1 both ways; beside a seeded row 1 both were refused errcode 275, `CHECK constraint
  // failed`. The two readings being identical IS the finding: the clause changes nothing here.
  //
  // WHAT REACHES THAT PATH is narrower than "a caller that leaves the id out", and an earlier note
  // here had it the other way round. Read off `.toSQL()` the same day, drizzle-orm 0.45.2 NAMES the
  // id column either way: with a `.default(1)` it binds the 1 client-side, and without one it emits
  // a literal `null`, which an `INTEGER PRIMARY KEY` then fills from the rowid. So the rowid path
  // belongs to raw SQL that omits the COLUMN — this case — and a plain
  // `db.insert(tenants).values({ country, taxId, legalName })` never had a default to lose.
  //
  // LOSS: nothing now states that a row written without an id IS row 1. It is 1 only because it is
  // the first rowid, which is a fact about an empty table and not about this column. Expressing the
  // old property would take `WITHOUT ROWID`, which neither drizzle-orm 0.45.2 nor drizzle-kit
  // 0.31.10 knows (`grep -rl "WITHOUT ROWID"` over both installed packages matches no file), so it
  // would be hand-written SQL a regenerate would drop.
  //
  // What survives is the invariant the case exists for: a writer that omits the id cannot add a
  // second taxpayer. Same repair `packages/payments/src/migrations.test.ts` made for
  // `payment_policy`, and it names the constraint where the old assertion named only the class.
  it("refuses a row that omits the id, by the singleton check", async () => {
    const omitted = await captureError(() =>
      Promise.resolve(
        db.run(
          sql`insert into tenants (country, tax_id, legal_name, created_at)
              values ('ES', 'B77777777', 'Third SL', ${new Date().toISOString()})`,
        ),
      ),
    );
    expect(isPgError(omitted, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(omitted)).toMatch(/tenants_singleton_ck/);

    const still = db.all<{ n: number }>(sql`select cast(count(*) as int) as n from tenants`);
    expect(still[0]!.n).toBe(1);
  });
});
