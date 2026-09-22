// The name still ends `.pg.test.ts`, and this suite no longer reaches PostgreSQL. Renaming it is
// not this change's: `docs/backlog.md` points at the current filename, and the storage swap's plan
// (`docs/superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md`, step 25) records the rename
// for the same sweep that deals with `asAppUser` and `pgErrorCode`.
//
// LOSS, from the storage swap. Two things this suite established are gone and have no counterpart
// on this engine:
//  - a fourth case proved `app_user` is refused an INSERT into `tenants` by the GRANT (`42501`)
//    BEFORE either constraint below is reached. SQLite has no roles and no grants
//    (`packages/db/src/testing/roles.ts`), so nothing now states that the application role may read
//    this table and not write it — CLAUDE.md §3 still states the rule, and nothing here holds it.
//  - the surviving case used to assert `rolsuper` on its own connection first, so that "even to the
//    session that owns the table" was a checked claim rather than a hope. There is no privileged
//    session here to be distinguished from an unprivileged one: one process opens one file.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { CHECK_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isPgError } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
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

  // RED ON THIS BRANCH, DELIBERATELY. The assertion is the one this case has always made and it is
  // not edited to pass: what changed is the engine.
  //
  // `tenants.id` is declared `integer PRIMARY KEY DEFAULT 1 NOT NULL`
  // (`packages/db/drizzle/0000_baseline.sql`), and on SQLite an `INTEGER PRIMARY KEY` is an alias
  // for the table's rowid. A row that omits it is given the NEXT ROWID rather than the column
  // default, so with row 1 already seeded this insert lands id = 2 and is refused by
  // `tenants_singleton_ck` (errcode 275) instead of colliding on the primary key. Measured
  // 2026-09-22 on Node v26.7.0 against the migrated schema, reading the thrown `errcode` and the
  // surviving rows (`[{"id":1}]`).
  //
  // WHAT IS AND IS NOT INERT, measured the same day with four one-table `node:sqlite` probes, each
  // seeded with row 1 and then sent the same id-omitting insert:
  //  - a NON-key `integer DEFAULT 1 NOT NULL` column omitted from an insert is given 1. So a
  //    column DEFAULT is not inert on this engine in general — this is the control that stops the
  //    finding being read as "SQLite ignores defaults";
  //  - `id INTEGER PRIMARY KEY DEFAULT 1` — refused 275, `CHECK constraint failed`, id = 2. The
  //    rowid alias wins;
  //  - the same columns with `PRIMARY KEY(id)` written as a table constraint — also 275. Moving
  //    the key off the column does not stop it being a rowid alias;
  //  - the same table declared `WITHOUT ROWID` — refused 1555, `UNIQUE constraint failed: c.id`.
  //    The default IS applied there, which is the assertion below.
  //
  // So the property is expressible on this engine and this schema does not express it. What stands
  // in the way is the toolchain rather than the engine: neither drizzle-orm 0.45.2 nor drizzle-kit
  // 0.31.10 knows the clause at all (`grep -rl "WITHOUT ROWID"` over both installed packages
  // matches no file), so `WITHOUT ROWID` here would be a hand-written statement that a regenerate
  // would drop. That is a schema decision, not this suite's, which is why the case is left red.
  //
  // The default is therefore INERT for this column, and that is a fact about the schema rather
  // than about this suite: any caller that inserts a taxpayer row without stating `id` — a plain
  // `db.insert(tenants).values({ country, taxId, legalName })` included, since `.default(1)` makes
  // Drizzle omit the column — is now refused where PostgreSQL accepted it. No caller does:
  // `packages/provisioning/src/venue-apply.ts` is the only product writer of this table and states
  // `id: 1`, as does `packages/db/src/testing/seed.ts`.
  it("defaults id to 1, so a row that omits it meets the singleton rather than a NOT NULL error", async () => {
    // The two answers are deliberately different. Without the column default this insert fails on
    // NOT NULL — nothing supplied id. With the default it collides on the primary key, refusing a
    // SECOND row 1, which can only happen if the default put the 1 there. The row seeded in
    // `beforeAll` is what separates them.
    const omitted = await captureError(() =>
      Promise.resolve(
        db.run(
          sql`insert into tenants (country, tax_id, legal_name, created_at)
              values ('ES', 'B77777777', 'Third SL', ${new Date().toISOString()})`,
        ),
      ),
    );
    expect(isPgError(omitted, UNIQUE_VIOLATION)).toBe(true);
  });
});
