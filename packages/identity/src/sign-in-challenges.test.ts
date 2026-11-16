import { CORE_MIGRATIONS, signInChallenges, withTransaction, type Transaction } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { expect, it } from "vitest";
import { insertSignInChallenge } from "./sign-in-challenges.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const now = new Date("2026-11-16T12:00:00.000Z");
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
it("deletes expired rows of every kind before inserting", async () => {
  const personId = await seedPerson(suite.db);
  await suite.db.insert(signInChallenges).values(
    (
      [
        { kind: "passkey_registration", personId, challenge: "registration" },
        { kind: "passkey_login", challenge: "login" },
        { kind: "passkey_check", personId, challenge: "check" },
        { kind: "google_login", stateHash: "a".repeat(64), nonce: "nonce", verifier: "verifier" },
        {
          kind: "google_link",
          personId,
          stateHash: "b".repeat(64),
          nonce: "nonce",
          verifier: "verifier",
        },
        { kind: "totp_enrolment", personId, encryptedSecret: "sealed" },
      ] as const
    ).map((row) => ({
      ...row,
      createdAt: "2026-11-16T11:55:00.000Z",
      expiresAt: now.toISOString(),
    })),
  );
  const id = await run((tx) =>
    insertSignInChallenge(tx, {
      kind: "passkey_login",
      personId: null,
      challenge: "new",
      lifetimeMs: 300_000,
      now,
    }),
  );
  expect(await suite.db.select({ id: signInChallenges.id }).from(signInChallenges)).toEqual([
    { id },
  ]);
});
it("deletes a row more than ten minutes ahead", async () => {
  await suite.db.insert(signInChallenges).values({
    kind: "passkey_login",
    challenge: "from-before-clock-step",
    createdAt: "2026-11-16T12:06:00.001Z",
    expiresAt: "2026-11-16T12:11:00.001Z",
  });
  const id = await run((tx) =>
    insertSignInChallenge(tx, {
      kind: "google_login",
      personId: null,
      stateHash: "a".repeat(64),
      nonce: "nonce",
      verifier: "verifier",
      lifetimeMs: 600_000,
      now,
    }),
  );
  expect(await suite.db.select({ id: signInChallenges.id }).from(signInChallenges)).toEqual([
    { id },
  ]);
});
it("keeps a live row of another kind including the ten-minute boundary", async () => {
  const personId = await seedPerson(suite.db);
  await suite.db.insert(signInChallenges).values({
    id: "kept",
    kind: "totp_enrolment",
    personId,
    encryptedSecret: "sealed",
    createdAt: now.toISOString(),
    expiresAt: "2026-11-16T12:10:00.000Z",
  });
  const id = await run((tx) =>
    insertSignInChallenge(tx, {
      kind: "passkey_login",
      personId: null,
      challenge: "new",
      lifetimeMs: 300_000,
      now,
    }),
  );
  expect(
    (await suite.db.select({ id: signInChallenges.id }).from(signInChallenges))
      .map((r) => r.id)
      .sort(),
  ).toEqual(["kept", id].sort());
});
it("stamps created_at and expires_at from one now", async () => {
  const id = await run((tx) =>
    insertSignInChallenge(tx, {
      kind: "passkey_login",
      personId: null,
      challenge: "new",
      lifetimeMs: 300_000,
      now,
    }),
  );
  expect(await suite.db.select().from(signInChallenges)).toEqual([
    {
      id,
      kind: "passkey_login",
      personId: null,
      challenge: "new",
      stateHash: null,
      nonce: null,
      verifier: null,
      encryptedSecret: null,
      createdAt: "2026-11-16T12:00:00.000Z",
      expiresAt: "2026-11-16T12:05:00.000Z",
    },
  ]);
});
