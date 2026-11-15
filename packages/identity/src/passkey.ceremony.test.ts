/**
 * Each passkey ceremony accepts only a challenge its own begin issued, checked with the real
 * WebAuthn verifier: the responses here are built and signed with `node:crypto`, not mocked.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  withTransaction,
  managementSessions,
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
} from "./passkey.js";
import { codeOf, openManagementSession, TOTP_KEY_RING } from "../test/fixtures.js";
import { cbor, newKey, rpIdHash, signingPasskey } from "../test/passkey-signer.js";

const RP_ID = "localhost";
const ORIGIN = "http://localhost";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

/** A `none`-attestation registration response for `challenge`, user present and verified. */
function registrationResponse(challenge: string, origin = ORIGIN) {
  const id = randomBytes(32);
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(id.length);
  const authData = Buffer.concat([
    rpIdHash(RP_ID),
    Buffer.from([0x45]), // user present, user verified, attested credential data
    Buffer.alloc(4),
    Buffer.alloc(16),
    idLength,
    id,
    newKey().cose,
  ]);
  const attestationObject = cbor(
    new Map<unknown, unknown>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", authData],
    ]),
  );
  const clientData = { type: "webauthn.create", challenge, origin, crossOrigin: false };
  return {
    id: id.toString("base64url"),
    rawId: id.toString("base64url"),
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: Buffer.from(JSON.stringify(clientData)).toString("base64url"),
      attestationObject: attestationObject.toString("base64url"),
      transports: ["internal" as const],
    },
  };
}

/** Stores a passkey for `personId` and returns a signer of assertions from it. */
async function seedSigningPasskey(personId: string) {
  const passkey = signingPasskey(RP_ID);
  await suite.db.insert(webauthnCredentials).values({
    personId,
    credentialId: passkey.credentialId,
    publicKey: passkey.publicKey,
    counter: 0,
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

  const sessionCount = async () => (await suite.db.select().from(managementSessions)).length;

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
  const LISTED = [VENUE, BOX] as const;
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
