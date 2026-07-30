import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPgliteDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { captureError, pgErrorMessage } from "./testing/errors.js";

/**
 * The `tenant_provisioner` migration's own `DO $$ ... $$` block
 * (`drizzle/0011_provisioner_role.sql`): the role it creates when there is nothing to refuse, and
 * its refusal paths. PGlite is the right target here, unlike `provisioner-role.rls.test.ts`'s own
 * suite: every case below is decided by the DO block reading `pg_roles` and running
 * `CREATE ROLE` / `RAISE EXCEPTION` against a fresh database — none of it needs a live connection
 * AS a non-superuser role, or RLS enforcement under one. Those two are that other file's job, on
 * real Postgres, for the reason its own header states.
 *
 * Mirrors `packages/credentials/src/migrations.test.ts`'s "refuses to reuse a pre-existing
 * credentials_enumerator role that has LOGIN" (:227-240) — the sibling guard this migration's own
 * LOGIN check was written to match, and the shape ("hand-create the bad role on a fresh database
 * before letting the real migration set run against it") every case here reuses.
 */
describe("the tenant_provisioner migration's DO block", () => {
  it("creates tenant_provisioner as NOLOGIN, NOSUPERUSER, NOBYPASSRLS", async () => {
    const db = await createPgliteDb();
    try {
      await runMigrations(db, CORE_MIGRATIONS);
      const role = await db.execute<{
        rolcanlogin: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        sql`select rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'tenant_provisioner'`,
      );
      expect(role.rows[0]).toEqual({ rolcanlogin: false, rolsuper: false, rolbypassrls: false });
    } finally {
      await db.close();
    }
  });

  // Nothing this migration does gives `tenant_provisioner` SELECT on `tenants` directly — it
  // inherits it, and the locations/tills/invoice_series grants, through membership of `app_user`.
  // Asserted here because the inheritance is the whole reason the "member of both" pairing is a
  // property of the schema rather than an instruction a caller has to remember: drop the
  // `GRANT app_user TO tenant_provisioner` from 0011 and this goes red.
  it("is a member of app_user, so it inherits app_user's grants", async () => {
    const db = await createPgliteDb();
    try {
      await runMigrations(db, CORE_MIGRATIONS);
      const members = await db.execute<{ rolname: string }>(sql`
        select g.rolname
        from pg_auth_members m
        join pg_roles g on g.oid = m.roleid
        join pg_roles r on r.oid = m.member
        where r.rolname = 'tenant_provisioner'
      `);
      expect(members.rows.map((r) => r.rolname)).toContain("app_user");
    } finally {
      await db.close();
    }
  });

  // One case per refusal branch of the DO block. `it.each` rather than three near-identical bodies
  // — the same shape `packages/provisioning/src/identifiers.test.ts` uses for its own refusal set.
  // The label is in the test name so a failure says WHICH attribute stopped being refused.
  //
  // The bad input has to be made by hand: no harness in this package produces a badly-attributed
  // pre-existing `tenant_provisioner`. `startMigratedPostgres` starts a fresh container per call,
  // so it is role-free. `describeEachTarget`'s postgres target is NOT — per its own doc comment
  // (harness.ts:24-36) and `postgresTarget`'s (:104-108) it makes a fresh DATABASE per test inside
  // ONE shared container/cluster, so cluster-global objects persist from the second test onward.
  // Even there the role was created by 0011's own DO block and so is correctly attributed, and a
  // later run passes the idempotent `IF NOT EXISTS` branch silently — never one of the ELSIFs. So
  // each case below creates the bad role first, THEN lets the real CORE_MIGRATIONS set run at it.
  it.each([
    [
      "SUPERUSER",
      sql`create role tenant_provisioner superuser`,
      /tenant_provisioner already exists with SUPERUSER or BYPASSRLS — refusing to grant it INSERT on tenants/,
    ],
    [
      "BYPASSRLS",
      sql`create role tenant_provisioner nosuperuser bypassrls`,
      /tenant_provisioner already exists with SUPERUSER or BYPASSRLS — refusing to grant it INSERT on tenants/,
    ],
    [
      "LOGIN",
      sql`create role tenant_provisioner login password 'x'`,
      /tenant_provisioner already exists with LOGIN — refusing to reuse it/,
    ],
  ])("refuses a pre-existing tenant_provisioner that has %s", async (_label, create, expected) => {
    const db = await createPgliteDb();
    try {
      await db.execute(create);
      const error = await captureError(() => runMigrations(db, CORE_MIGRATIONS));
      expect(pgErrorMessage(error)).toMatch(expected);
    } finally {
      await db.close();
    }
  });
});
