// Real Postgres, not PGlite: the privilege half below turns on what `app_user` may do, and PGlite's
// connection is a superuser whose `set local role` is the only thing making that question real
// (CLAUDE.md §4). The clone carries CORE_MIGRATIONS, which is where `tenants`, its singleton check
// and its grants live.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { withTransaction } from "../tenancy.js";
import { asAppUser } from "../testing/roles.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { seedTenant } from "../testing/seed.js";

describe("tenants is one row, keyed 1", () => {
  const suite = useTemplateDb({ template: "core", resetPerTest: false });
  let owner: Database;

  beforeAll(async () => {
    owner = suite.admin;
    await seedTenant(owner);
  });

  it("holds exactly one row, and its id is 1", async () => {
    const { rows } = await owner.execute<{ n: number; id: number }>(
      sql`select count(*)::int as n, min(id)::int as id from tenants`,
    );
    expect(rows[0]).toEqual({ n: 1, id: 1 });
  });

  it("refuses a second row, and any id but 1, even to the session that owns the table", async () => {
    // This connection IS a superuser — asserted rather than assumed, because the claim the two
    // refusals below make depends on knowing it. A superuser bypasses GRANTS, never CONSTRAINTS, so
    // a primary key and a CHECK are exactly the two guards whose refusal is worth proving from the
    // most privileged session there is: nothing weaker can get past them either.
    const role = await owner.execute<{ rolsuper: boolean }>(
      sql`select rolsuper from pg_roles where rolname = current_user`,
    );
    expect(role.rows).toEqual([{ rolsuper: true }]);

    const second = await captureError(() =>
      owner.execute(
        sql`insert into tenants (id, country, tax_id, legal_name) values (1, 'ES', 'B99999999', 'Second SL')`,
      ),
    );
    expect(pgErrorCode(second)).toBe("23505"); // tenants_pkey

    const otherId = await captureError(() =>
      owner.execute(
        sql`insert into tenants (id, country, tax_id, legal_name) values (2, 'ES', 'B99999999', 'Second SL')`,
      ),
    );
    expect(pgErrorCode(otherId)).toBe("23514"); // tenants_singleton_ck

    const still = await owner.execute<{ n: number }>(sql`select count(*)::int as n from tenants`);
    expect(still.rows[0]!.n).toBe(1);
  });

  it("defaults id to 1, so a row that omits it meets the singleton rather than a NOT NULL error", async () => {
    // The two answers are deliberately different. Without the column default this insert fails
    // `23502` — id is NOT NULL and nothing supplied it. With the default it fails `23505`, the
    // primary key refusing a SECOND row 1, which can only happen if the default put the 1 there.
    // The row seeded in `beforeAll` is what separates them.
    const omitted = await captureError(() =>
      owner.execute(
        sql`insert into tenants (country, tax_id, legal_name) values ('ES', 'B77777777', 'Third SL')`,
      ),
    );
    expect(pgErrorCode(omitted)).toBe("23505");
  });

  it("refuses an INSERT from app_user before either constraint is reached", async () => {
    // The privilege half, and the one that needs the role switch: `app_user` holds SELECT on
    // `tenants` and deliberately no INSERT, so the app role is stopped by the GRANT (42501) rather
    // than by the singleton check. Without `asAppUser(tx)` this would run as the owner and assert
    // nothing (CLAUDE.md §4).
    const refused = await captureError(() =>
      withTransaction(suite.admin, async (tx) => {
        await asAppUser(tx);
        await tx.execute(
          sql`insert into tenants (id, country, tax_id, legal_name) values (2, 'ES', 'B88888888', 'App SL')`,
        );
      }),
    );
    expect(pgErrorCode(refused)).toBe("42501");

    const still = await owner.execute<{ n: number }>(sql`select count(*)::int as n from tenants`);
    expect(still.rows[0]!.n).toBe(1);
  });
});
