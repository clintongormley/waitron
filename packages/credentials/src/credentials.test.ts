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
 * ## The two things that went with PostgreSQL
 *
 * 1. **`hands the three sealed columns back as plain Uint8Arrays, not node Buffers` is DELETED,
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
 * 2. **`returns taxpayer ids and nothing else — `setof integer`` is DELETED.** It read
 *    `pg_get_function_result` out of `pg_proc` to pin the seam's declared return type. There is no
 *    catalogue to ask and no function to ask about (see below).
 *
 * ## `credential_tenants` is gone, and the cases below are what holds its behaviour now
 *
 * `credentialProvisioned` (`./store.ts`) used to be `select credential_tenants(?)`. That function
 * was created by `drizzle/0001_credentials_baseline_sql.sql`, which this branch DELETED; the SQLite
 * baseline creates the table and nothing else, and SQLite has no user-defined SQL functions, so the
 * call threw `no such function: credential_tenants` (measured here 2026-09-22). It is an ordinary
 * query now, and the two cases that were red for that reason pass without being adjusted.
 *
 * A THIRD case joined them with that conversion. The old function selected `id FROM tenants`, so it
 * answered false on a box with no taxpayer row however well provisioned the vault was; nothing
 * pinned that, and the obvious rewrite — asking `tenant_credentials` alone — drops it silently. The
 * case states its own control.
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

  it("reports false while there is no taxpayer row, even with the purpose provisioned", async () => {
    // NO `seedTenant` — the one thing this case varies. `useVenueDb` empties every data table
    // after each test (`packages/db/src/testing/venue-db.ts`'s `applyReset`), so `tenants` really
    // is empty here whatever the cases above seeded.
    //
    // The half of the answer the vault cannot give. The PostgreSQL function this replaced selected
    // `id FROM tenants`, so a vault provisioned on a box whose venue is not configured yet
    // enumerated nobody and the host ran no duty. Nothing else pinned that, and the obvious
    // rewrite — asking `tenant_credentials` alone — drops it silently: with the `tenants` half
    // deleted from `credentialProvisioned` this case reports `true` and fails, which is the
    // control that was run (2026-09-22).
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, { purpose: "payments.stripe", value: STRIPE }),
    );
    expect(await credentialProvisioned(suite.db, "payments.stripe")).toBe(false);
  });
});
