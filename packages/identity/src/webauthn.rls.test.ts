import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { pgErrorCode, withTenant } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { startRealPostgres } from "./testing/postgres.js";
import { seedPerson } from "../test/fixtures.js";

// A non-superuser LOGIN role inheriting app_user's grants. Being non-superuser is what makes RLS
// apply at all — a superuser bypasses row-level security outright, which is why PGlite cannot prove
// any of this. Both webauthn tables grant app_user SELECT, INSERT, UPDATE, DELETE
// (drizzle/0008_silent_mauler.sql): a missing grant, or a DELETE grant wrongly withheld, is invisible
// under PGlite.
const PROBE_ROLE = "identity_webauthn_probe";
const PROBE_PASSWORD = "probe";

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
});

// A base64url-ish credential id — the value is opaque to the database; only its uniqueness per tenant
// and its isolation are under test here.
const CREDENTIAL_ID = "Y3JlZF9hYmMxMjM";
const PUBLIC_KEY = "cHVia2V5X2Jhc2U2NHVybA";

describe("webauthn_credentials under real row-level security", () => {
  it("isolates a credential by tenant: another tenant sees none, the owning tenant sees its one", async () => {
    const tenantA = await seedTenant(suite.admin);
    const tenantB = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenantA);

    // Register a passkey for tenant A as the superuser (RLS bypassed), so there IS a row to hide.
    await suite.admin.execute(sql`
      insert into webauthn_credentials (tenant_id, person_id, credential_id, public_key)
      values (${tenantA}, ${personId}, ${CREDENTIAL_ID}, ${PUBLIC_KEY})`);

    // Read back as the superuser (bypasses RLS): a write that silently landed nothing would make the
    // scoped read below report 0 for the wrong reason — hiding nothing is not hiding something.
    const seen = await suite.admin.execute<{ count: string }>(
      sql`select count(*) as count from webauthn_credentials where tenant_id = ${tenantA}`,
    );
    expect(seen.rows[0]!.count).toBe("1");

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // The other tenant sees nothing — the USING predicate filters tenant A's row out. Weakening
      // webauthn_credentials_tenant_isolation's USING to `true` leaks tenant A's row here.
      const cross = await withTenant(probe, tenantB, (tx) =>
        tx.execute<{ id: string }>(sql`select id from webauthn_credentials`),
      );
      expect(cross.rows).toEqual([]);

      // The owning tenant sees exactly its one row. Removing the policy entirely (ENABLE with no
      // policy denies a non-owner everything) empties this and fails the assertion.
      const own = await withTenant(probe, tenantA, (tx) =>
        tx.execute<{ credential_id: string; counter: string }>(
          sql`select credential_id, counter from webauthn_credentials`,
        ),
      );
      expect(own.rows).toEqual([{ credential_id: CREDENTIAL_ID, counter: "0" }]);
    } finally {
      await probe.close();
    }
  });

  it("lets app_user register and bump its own tenant's credential — webauthn_credentials is MUTABLE", async () => {
    // The write half of the grant: INSERT lands under WITH CHECK, and `counter` is bumped on every
    // successful assertion, so UPDATE must succeed as the probe role. Removing INSERT or UPDATE from
    // 0008_silent_mauler.sql's GRANT fails this with 42501 (permission denied for table
    // webauthn_credentials).
    const tenant = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenant);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenant, (tx) =>
        tx.execute(sql`
          insert into webauthn_credentials (tenant_id, person_id, credential_id, public_key)
          values (${tenant}, ${personId}, ${CREDENTIAL_ID}, ${PUBLIC_KEY})`),
      );
      await withTenant(probe, tenant, (tx) =>
        tx.execute(
          sql`update webauthn_credentials set counter = counter + 1 where tenant_id = ${tenant}`,
        ),
      );
      const rows = await withTenant(probe, tenant, (tx) =>
        tx.execute<{ counter: string }>(
          sql`select counter from webauthn_credentials where tenant_id = ${tenant}`,
        ),
      );
      expect(rows.rows).toEqual([{ counter: "1" }]);
    } finally {
      await probe.close();
    }
  });

  it("returns nothing at all with no tenant GUC set", async () => {
    // The isolation policy fails closed: current_tenant_id() is NULL outside withTenant, so a bare
    // select sees zero rows however many exist. Proven by writing a REAL row first (so there is
    // something to hide) and then reading through a connection with no GUC — a plain empty table
    // would pass this assertion vacuously, for the wrong reason.
    const tenant = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenant);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenant, (tx) =>
        tx.execute(sql`
          insert into webauthn_credentials (tenant_id, person_id, credential_id, public_key)
          values (${tenant}, ${personId}, ${CREDENTIAL_ID}, ${PUBLIC_KEY})`),
      );
      const rows = await probe.execute<{ count: string }>(
        sql`select count(*) as count from webauthn_credentials`,
      );
      expect(rows.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("lets app_user delete its own tenant's credential — DELETE is granted (a stale passkey is removed)", async () => {
    // The delete half of the grant, unlike management_sessions. A revoked or stale passkey is removed
    // outright, so DELETE must succeed as the probe role. Removing DELETE from 0008_silent_mauler.sql's
    // GRANT fails this with 42501 (permission denied for table webauthn_credentials).
    const tenant = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenant);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenant, (tx) =>
        tx.execute(sql`
          insert into webauthn_credentials (tenant_id, person_id, credential_id, public_key)
          values (${tenant}, ${personId}, ${CREDENTIAL_ID}, ${PUBLIC_KEY})`),
      );
      await withTenant(probe, tenant, (tx) =>
        tx.execute(sql`delete from webauthn_credentials where tenant_id = ${tenant}`),
      );
      // Confirmed gone from the superuser's own view too, not just invisible to this tenant.
      const remaining = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from webauthn_credentials where tenant_id = ${tenant}`,
      );
      expect(remaining.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("a cross-tenant delete removes nothing — the USING policy filters the other tenant's rows out", async () => {
    // DELETE is granted, but the tenant-isolation policy still scopes WHICH rows it can reach: a
    // delete run as tenant B sees none of tenant A's rows, so it removes zero. Weakening the USING
    // predicate to `true` would let tenant B delete tenant A's credential here, dropping the survivor
    // count to 0 and failing this assertion.
    const tenantA = await seedTenant(suite.admin);
    const tenantB = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenantA);
    await suite.admin.execute(sql`
      insert into webauthn_credentials (tenant_id, person_id, credential_id, public_key)
      values (${tenantA}, ${personId}, ${CREDENTIAL_ID}, ${PUBLIC_KEY})`);

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // A bare, unqualified delete under tenant B: RLS narrows it to tenant B's visible rows (none).
      await withTenant(probe, tenantB, (tx) => tx.execute(sql`delete from webauthn_credentials`));
      // Tenant A's row survives, seen through the superuser's RLS-bypassing view.
      const remaining = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from webauthn_credentials where tenant_id = ${tenantA}`,
      );
      expect(remaining.rows[0]!.count).toBe("1");
    } finally {
      await probe.close();
    }
  });
});

describe("webauthn_challenges under real row-level security", () => {
  it("isolates a challenge by tenant, including a discoverable-login challenge with a null person", async () => {
    const tenantA = await seedTenant(suite.admin);
    const tenantB = await seedTenant(suite.admin);

    // person_id is null: a login (discoverable) ceremony, where the person is not yet known.
    await suite.admin.execute(sql`
      insert into webauthn_challenges (tenant_id, person_id, challenge)
      values (${tenantA}, null, 'chal_a')`);

    const seen = await suite.admin.execute<{ count: string }>(
      sql`select count(*) as count from webauthn_challenges where tenant_id = ${tenantA}`,
    );
    expect(seen.rows[0]!.count).toBe("1");

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const cross = await withTenant(probe, tenantB, (tx) =>
        tx.execute<{ id: string }>(sql`select id from webauthn_challenges`),
      );
      expect(cross.rows).toEqual([]);

      const own = await withTenant(probe, tenantA, (tx) =>
        tx.execute<{ challenge: string; person_id: string | null }>(
          sql`select challenge, person_id from webauthn_challenges`,
        ),
      );
      expect(own.rows).toEqual([{ challenge: "chal_a", person_id: null }]);
    } finally {
      await probe.close();
    }
  });

  it("lets app_user mint and read its own tenant's challenge", async () => {
    // INSERT lands under WITH CHECK; a registration challenge for a known person carries person_id.
    const tenant = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenant);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenant, (tx) =>
        tx.execute(sql`
          insert into webauthn_challenges (tenant_id, person_id, challenge)
          values (${tenant}, ${personId}, 'chal_reg')`),
      );
      const rows = await withTenant(probe, tenant, (tx) =>
        tx.execute<{ challenge: string }>(
          sql`select challenge from webauthn_challenges where tenant_id = ${tenant}`,
        ),
      );
      expect(rows.rows).toEqual([{ challenge: "chal_reg" }]);
    } finally {
      await probe.close();
    }
  });

  it("returns nothing at all with no tenant GUC set", async () => {
    const tenant = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenant, (tx) =>
        tx.execute(sql`
          insert into webauthn_challenges (tenant_id, person_id, challenge)
          values (${tenant}, null, 'chal_noguc')`),
      );
      const rows = await probe.execute<{ count: string }>(
        sql`select count(*) as count from webauthn_challenges`,
      );
      expect(rows.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("lets app_user delete its own tenant's challenge — a challenge is consumed after use", async () => {
    // The core reason DELETE is granted here: a challenge is deleted the moment it is used, so it
    // cannot be replayed. Removing DELETE from 0008_silent_mauler.sql's GRANT fails this with 42501.
    const tenant = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenant, (tx) =>
        tx.execute(sql`
          insert into webauthn_challenges (tenant_id, person_id, challenge)
          values (${tenant}, null, 'chal_consume')`),
      );
      await withTenant(probe, tenant, (tx) =>
        tx.execute(sql`delete from webauthn_challenges where tenant_id = ${tenant}`),
      );
      const remaining = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from webauthn_challenges where tenant_id = ${tenant}`,
      );
      expect(remaining.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("a cross-tenant delete removes nothing — the USING policy filters the other tenant's rows out", async () => {
    const tenantA = await seedTenant(suite.admin);
    const tenantB = await seedTenant(suite.admin);
    await suite.admin.execute(sql`
      insert into webauthn_challenges (tenant_id, person_id, challenge)
      values (${tenantA}, null, 'chal_survivor')`);

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantB, (tx) => tx.execute(sql`delete from webauthn_challenges`));
      const remaining = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from webauthn_challenges where tenant_id = ${tenantA}`,
      );
      expect(remaining.rows[0]!.count).toBe("1");
    } finally {
      await probe.close();
    }
  });

  it("refuses a write for another tenant even with a valid GUC — WITH CHECK blocks a spoofed tenant_id", async () => {
    // WITH CHECK filters what is writable: connected as tenant A, an INSERT naming tenant B's id is
    // rejected. Without the WITH CHECK half of the policy a tenant could plant a challenge it can
    // never read back. Mirrors the reasoning management_sessions' policy comment gives for needing
    // both USING and WITH CHECK.
    const tenantA = await seedTenant(suite.admin);
    const tenantB = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const error = await withTenant(probe, tenantA, (tx) =>
        tx
          .execute(
            sql`
            insert into webauthn_challenges (tenant_id, person_id, challenge)
            values (${tenantB}, null, 'chal_spoof')`,
          )
          .then(() => undefined)
          .catch((e: unknown) => e),
      );
      expect(pgErrorCode(error)).toBe("42501"); // new row violates row-level security policy
    } finally {
      await probe.close();
    }
  });
});
