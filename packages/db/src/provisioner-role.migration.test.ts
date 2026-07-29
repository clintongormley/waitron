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

  it("refuses a pre-existing tenant_provisioner that has SUPERUSER", async () => {
    const db = await createPgliteDb();
    try {
      // No other harness in this package's suites ever produces this input — a BADLY-attributed
      // pre-existing tenant_provisioner. `startMigratedPostgres` starts a fresh container per
      // call, so it is role-free. `describeEachTarget`'s postgres target is NOT: per its own doc
      // comment (harness.ts:24-36) and `postgresTarget`'s own (:104-108), it makes a fresh
      // DATABASE per test inside ONE shared container/cluster for the whole suite, so
      // cluster-global objects — tenant_provisioner among them — persist from the second test
      // onward. That still never produces THIS input, though: every persisted tenant_provisioner
      // there was created by 0011's own DO block, so it is always correctly attributed
      // (NOLOGIN/NOSUPERUSER/NOBYPASSRLS), and a later test's migration run simply passes the
      // idempotent `IF NOT EXISTS` branch silently — never one of the ELSIFs below. So it is
      // simulated by hand: create the badly-attributed role first, THEN let the real
      // CORE_MIGRATIONS set (which includes 0011) run against it and hit the DO block's ELSIF.
      await db.execute(sql`create role tenant_provisioner superuser`);
      const error = await captureError(() => runMigrations(db, CORE_MIGRATIONS));
      expect(pgErrorMessage(error)).toMatch(
        /tenant_provisioner already exists with SUPERUSER or BYPASSRLS — refusing to grant it INSERT on tenants/,
      );
    } finally {
      await db.close();
    }
  });

  it("refuses a pre-existing tenant_provisioner that has BYPASSRLS", async () => {
    const db = await createPgliteDb();
    try {
      await db.execute(sql`create role tenant_provisioner nosuperuser bypassrls`);
      const error = await captureError(() => runMigrations(db, CORE_MIGRATIONS));
      expect(pgErrorMessage(error)).toMatch(
        /tenant_provisioner already exists with SUPERUSER or BYPASSRLS — refusing to grant it INSERT on tenants/,
      );
    } finally {
      await db.close();
    }
  });

  it("refuses a pre-existing tenant_provisioner that has LOGIN", async () => {
    const db = await createPgliteDb();
    try {
      await db.execute(sql`create role tenant_provisioner login password 'x'`);
      const error = await captureError(() => runMigrations(db, CORE_MIGRATIONS));
      expect(pgErrorMessage(error)).toMatch(
        /tenant_provisioner already exists with LOGIN — refusing to reuse it/,
      );
    } finally {
      await db.close();
    }
  });
});
