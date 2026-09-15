// Real PostgreSQL: exercises the database path through a non-superuser LOGIN and its grants.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { loadKeyRing } from "./keyring.js";
import { credentialProvisioned, getCredential, putCredential } from "./store.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

// Reach the vault and the enumeration function as a non-superuser LOGIN inheriting app_user's grants.
// The shared container creates this cluster-wide role once in src/testing/global-setup.ts.
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

describe("the vault through a non-superuser LOGIN", () => {
  it("round-trips a sealed credential", async () => {
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTransaction(probe, (tx) =>
        putCredential(tx, RING, { purpose: "payments.stripe", value: STRIPE }),
      );
      const actual = await withTransaction(probe, (tx) =>
        getCredential(tx, RING, { purpose: "payments.stripe" }),
      );
      expect(actual).toEqual(STRIPE);
    } finally {
      await probe.close();
    }
  });
});

describe("credentialProvisioned", () => {
  it("reports the purpose provisioned only once THAT purpose has a credential", async () => {
    await seedTenant(suite.admin);
    // A credential for a DIFFERENT purpose first: an empty vault would also enumerate nobody, so it
    // could not show that the function looks at the purpose rather than at whether any row exists.
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTransaction(probe, (tx) =>
        putCredential(tx, RING, {
          purpose: "fiscal.aeat",
          value: { pfxBase64: "AAAA", passphrase: "p", certKind: "sello" },
        }),
      );
      expect(await credentialProvisioned(probe, "payments.stripe")).toBe(false);

      await withTransaction(probe, (tx) =>
        putCredential(tx, RING, { purpose: "payments.stripe", value: STRIPE }),
      );
      expect(await credentialProvisioned(probe, "payments.stripe")).toBe(true);
    } finally {
      await probe.close();
    }
  });

  it("returns taxpayer ids and nothing else — `setof integer`", async () => {
    // The seam returns ONE identifier per row and no column of the credential itself; if it ever
    // grew a ciphertext or key_version column, this is the test that should have stopped it. Exact
    // match, not a pattern: `tenants.id` is the integer 1 now, so a silent change of the declared
    // return type must fail this test, not pass it.
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const described = await probe.execute<{ result_type: string }>(sql`
        select pg_get_function_result(oid) as result_type
        from pg_proc where proname = 'credential_tenants'`);
      expect(described.rows[0]!.result_type.toLowerCase()).toBe("setof integer");
    } finally {
      await probe.close();
    }
  });

  it("reports false for a purpose nobody has provisioned, never a throw", async () => {
    await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const found = await credentialProvisioned(probe, "credentials-vault-test.never-provisioned");
      expect(found).toBe(false);
    } finally {
      await probe.close();
    }
  });
});
