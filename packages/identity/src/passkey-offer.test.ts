import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { markPasskeyOffered, shouldOfferPasskey } from "./passkey-offer.js";
import { webauthnCredentials } from "./schema/webauthn.js";
import { seedPerson } from "../test/fixtures.js";

// PGlite, not real Postgres: both verbs are a SELECT and an UPDATE over two tables, and every case
// below asserts what they DO — which row is read, which row is stamped — never what a privilege
// permits. The suite runs as the connection owner (packages/db/src/testing/lifecycle.ts boots PGlite
// that way), so nothing here is a grant assertion; a suite that wanted one would switch role first,
// the way packages/db/src/allocate-number.test.ts does.

let tenantId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.db, tenantId, fn);
}

/** Registers a passkey for a person, the same row shape `finishPasskeyRegistration` writes
 * (packages/identity/src/passkey.ts). The transaction is opened for the tenant the row names, so a
 * credential seeded under another tenant is not silently written from this tenant's transaction. The
 * credential id is unique per call so two seeded passkeys in one tenant do not collide on
 * `webauthn_credentials_credential_id_uq`. */
async function seedPasskey(input: { tenantId: string; personId: string }): Promise<void> {
  await withTenant(suite.db, input.tenantId, (tx) =>
    tx.insert(webauthnCredentials).values({
      tenantId: input.tenantId,
      personId: input.personId,
      credentialId: `cred-${crypto.randomUUID()}`,
      publicKey: "AQID",
    }),
  );
}

describe("the passkey offer", () => {
  it("offers a person who holds no passkey and has never been offered", async () => {
    const personId = await seedPerson(suite.db, tenantId);

    await expect(run((tx) => shouldOfferPasskey(tx, { tenantId, personId }))).resolves.toBe(true);
  });

  it("does not offer twice", async () => {
    const personId = await seedPerson(suite.db, tenantId);

    await run((tx) => markPasskeyOffered(tx, { tenantId, personId }));

    await expect(run((tx) => shouldOfferPasskey(tx, { tenantId, personId }))).resolves.toBe(false);
  });

  it("does not offer a person who already holds a passkey", async () => {
    const personId = await seedPerson(suite.db, tenantId);
    await seedPasskey({ tenantId, personId });

    await expect(run((tx) => shouldOfferPasskey(tx, { tenantId, personId }))).resolves.toBe(false);
  });

  it("does not offer for another tenant's person of the same id", async () => {
    const personId = await seedPerson(suite.db, tenantId);
    const otherTenantId = await seedTenant(suite.db);

    // The person id exists — in the FIRST tenant. A read that trusts a globally unique id answers
    // about someone else's person; one tenant per database is not the query's isolation boundary.
    await expect(
      withTenant(suite.db, otherTenantId, (tx) =>
        shouldOfferPasskey(tx, { tenantId: otherTenantId, personId }),
      ),
    ).resolves.toBe(false);
  });

  it("does not count a passkey registered under another tenant", async () => {
    const personId = await seedPerson(suite.db, tenantId);
    const otherTenantId = await seedTenant(suite.db);
    // `webauthn_credentials` has one foreign key to `tenants` and a separate one to `persons`, so a
    // row naming another tenant alongside this person is insertable. It is not this tenant's
    // passkey, so it must not suppress this tenant's offer.
    await seedPasskey({ tenantId: otherTenantId, personId });

    await expect(run((tx) => shouldOfferPasskey(tx, { tenantId, personId }))).resolves.toBe(true);
  });

  it("stamps only the named person", async () => {
    const personId = await seedPerson(suite.db, tenantId);
    const colleagueId = await seedPerson(suite.db, tenantId);

    await run((tx) => markPasskeyOffered(tx, { tenantId, personId }));

    await expect(
      run((tx) => shouldOfferPasskey(tx, { tenantId, personId: colleagueId })),
    ).resolves.toBe(true);
  });

  it("stamps nobody when another tenant names this tenant's person", async () => {
    const personId = await seedPerson(suite.db, tenantId);
    const otherTenantId = await seedTenant(suite.db);

    // The write is the dangerous direction: a stamp that lands on another tenant's person silently
    // cancels an offer that tenant never saw. One database per tenant is not the write's isolation
    // boundary either.
    await withTenant(suite.db, otherTenantId, (tx) =>
      markPasskeyOffered(tx, { tenantId: otherTenantId, personId }),
    );

    await expect(run((tx) => shouldOfferPasskey(tx, { tenantId, personId }))).resolves.toBe(true);
  });
});
