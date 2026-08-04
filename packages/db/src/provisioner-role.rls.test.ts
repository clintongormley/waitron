import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "./migrations.js";
import { captureError, pgErrorCode, pgErrorMessage } from "./testing/errors.js";
import { useRealPostgres } from "./testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "./testing/postgres.js";

const PASSWORD = "provisioner_suite_password";

describe("tenant_provisioner", () => {
  // `timeoutMs` restates this package's own vitest `hookTimeout` (120s), which the helper's 60s
  // default would otherwise narrow: see vitest.config.ts — the figure covers pulling the Postgres
  // image on a cold runner, which is measured in minutes rather than seconds.
  const suite = useRealPostgres({
    start: () =>
      startMigratedPostgres({
        dockerRequired:
          "The tenant_provisioner suite requires a running Docker daemon. It cannot be skipped: " +
          "PGlite runs every connection as a superuser, which bypasses both the grant check and " +
          "the RLS policy this suite exists to tell apart.",
        migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      }),
    timeoutMs: 120_000,
  });

  // Three roles rather than the helper's single `probeRole`: what this suite compares is the
  // MEMBERSHIP each one holds, so they have to be created as a set and read as a set. Registered
  // after the helper's own hook, which vitest runs first — and which, if it throws, stops this one
  // from running at all (verified on vitest 3.2.7), so `suite.admin` is never read unstarted.
  beforeAll(async () => {
    // Two LOGIN roles differing in ONE membership: the whole point of the suite is that the
    // difference between them is the grant, not anything about RLS.
    await suite.admin.execute(
      sql.raw(
        `create role provisioner_login login password '${PASSWORD}' in role app_user, tenant_provisioner`,
      ),
    );
    await suite.admin.execute(
      sql.raw(`create role app_only_login login password '${PASSWORD}' in role app_user`),
    );
    // A THIRD role, and the only one in this file that `GRANT app_user TO tenant_provisioner`
    // (0011's own bottom statement) is actually load-bearing for: it is a member of
    // `tenant_provisioner` ALONE, so everything `app_user` grants reaches it transitively or not
    // at all. `provisioner_login` above holds `app_user` DIRECTLY, which is why deleting that GRANT
    // from 0011 left this whole suite green before this role existed.
    await suite.admin.execute(
      sql.raw(
        `create role provisioner_only_login login password '${PASSWORD}' in role tenant_provisioner`,
      ),
    );
  });

  it("lets a member insert the tenant whose scope it adopts", async () => {
    const db = await suite.pg.connectAs("provisioner_login", PASSWORD);
    try {
      const id = "11111111-1111-4111-8111-111111111111";
      await db.transaction(async (tx) => {
        // The caller CHOOSES the uuid and sets app.tenant_id to it before inserting, so the row
        // satisfies tenants_tenant_isolation's own WITH CHECK (id = current_tenant_id()). This is
        // the manoeuvre the spec's §2 proves — there is no circularity, and no superuser.
        await tx.execute(sql`select set_config('app.tenant_id', ${id}, true)`);
        await tx.execute(
          sql`insert into tenants (id, country, tax_id, legal_name) values (${id}, 'ES', 'B99999999', 'Provisioned SL')`,
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

  // The experiment 0011's own comment on `GRANT app_user TO tenant_provisioner` describes, run here
  // rather than asserted structurally: a login role whose ONLY membership is the provisioning
  // bucket both inserts a tenant and reads it back, because the bucket's own membership of
  // `app_user` carries SELECT on `tenants` and the locations/tills/invoice_series grants down to it.
  // Proven by deletion — see this file's own commit message.
  it("provisions through the bucket's membership alone, without app_user granted directly", async () => {
    const db = await suite.pg.connectAs("provisioner_only_login", PASSWORD);
    try {
      const memberships = await db.execute<{ rolname: string }>(sql`
        select g.rolname
        from pg_auth_members m
        join pg_roles g on g.oid = m.roleid
        join pg_roles r on r.oid = m.member
        where r.rolname = 'provisioner_only_login'
      `);
      // Load-bearing: if this role also held app_user directly it would prove nothing about the
      // GRANT, which is exactly how the pre-existing cases here missed it.
      expect(memberships.rows.map((r) => r.rolname)).toEqual(["tenant_provisioner"]);

      const id = "33333333-3333-4333-8333-333333333333";
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${id}, true)`);
        // INSERT on tenants is the bucket's OWN grant (0011). This much would pass without the
        // membership.
        await tx.execute(
          sql`insert into tenants (id, country, tax_id, legal_name) values (${id}, 'ES', 'B77777777', 'Inherited SL')`,
        );
        // These two are app_user's, reached only through the membership: 0001 grants app_user
        // SELECT on tenants and INSERT on locations, and 0011 grants the bucket neither. Read
        // inside the same transaction, where the scope it just adopted is still set, so the count
        // is this tenant's row and nothing another test in this shared database inserted.
        const rows = await tx.execute<{ count: string }>(
          sql`select count(*)::text as count from tenants`,
        );
        expect(rows.rows[0]?.count).toBe("1");
        // `Hostelería` and a `Fixture …` name, matching every other locations fixture in this
        // package (schema/sale-voids.test.ts, schema/incidents.test.ts). `english-only.ts` lists
        // `venta` in SPANISH_WORDS, so a descriptive Spanish value here fails that guard.
        await tx.execute(
          sql`insert into locations (tenant_id, name, invoice_locales, operation_description)
              values (${id}, 'Fixture Provisioned Location', array['es-ES'], 'Hostelería')`,
        );
      });
    } finally {
      await db.close();
    }
  });

  it("refuses a role holding app_user alone, on the GRANT and not the policy", async () => {
    const db = await suite.pg.connectAs("app_only_login", PASSWORD);
    try {
      const id = "22222222-2222-4222-8222-222222222222";
      const error = await captureError(() =>
        db.transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.tenant_id', ${id}, true)`);
          await tx.execute(
            sql`insert into tenants (id, country, tax_id, legal_name) values (${id}, 'ES', 'B88888888', 'Refused SL')`,
          );
        }),
      );
      // 42501 is insufficient_privilege — but an RLS WITH CHECK refusal is ALSO 42501 (verified
      // live: "new row violates row-level security policy for table \"tenants\""), so the code
      // alone does not distinguish the two, and the previous test does not fix that either: with
      // app_user widened to hold INSERT on tenants plus a RESTRICTIVE policy scoped to deny
      // app_only_login specifically, both tests stayed green under a code-only assertion here —
      // exactly the "never widen a grant" failure mode this suite exists to catch. Under that
      // same mutant, asserting the message too makes this line fail: the mutant's refusal reads
      // "new row violates row-level security policy ...", not "permission denied for table
      // tenants", which is what the grant failure this test names actually reads.
      expect(pgErrorCode(error)).toBe("42501");
      expect(pgErrorMessage(error)).toMatch(/permission denied for table/);
    } finally {
      await db.close();
    }
  });
});
