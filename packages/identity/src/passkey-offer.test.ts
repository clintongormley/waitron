import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
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

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

/** Registers a passkey for a person, the same row shape `finishPasskeyRegistration` writes
 * (packages/identity/src/passkey.ts). The credential id is unique per call so two seeded passkeys do
 * not collide on `webauthn_credentials_credential_id_uq`. */
async function seedPasskey(input: { personId: string }): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    tx.insert(webauthnCredentials).values({
      personId: input.personId,
      credentialId: `cred-${crypto.randomUUID()}`,
      publicKey: "AQID",
    }),
  );
}

describe("the passkey offer", () => {
  it("offers a person who holds no passkey and has never been offered", async () => {
    const personId = await seedPerson(suite.db);

    await expect(run((tx) => shouldOfferPasskey(tx, { personId }))).resolves.toBe(true);
  });

  it("does not offer twice", async () => {
    const personId = await seedPerson(suite.db);

    await run((tx) => markPasskeyOffered(tx, { personId }));

    await expect(run((tx) => shouldOfferPasskey(tx, { personId }))).resolves.toBe(false);
  });

  it("does not offer a person who already holds a passkey", async () => {
    const personId = await seedPerson(suite.db);
    await seedPasskey({ personId });

    await expect(run((tx) => shouldOfferPasskey(tx, { personId }))).resolves.toBe(false);
  });

  it("stamps only the named person", async () => {
    const personId = await seedPerson(suite.db);
    const colleagueId = await seedPerson(suite.db);

    await run((tx) => markPasskeyOffered(tx, { personId }));

    await expect(run((tx) => shouldOfferPasskey(tx, { personId: colleagueId }))).resolves.toBe(
      true,
    );
  });
});
