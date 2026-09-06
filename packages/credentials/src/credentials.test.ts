import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { loadKeyRing } from "./keyring.js";
import { credentialTenants, putCredential } from "./store.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

// A non-superuser LOGIN role inheriting app_user's grants, which this suite connects AS
// (`pg.connectAs`). `credential_tenants` is a SECURITY DEFINER function owned by a helper role, so
// what it may read is not what the CALLER may read — running these cases as the app role rather than
// as the container's superuser is what keeps that distinction real. The role is created once,
// cluster-wide, in the package's globalSetup (`src/testing/global-setup.ts`) — not per file, because
// a shared container is one cluster; see that file's header.
const PROBE_ROLE = "credentials_rls_probe";
const PROBE_PASSWORD = "probe";

const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const STRIPE = {
  secretKey: "sk_test_rls",
  webhookSecret: "whsec_rls",
  successUrl: "https://example.test/ok",
  cancelUrl: "https://example.test/no",
};

const suite = useTemplateDb({ template: "core_credentials" });

describe("credentialTenants", () => {
  it("enumerates only tenants holding THAT purpose", async () => {
    const withStripe = await seedTenant(suite.admin);
    // `without` must hold a credential too — just for a DIFFERENT purpose. A tenant with no row at
    // all would pass this test even against a WHERE clause that ignored `purpose` entirely (there
    // is nothing to leak), so it would prove nothing about purpose-exclusivity specifically. Giving
    // it an unrelated purpose is what makes "only THAT purpose" a claim this test can actually
    // falsify.
    const without = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, withStripe, (tx) =>
        putCredential(tx, RING, {
          tenantId: withStripe,
          purpose: "payments.stripe",
          value: STRIPE,
        }),
      );
      await withTenant(probe, without, (tx) =>
        putCredential(tx, RING, {
          tenantId: without,
          purpose: "fiscal.aeat",
          value: { pfxBase64: "AAAA", passphrase: "p", certKind: "sello" },
        }),
      );
      const found = await credentialTenants(probe, "payments.stripe");
      expect(found).toContain(withStripe);
      expect(found).not.toContain(without);
    } finally {
      await probe.close();
    }
  });

  it("returns tenant ids and nothing else — `setof uuid`", async () => {
    // The seam returns ONE identifier per row and no column of the credential itself; if it ever
    // grew a ciphertext or key_version column, this is the test that should have stopped it. Exact
    // match, not a text-or-uuid pattern: `uuid` is the settled return type for this column (Task 1
    // made tenant_credentials.tenant_id a uuid), so a silent revert to `text` must fail this test,
    // not pass it.
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const described = await probe.execute<{ result_type: string }>(sql`
        select pg_get_function_result(oid) as result_type
        from pg_proc where proname = 'credential_tenants'`);
      expect(described.rows[0]!.result_type.toLowerCase()).toBe("setof uuid");
    } finally {
      await probe.close();
    }
  });

  it("returns an empty list for a purpose nobody has provisioned, never a throw", async () => {
    // Task 6's rotate calls credentialTenants for every purpose, including ones with no rows yet —
    // this must be a normal empty result, not an error a caller has to special-case. A purpose
    // string no other test in this file ever writes (this suite's container is shared across the
    // whole file, not reset between tests), so the assertion holds regardless of execution order —
    // unlike reusing "payments.stripe" or "fiscal.aeat", both of which sibling tests provision.
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const found = await credentialTenants(probe, "credentials-vault-test.never-provisioned");
      expect(found).toEqual([]);
    } finally {
      await probe.close();
    }
  });

  it("orders results by tenant id ascending — an exact list, not just a superset check", async () => {
    // The purpose-exclusivity test above uses toContain/not.toContain, which would stay green even
    // if the function returned extra ids or dropped ordering entirely. This asserts the exact,
    // ordered contract store.ts's own doc comment promises callers. Rows are inserted directly
    // (bypassing putCredential and the Purpose registry, the same technique migrations.test.ts uses
    // for its own arbitrary-purpose fixtures) under a purpose private to this test, so no sibling
    // test's payments.stripe/fiscal.aeat writes can leak into the result and break the exact-list
    // assertion. Inserted in DESCENDING tenant-id order deliberately, so an unordered or
    // insertion-order result would not accidentally come back looking sorted.
    const a = await seedTenant(suite.admin);
    const b = await seedTenant(suite.admin);
    const [first, second] = [a, b].sort();
    const purpose = "credentials-vault-test.ordering-probe";
    const row = {
      ciphertext: Buffer.from("x"),
      iv: Buffer.alloc(12, 1),
      authTag: Buffer.alloc(16, 2),
    };
    for (const tenantId of [second, first]) {
      await suite.admin.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, ${purpose}, ${row.ciphertext}, ${row.iv}, ${row.authTag}, 1)`);
    }
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const found = await credentialTenants(probe, purpose);
      expect(found).toEqual([first, second]);
    } finally {
      await probe.close();
    }
  });
});
