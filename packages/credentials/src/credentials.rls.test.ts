import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { runCli } from "./cli.js";
import { loadKeyRing } from "./keyring.js";
import {
  credentialTenants,
  deleteCredential,
  getCredential,
  listCredentials,
  putCredential,
  rotateCredentials,
} from "./store.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

// A non-superuser LOGIN role inheriting app_user's grants, which this suite connects AS
// (`pg.connectAs`). Being non-superuser is what makes RLS apply at all — a superuser bypasses FORCE
// ROW LEVEL SECURITY, which is why PGlite cannot prove any of this. The vault touches four privileges
// on tenant_credentials: SELECT, INSERT, UPDATE (the upsert) and DELETE. A missing grant on any one is
// invisible under PGlite. The role is created once, cluster-wide, in the package's globalSetup
// (`src/testing/global-setup.ts`) — not per file, because a shared container is one cluster; see that
// file's header.
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

describe("the vault under real row-level security", () => {
  it("writes and reads its own tenant's credential as a non-superuser app_user member", async () => {
    const tenantId = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) =>
        putCredential(tx, RING, { tenantId, purpose: "payments.stripe", value: STRIPE }),
      );
      const actual = await withTenant(probe, tenantId, (tx) =>
        getCredential(tx, RING, { tenantId, purpose: "payments.stripe" }),
      );
      expect(actual).toEqual(STRIPE);
    } finally {
      await probe.close();
    }
  });

  it("deletes its own tenant's credential as a non-superuser app_user member", async () => {
    // The vault touches four privileges on tenant_credentials — SELECT, INSERT, UPDATE (the
    // upsert), and DELETE — and this file's own comment above says a missing grant on any one is
    // invisible under PGlite. Verified: this is the only test in the suite that calls
    // deleteCredential at all; removing DELETE from drizzle/0001_credentials_rls.sql's GRANT left
    // 123/123 green without it. As the probe role, a missing grant fails with
    // "permission denied for table tenant_credentials" (42501).
    const tenantId = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) =>
        putCredential(tx, RING, { tenantId, purpose: "payments.stripe", value: STRIPE }),
      );
      const deleted = await withTenant(probe, tenantId, (tx) =>
        deleteCredential(tx, { tenantId, purpose: "payments.stripe" }),
      );
      expect(deleted).toBe(true);

      // Confirmed gone from the superuser's own view too, not just invisible to this tenant.
      const remaining = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from tenant_credentials where tenant_id = ${tenantId}`,
      );
      expect(remaining.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's credential", async () => {
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, theirs, (tx) =>
        putCredential(tx, RING, { tenantId: theirs, purpose: "payments.stripe", value: STRIPE }),
      );

      // Read back as the superuser, which bypasses RLS: without this, a put that silently wrote
      // nothing would leave the table empty and the scoped read below would report 0 for the wrong
      // reason — hiding nothing is not the same as hiding something.
      const actual = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from tenant_credentials where tenant_id = ${theirs}`,
      );
      expect(actual.rows[0]!.count).toBe("1");

      const visible = await withTenant(probe, mine, (tx) => listCredentials(tx));
      expect(visible).toEqual([]);
    } finally {
      await probe.close();
    }
  });

  it("returns nothing at all with no tenant GUC set", async () => {
    // The isolation policy fails closed: current_tenant_id() is NULL outside withTenant, so a bare
    // select sees zero rows however many exist. Proven here by writing a REAL row first (so there is
    // something to hide) and then reading through a connection with no GUC set at all — a plain
    // empty table would pass this assertion vacuously, for the wrong reason. This is the property
    // the SECURITY DEFINER seam exists to work around, so it must be proven true first.
    const tenantId = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) =>
        putCredential(tx, RING, { tenantId, purpose: "payments.stripe", value: STRIPE }),
      );
      const rows = await probe.execute<{ count: string }>(
        sql`select count(*) as count from tenant_credentials`,
      );
      expect(rows.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });
});

describe("waitron-credentials list, no --tenant, under real RLS", () => {
  it("lists a tenant holding two purposes exactly once each — no duplicate rows from the cross-purpose enumeration", async () => {
    // Guards cli.ts's `new Set(...)` at the no---tenant branch: `credentialTenants` is called once
    // PER purpose and the results flattened, so a tenant holding both `payments.stripe` and
    // `fiscal.aeat` appears in that flattened list TWICE before dedup. Without the Set, the
    // per-tenant loop visits it twice and prints every one of its rows twice.
    //
    // This CANNOT be proven under PGlite (cli.test.ts): PGlite connects as superuser, which
    // bypasses RLS entirely, so `listCredentials` inside `withTenant` returns the WHOLE table
    // every time regardless of which tenant the outer loop claims to be visiting — confounding
    // "did the Set actually dedupe" with "how many distinct tenants happen to exist in the shared
    // test database" (verified directly: the naive version of this test, run under PGlite, counted
    // 10 lines instead of 2 or 4, one full-table read per DISTINCT enumerated tenant). Only a real,
    // non-superuser probe role makes `withTenant`'s scoping genuine, so a duplicate visit to the
    // same tenant genuinely — and only — prints that one tenant's own two rows twice.
    const tenantId = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) =>
        putCredential(tx, RING, { tenantId, purpose: "payments.stripe", value: STRIPE }),
      );
      await withTenant(probe, tenantId, (tx) =>
        putCredential(tx, RING, {
          tenantId,
          purpose: "fiscal.aeat",
          value: { pfxBase64: "AAAA", passphrase: "p", certKind: "sello" },
        }),
      );

      const out: string[] = [];
      const code = await runCli(["list"], {
        db: probe,
        ring: RING,
        io: {
          stdout: (line) => out.push(line),
          stderr: () => {},
          readStdin: () => Promise.resolve(""),
        },
        readFile: () => Promise.reject(new Error("not used by list")),
      });
      expect(code).toBe(0);
      const linesForTenant = out.filter((line) => line.startsWith(`${tenantId}\t`));
      expect(linesForTenant).toHaveLength(2);
    } finally {
      await probe.close();
    }
  });
});

describe("credentialTenants", () => {
  it("crosses tenants under the non-superuser role", async () => {
    const a = await seedTenant(suite.admin);
    const b = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      for (const tenantId of [a, b]) {
        await withTenant(probe, tenantId, (tx) =>
          putCredential(tx, RING, {
            tenantId,
            purpose: "fiscal.aeat",
            value: { pfxBase64: "AAAA", passphrase: "p", certKind: "sello" },
          }),
        );
      }
      const found = await credentialTenants(probe, "fiscal.aeat");
      expect(found).toEqual(expect.arrayContaining([a, b]));
    } finally {
      await probe.close();
    }
  });

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

  it("leaks nothing wider than a tenant id", async () => {
    // The function's whole justification is that its bypass surface is one identifier. If it ever
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
    // The other tests in this describe block use toContain/arrayContaining, which would stay green
    // even if the function returned extra ids or dropped ordering entirely. This asserts the exact,
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

/**
 * `rotateCredentials` calls `listCredentials(tx)` once per tenant, inside `withTenant` — no explicit
 * tenant filter, exactly like `list`'s no---tenant path in cli.ts. Under PGlite (rotate.test.ts) that
 * is unprovable: PGlite is a Postgres SUPERUSER connection, which bypasses RLS unconditionally, so
 * `listCredentials` returns the WHOLE table on every call regardless of which tenant `withTenant`
 * claims to scope — a different tenant's row can be read back and (mis-attributed, under the
 * currently-visited tenant's id) re-sealed. Only a genuinely non-superuser connection proves rotation
 * stays inside its own tenant's rows, the same reasoning as the "list, no --tenant" block above.
 *
 * Deliberately placed LAST in this file: it re-seals every row `RING`'s key material can reach,
 * including ones earlier describe blocks in this shared container left on version 1 — nothing after
 * this block may assume `RING` (version 1 only) still decrypts a tenant created above.
 */
describe("rotateCredentials under real RLS", () => {
  it("advances each tenant's own rows without touching another's — no cross-tenant mis-attribution", async () => {
    const a = await seedTenant(suite.admin);
    const b = await seedTenant(suite.admin);
    // `ROTATED` carries the SAME current key as every earlier test in this file used (`RING`, byte
    // 5, version 1) as its PREVIOUS member, so this one rotate call can re-seal every row any prior
    // block in this container ever wrote, not just this test's own two.
    const ROTATED = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 6).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "2",
      WAITRON_CREDENTIALS_KEY_PREVIOUS: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
    });
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, a, (tx) =>
        putCredential(tx, RING, { tenantId: a, purpose: "payments.stripe", value: STRIPE }),
      );
      await withTenant(probe, b, (tx) =>
        putCredential(tx, RING, {
          tenantId: b,
          purpose: "fiscal.aeat",
          value: { pfxBase64: "AAAA", passphrase: "p", certKind: "sello" },
        }),
      );

      const result = await rotateCredentials(probe, ROTATED);
      // A loose bound, not an exact count: this container is shared across the whole file, so
      // earlier describe blocks' tenants are swept up too — `rotated` legitimately counts more than
      // just this test's own two rows. See rotate.test.ts's own file-level comment for why an exact
      // count needs an isolated database, and why real RLS does not fix that particular problem.
      expect(result.rotated).toBeGreaterThanOrEqual(2);

      // The property real RLS actually proves: each tenant's OWN value is still correct — not
      // swapped, not corrupted, not left behind — after a rotation that swept up many OTHER
      // tenants' rows in the same run.
      const actualA = await withTenant(probe, a, (tx) =>
        getCredential(tx, ROTATED, { tenantId: a, purpose: "payments.stripe" }),
      );
      expect(actualA).toEqual(STRIPE);
      const actualB = await withTenant(probe, b, (tx) =>
        getCredential(tx, ROTATED, { tenantId: b, purpose: "fiscal.aeat" }),
      );
      expect(actualB).toEqual({ pfxBase64: "AAAA", passphrase: "p", certKind: "sello" });

      const versions = await suite.admin.execute<{ tenant_id: string; key_version: number }>(sql`
        select tenant_id, key_version from tenant_credentials where tenant_id in (${a}, ${b})`);
      expect(versions.rows).toHaveLength(2);
      for (const row of versions.rows) expect(row.key_version).toBe(2);
    } finally {
      await probe.close();
    }
  });
});
