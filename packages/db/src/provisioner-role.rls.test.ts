import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, type Database } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { captureError, pgErrorCode } from "./testing/errors.js";
import {
  roleUrl,
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "./testing/postgres.js";

const PASSWORD = "provisioner_suite_password";

describe("tenant_provisioner", () => {
  let pg: RealPostgres;
  let admin: Database;

  beforeAll(async () => {
    pg = await startMigratedPostgres({
      dockerRequired:
        "The tenant_provisioner suite requires a running Docker daemon. It cannot be skipped: " +
        "PGlite runs every connection as a superuser, which bypasses both the grant check and " +
        "the RLS policy this suite exists to tell apart.",
      migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
    });
    admin = await pg.connect();
    // Two LOGIN roles differing in ONE membership: the whole point of the suite is that the
    // difference between them is the grant, not anything about RLS.
    await admin.execute(
      sql.raw(
        `create role provisioner_login login password '${PASSWORD}' in role app_user, tenant_provisioner`,
      ),
    );
    await admin.execute(
      sql.raw(`create role app_only_login login password '${PASSWORD}' in role app_user`),
    );
  });

  afterAll(async () => {
    // GUARDED teardown. An unguarded afterAll turns a beforeAll failure into "Cannot read
    // properties of undefined (reading 'close')" and masks the real error — the pattern this repo
    // is trying to stop repeating. Optional chaining is the guard; it is not "unconditional".
    if (admin !== undefined) await admin.close();
    if (pg !== undefined) await pg.stop();
  });

  it("lets a member insert the tenant whose scope it adopts", async () => {
    const db = await createPostgresDb(roleUrl(pg.uri, "provisioner_login", PASSWORD));
    try {
      const id = "11111111-1111-4111-8111-111111111111";
      await db.transaction(async (tx) => {
        // The caller CHOOSES the uuid and sets app.tenant_id to it before inserting, so the row
        // satisfies tenants_tenant_isolation's own WITH CHECK (id = current_tenant_id()). This is
        // the manoeuvre the spec's §2 proves — there is no circularity, and no superuser.
        await tx.execute(sql`select set_config('app.tenant_id', ${id}, true)`);
        await tx.execute(
          sql`insert into tenants (id, nif, legal_name) values (${id}, 'B99999999', 'Provisioned SL')`,
        );
      });
      const rows = await db.execute<{ count: string }>(
        sql`select count(*)::text as count from tenants`,
      );
      // Reads back through its OWN scope: app.tenant_id is unset outside the transaction, so
      // current_tenant_id() is NULL and the policy hides every row. That is the correct answer.
      expect(rows.rows[0]?.count).toBe("0");
    } finally {
      await db.close();
    }
  });

  it("refuses a role holding app_user alone, on the GRANT and not the policy", async () => {
    const db = await createPostgresDb(roleUrl(pg.uri, "app_only_login", PASSWORD));
    try {
      const id = "22222222-2222-4222-8222-222222222222";
      const error = await captureError(() =>
        db.transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.tenant_id', ${id}, true)`);
          await tx.execute(
            sql`insert into tenants (id, nif, legal_name) values (${id}, 'B88888888', 'Refused SL')`,
          );
        }),
      );
      // 42501 is insufficient_privilege — the GRANT failing. An RLS refusal would be 42501 too on
      // a policy violation... which is precisely why the previous test exists: the two roles differ
      // only in the tenant_provisioner membership, so this failure can only be the grant.
      expect(pgErrorCode(error)).toBe("42501");
    } finally {
      await db.close();
    }
  });
});
