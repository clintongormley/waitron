/**
 * Each passkey ceremony accepts only a challenge its own begin issued, checked with the real
 * WebAuthn verifier: the responses here are built and signed with `node:crypto`, not mocked.
 */
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  withTransaction,
  dashboardSessions,
  webauthnCredentials,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  beginOwnPasskeyCheck,
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  verifyOwnPasskey,
  verifyPasskeyAssertion,
} from "./passkey.js";
import { codeOf, openManagementSession, seedPerson, TOTP_KEY_RING } from "../test/fixtures.js";
import { signedRegistration, signingPasskey } from "../test/passkey-signer.js";

const RP_ID = "localhost";
const ORIGIN = "http://localhost";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

const registrationResponse = (challenge: string, origin = ORIGIN) =>
  signedRegistration(RP_ID, challenge, origin);

/** Stores a passkey for `personId` and returns a signer of assertions from it. */
async function seedSigningPasskey(personId: string, counter = 0) {
  const passkey = signingPasskey(RP_ID);
  await suite.db.insert(webauthnCredentials).values({
    personId,
    credentialId: passkey.credentialId,
    publicKey: passkey.publicKey,
    counter,
  });
  return (challenge: string, origin = ORIGIN) => passkey.assert(challenge, origin);
}

const enrol = (token: string, challengeHandle: string, challenge: string) => {
  const response = registrationResponse(challenge);
  return {
    response,
    finish: () =>
      run((tx) =>
        finishPasskeyRegistration(tx, {
          managementSessionId: token,
          challengeHandle,
          response,
          rpId: RP_ID,
          origin: ORIGIN,
        }),
      ),
  };
};

const credentialsWithId = (credentialId: string) =>
  suite.db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, credentialId));

describe("enrolling a passkey", () => {
  it("enrols it against a registration challenge the same session began", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const begun = await run((tx) =>
      beginPasskeyRegistration(tx, { managementSessionId: token, rpId: RP_ID, rpName: "Waitron" }),
    );
    const { response, finish } = enrol(token, begun.challengeHandle, begun.options.challenge);

    expect((await finish()).credentialId).toBe(response.id);
    expect(await credentialsWithId(response.id)).toHaveLength(1);
  });

  it("refuses a fresh sign-in check's challenge, enrolling nothing", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    await seedSigningPasskey(personId);
    const begun = await run((tx) =>
      beginOwnPasskeyCheck(tx, { managementSessionId: token, rpId: RP_ID }),
    );
    const { response, finish } = enrol(token, begun.challengeHandle, begun.options.challenge);

    expect(await codeOf(finish)).toBe("passkey.verification_failed");
    expect(await credentialsWithId(response.id)).toHaveLength(0);
  });

  it("refuses the public sign-in's challenge, enrolling nothing", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const begun = await run((tx) => beginPasskeyAuthentication(tx, { rpId: RP_ID }));
    const { response, finish } = enrol(token, begun.challengeHandle, begun.options.challenge);

    expect(await codeOf(finish)).toBe("passkey.verification_failed");
    expect(await credentialsWithId(response.id)).toHaveLength(0);
  });

  it("refuses a registration challenge another person's session began, enrolling nothing", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const other = await openManagementSession(suite.db, "admin");
    const theirs = await run((tx) =>
      beginPasskeyRegistration(tx, {
        managementSessionId: other.token,
        rpId: RP_ID,
        rpName: "Waitron",
      }),
    );
    const { response, finish } = enrol(token, theirs.challengeHandle, theirs.options.challenge);

    expect(await codeOf(finish)).toBe("passkey.verification_failed");
    expect(await credentialsWithId(response.id)).toHaveLength(0);
  });
});

describe("signing in and checking a passkey", () => {
  const checkOwn = (token: string, challengeHandle: string, response: unknown) =>
    run((tx) =>
      verifyOwnPasskey(tx, {
        managementSessionId: token,
        challengeHandle,
        response: response as never,
        rpId: RP_ID,
        origin: ORIGIN,
        keyRing: TOTP_KEY_RING,
      }),
    );

  it("accepts a signed assertion against the check's own challenge", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    const assert = await seedSigningPasskey(personId);
    const begun = await run((tx) =>
      beginOwnPasskeyCheck(tx, { managementSessionId: token, rpId: RP_ID }),
    );

    await expect(
      checkOwn(token, begun.challengeHandle, assert(begun.options.challenge)),
    ).resolves.toBeUndefined();
  });

  it("refuses a check against the same person's registration challenge", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    const assert = await seedSigningPasskey(personId);
    const begun = await run((tx) =>
      beginPasskeyRegistration(tx, { managementSessionId: token, rpId: RP_ID, rpName: "Waitron" }),
    );

    expect(
      await codeOf(() => checkOwn(token, begun.challengeHandle, assert(begun.options.challenge))),
    ).toBe("passkey.verification_failed");
  });

  const signIn = (challengeHandle: string, response: unknown) =>
    run((tx) =>
      finishPasskeyAuthentication(tx, {
        challengeHandle,
        response: response as never,
        rpId: RP_ID,
        origin: ORIGIN,
      }),
    );

  const sessionCount = async () => (await suite.db.select().from(dashboardSessions)).length;

  it("signs in with a signed assertion against the public sign-in's own challenge", async () => {
    const { personId } = await openManagementSession(suite.db, "admin");
    const assert = await seedSigningPasskey(personId);
    const begun = await run((tx) => beginPasskeyAuthentication(tx, { rpId: RP_ID }));

    expect((await signIn(begun.challengeHandle, assert(begun.options.challenge))).personId).toBe(
      personId,
    );
  });

  it("refuses a sign-in against a fresh sign-in check's challenge, starting no session", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    const assert = await seedSigningPasskey(personId);
    const begun = await run((tx) =>
      beginOwnPasskeyCheck(tx, { managementSessionId: token, rpId: RP_ID }),
    );
    const sessionsBefore = await sessionCount();

    expect(await codeOf(() => signIn(begun.challengeHandle, assert(begun.options.challenge)))).toBe(
      "passkey.verification_failed",
    );
    expect(await sessionCount()).toBe(sessionsBefore);
  });
});

describe("a ceremony verified against a list of origins", () => {
  const VENUE = "https://waitron.local";
  const BOX = "https://box-abcd.waitron.local";
  const LISTED = [VENUE, BOX];
  const UNLISTED = "https://box-ef01.waitron.local";

  const enrolAt = async (origin: string) => {
    const { token } = await openManagementSession(suite.db, "admin");
    const begun = await run((tx) =>
      beginPasskeyRegistration(tx, { managementSessionId: token, rpId: RP_ID, rpName: "Waitron" }),
    );
    return run((tx) =>
      finishPasskeyRegistration(tx, {
        managementSessionId: token,
        challengeHandle: begun.challengeHandle,
        response: registrationResponse(begun.options.challenge, origin),
        rpId: RP_ID,
        origin: LISTED,
      }),
    );
  };

  const signInAt = async (origin: string) => {
    const { personId } = await openManagementSession(suite.db, "admin");
    const assert = await seedSigningPasskey(personId);
    const begun = await run((tx) => beginPasskeyAuthentication(tx, { rpId: RP_ID }));
    return run((tx) =>
      finishPasskeyAuthentication(tx, {
        challengeHandle: begun.challengeHandle,
        response: assert(begun.options.challenge, origin),
        rpId: RP_ID,
        origin: LISTED,
      }),
    );
  };

  const checkOwnAt = async (origin: string) => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    const assert = await seedSigningPasskey(personId);
    const begun = await run((tx) =>
      beginOwnPasskeyCheck(tx, { managementSessionId: token, rpId: RP_ID }),
    );
    return run((tx) =>
      verifyOwnPasskey(tx, {
        managementSessionId: token,
        challengeHandle: begun.challengeHandle,
        response: assert(begun.options.challenge, origin),
        rpId: RP_ID,
        origin: LISTED,
        keyRing: TOTP_KEY_RING,
      }),
    );
  };

  it.each(LISTED)("enrols a passkey made at %s", async (origin) => {
    expect((await enrolAt(origin)).credentialId).toBeTruthy();
  });

  it("refuses to enrol a passkey made at an origin the list does not hold", async () => {
    expect(await codeOf(() => enrolAt(UNLISTED))).toBe("passkey.verification_failed");
  });

  it.each(LISTED)("signs in with an assertion made at %s", async (origin) => {
    expect((await signInAt(origin)).token).toBeTruthy();
  });

  it("refuses a sign-in made at an origin the list does not hold", async () => {
    expect(await codeOf(() => signInAt(UNLISTED))).toBe("passkey.verification_failed");
  });

  it.each(LISTED)("accepts the person's own passkey checked at %s", async (origin) => {
    await expect(checkOwnAt(origin)).resolves.toBeUndefined();
  });

  it("refuses the person's own passkey checked at an origin the list does not hold", async () => {
    expect(await codeOf(() => checkOwnAt(UNLISTED))).toBe("passkey.verification_failed");
  });
});

describe("an assertion checked against a given challenge, writing nothing", () => {
  const CHALLENGE = "c3dpdGNoLWNoYWxsZW5nZQ";
  const VENUE = "https://waitron.local";
  const BOX = "https://box-abcd.waitron.local";

  const verifyAt = (response: unknown, challenge = CHALLENGE, origin: string[] = [VENUE, BOX]) =>
    run((tx) =>
      verifyPasskeyAssertion(tx, { challenge, response: response as never, rpId: RP_ID, origin }),
    );

  /** Every row of every table, so a write anywhere shows as a difference. */
  const everyRow = () => {
    const tables = suite.db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
    );
    return Object.fromEntries(
      tables.map(({ name }) => [name, suite.db.all(sql.raw(`select * from "${name}"`))]),
    );
  };

  it("returns the person whose passkey made an assertion over the given challenge", async () => {
    const personId = await seedPerson(suite.db, "admin");
    const assert = await seedSigningPasskey(personId);

    expect(await verifyAt(assert(CHALLENGE, BOX))).toEqual({ personId });
  });

  it("changes no row in any table, so the counter, challenges and sessions stay as they were", async () => {
    const personId = await seedPerson(suite.db, "admin");
    const assert = await seedSigningPasskey(personId);
    const pending = await run((tx) => beginPasskeyAuthentication(tx, { rpId: RP_ID }));
    const before = everyRow();

    await verifyAt(assert(pending.options.challenge, VENUE), pending.options.challenge);

    expect(everyRow()).toEqual(before);
  });

  it("refuses an assertion over another challenge", async () => {
    const personId = await seedPerson(suite.db, "admin");
    const assert = await seedSigningPasskey(personId);

    expect(await codeOf(() => verifyAt(assert("b3RoZXItY2hhbGxlbmdl", VENUE)))).toBe(
      "passkey.verification_failed",
    );
  });

  it("refuses an assertion made at an origin the list does not hold", async () => {
    const personId = await seedPerson(suite.db, "admin");
    const assert = await seedSigningPasskey(personId);

    expect(await codeOf(() => verifyAt(assert(CHALLENGE, "https://box-ef01.waitron.local")))).toBe(
      "passkey.verification_failed",
    );
  });

  // The signer reports a counter of 1.
  it.each([1, 2])("refuses an assertion whose counter is not above a stored %i", async (stored) => {
    const personId = await seedPerson(suite.db, "admin");
    const assert = await seedSigningPasskey(personId, stored);

    expect(await codeOf(() => verifyAt(assert(CHALLENGE, VENUE)))).toBe(
      "passkey.verification_failed",
    );
  });

  it("refuses a passkey whose person is not active", async () => {
    const personId = await seedPerson(suite.db, "admin", "suspended");
    const assert = await seedSigningPasskey(personId);

    expect(await codeOf(() => verifyAt(assert(CHALLENGE, VENUE)))).toBe(
      "passkey.verification_failed",
    );
  });

  it("refuses a credential no one enrolled", async () => {
    const stranger = signingPasskey(RP_ID);

    expect(await codeOf(() => verifyAt(stranger.assert(CHALLENGE, VENUE)))).toBe(
      "passkey.not_registered",
    );
  });
});
