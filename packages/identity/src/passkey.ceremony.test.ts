/**
 * Each passkey ceremony accepts only a challenge its own begin issued, checked with the real
 * WebAuthn verifier: the responses here are built and signed with `node:crypto`, not mocked.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import {
  beginOwnPasskeyCheck,
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  verifyOwnPasskey,
} from "./passkey.js";
import { managementSessions } from "./schema/management-sessions.js";
import { webauthnCredentials } from "./schema/webauthn.js";
import { codeOf, openManagementSession, TOTP_KEY_RING } from "../test/fixtures.js";

const RP_ID = "localhost";
const ORIGIN = "http://localhost";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

function cborHead(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  const b = Buffer.alloc(3);
  b[0] = (major << 5) | 25;
  b.writeUInt16BE(n, 1);
  return b;
}

/** The CBOR subset a `none` attestation and a COSE key need. */
function cbor(value: unknown): Buffer {
  if (typeof value === "number") return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  if (typeof value === "string") {
    const b = Buffer.from(value);
    return Buffer.concat([cborHead(3, b.length), b]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2, value.length), value]);
  if (value instanceof Map) {
    return Buffer.concat([
      cborHead(5, value.size),
      ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)]),
    ]);
  }
  throw new Error("unsupported CBOR value");
}

const rpIdHash = () => createHash("sha256").update(RP_ID).digest();

function newKey(): { cose: Buffer; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = cbor(
    new Map<unknown, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, "base64url")],
      [-3, Buffer.from(jwk.y!, "base64url")],
    ]),
  );
  return { cose, privateKey };
}

/** A `none`-attestation registration response for `challenge`, user present and verified. */
function registrationResponse(challenge: string) {
  const id = randomBytes(32);
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(id.length);
  const authData = Buffer.concat([
    rpIdHash(),
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
  const clientData = { type: "webauthn.create", challenge, origin: ORIGIN, crossOrigin: false };
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
  const { cose, privateKey } = newKey();
  const id = randomBytes(32).toString("base64url");
  await suite.db
    .insert(webauthnCredentials)
    .values({ personId, credentialId: id, publicKey: cose.toString("base64url"), counter: 0 });
  return (challenge: string) => {
    const clientData = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: false }),
    );
    const authData = Buffer.concat([rpIdHash(), Buffer.from([0x05]), Buffer.from([0, 0, 0, 1])]);
    const signature = sign(
      "sha256",
      Buffer.concat([authData, createHash("sha256").update(clientData).digest()]),
      privateKey,
    );
    return {
      id,
      rawId: id,
      type: "public-key" as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientData.toString("base64url"),
        authenticatorData: authData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    };
  };
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
