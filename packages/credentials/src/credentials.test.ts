import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { loadKeyRing } from "./keyring.js";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import { credentialProvisioned, getCredential, putCredential } from "./store.js";

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
    // A credential for a DIFFERENT purpose first: with an empty vault, `false` could not show that
    // the answer looks at the purpose rather than at whether any row exists.
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
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, { purpose: "payments.stripe", value: STRIPE }),
    );
    expect(await credentialProvisioned(suite.db, "payments.stripe")).toBe(false);
  });
});
