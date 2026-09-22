import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { loadKeyRing } from "./keyring.js";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import { credentialProvisioned, getCredential, putCredential } from "./store.js";

/**
 * The vault, end to end, on the engine the box now runs.
 *
 * ## What this file was, and the three things that went with PostgreSQL
 *
 * It reached the vault as `credentials_rls_probe`, a non-superuser LOGIN role inheriting
 * `app_user`'s grants, created cluster-wide by the package's now-deleted `global-setup.ts`.
 *
 * 1. **The ROLE is gone and is replaced by nothing.** SQLite has no roles, `pg.connectAs` has no
 *    counterpart, and `asAppUser` is an inert function (`packages/db/src/testing/roles.ts`). Every
 *    call below runs on the one connection. Nothing now checks that the deployment role can reach
 *    the vault and no more than the vault.
 *
 * 2. **`hands the three sealed columns back as plain Uint8Arrays, not node Buffers` is DELETED,
 *    because on this engine it can no longer fail.** That case was put HERE deliberately, and
 *    after an argument the storage swap's own plan records at length
 *    (`docs/superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md`, "Where the failing test
 *    had to go"): node-postgres returns a `bytea` as a node `Buffer`, so the `binary` column's
 *    `fromDriver` was what made the value a `Uint8Array`, and deleting `fromDriver` turned this
 *    case red while the PGlite suites stayed green. **`node:sqlite` hands a BLOB back as a
 *    `Uint8Array` already.** Measured here 2026-09-22, reading the SAME row both ways: through the
 *    table, `ciphertext.constructor.name` is `Uint8Array` and `Buffer.isBuffer` is `false`; read
 *    RAW, bypassing drizzle's mapping entirely, it is `Uint8Array` and `false` as well. So the
 *    assertion now passes whether or not `fromDriver` exists — exactly the vacuity it was moved
 *    here to escape. `packages/db/src/schema/columns.ts`'s own comment on `bytes` records the same
 *    fact from the other side ("`fromDriver` is a belt-and-braces copy on this driver rather than
 *    a conversion"). **Three places still say this case is live and are now wrong**, and none of
 *    them is this file's to correct: `packages/credentials/src/cipher.ts:26-28`,
 *    `packages/credentials/src/index.test.ts:61-73`, and the plan paragraph above. The COMPILE-TIME
 *    half in `index.test.ts` is unaffected and still the real guard on the declaration.
 *
 * 3. **`returns taxpayer ids and nothing else — `setof integer`` is DELETED.** It read
 *    `pg_get_function_result` out of `pg_proc` to pin the seam's declared return type. There is no
 *    catalogue to ask and no function to ask about (see below).
 *
 * ## The two cases below are RED, and the reason is a BROKEN PRODUCT FUNCTION, not this file
 *
 * `credentialProvisioned` (`./store.ts:177-182`) is `select credential_tenants(?)`. That function
 * was created by `drizzle/0001_credentials_baseline_sql.sql`, which this branch DELETED; the SQLite
 * baseline creates the table and nothing else, and SQLite has no user-defined SQL functions.
 * Measured here 2026-09-22: the call throws `no such function: credential_tenants`.
 *
 * They are kept, converted and red, rather than deleted, for one reason: `apps/server/src/boot.ts`
 * calls `credentialProvisioned` to decide whether Stripe is configured, so this is a live path
 * that is broken today. Deleting its only two tests would make a broken function an untested one.
 * The storage swap's disposition ledger records the same blocker against
 * `apps/server/src/pass.pg.test.ts` ("BLOCKER 2").
 */
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

// CORE then CREDENTIALS — the pair the deleted `core_credentials` template this file cloned was
// built from (`git show origin/main:packages/credentials/src/testing/global-setup.ts`).
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS] });

describe("the vault through the venue store", () => {
  it("round-trips a sealed credential", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, { purpose: "payments.stripe", value: STRIPE }),
    );
    const actual = await withTransaction(suite.db, (tx) =>
      getCredential(tx, RING, { purpose: "payments.stripe" }),
    );
    expect(actual).toEqual(STRIPE);
  });
});

describe("credentialProvisioned", () => {
  it("reports the purpose provisioned only once THAT purpose has a credential", async () => {
    await seedTenant(suite.db);
    // A credential for a DIFFERENT purpose first: an empty vault would also enumerate nobody, so it
    // could not show that the function looks at the purpose rather than at whether any row exists.
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, {
        purpose: "fiscal.aeat",
        value: { pfxBase64: "AAAA", passphrase: "p", certKind: "sello" },
      }),
    );
    expect(await credentialProvisioned(suite.db, "payments.stripe")).toBe(false);

    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, { purpose: "payments.stripe", value: STRIPE }),
    );
    expect(await credentialProvisioned(suite.db, "payments.stripe")).toBe(true);
  });

  it("reports false for a purpose nobody has provisioned, never a throw", async () => {
    await seedTenant(suite.db);
    const found = await credentialProvisioned(suite.db, "credentials-vault-test.never-provisioned");
    expect(found).toBe(false);
  });
});
