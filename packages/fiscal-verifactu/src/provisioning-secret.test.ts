import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { getCredential, loadKeyRing, type KeyRing } from "@waitron/credentials";
import { hasCode, isAppError } from "@waitron/shared";
import { makeAuthority } from "../test/certificate-fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import {
  parseAeatCert,
  sealAeatSecret,
  validateAeatCert,
  type AeatCert,
} from "./provisioning-secret.js";

const NODE_ID = "node-a";

const suite = useVenueDb({
  migrations: TEST_MIGRATIONS,
  timeoutMs: 120_000,
});

function testRing(): KeyRing {
  return loadKeyRing({
    WAITRON_CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
}

function aeatCert(overrides: Partial<AeatCert> = {}): AeatCert {
  return {
    pfxBase64: randomBytes(48).toString("base64"),
    passphrase: "cert-pass-9",
    certKind: "sello",
    ...overrides,
  };
}

const authority = makeAuthority();
const representative = authority.issue();
const seal = authority.issue({ policies: ["0.4.0.194112.1.1"] });

describe("sealAeatSecret", () => {
  it.each([
    ["a representative's file", representative, "sello", "representante"],
    ["a seal's file", seal, "representante", "sello"],
  ] as const)(
    "seals %s with the type its policies name, whatever type the secret carries",
    async (_label, file, carried, kind) => {
      const ring = testRing();
      const cert = { pfxBase64: file.pfx.toString("base64"), passphrase: file.passphrase };

      await sealAeatSecret({ db: suite.db, ring, nodeId: NODE_ID }, { ...cert, certKind: carried });

      const readBack = await withTransaction(suite.db, (tx) =>
        getCredential(tx, ring, { purpose: "fiscal.aeat" }),
      );
      expect(readBack).toEqual({ ...cert, certKind: kind });
    },
  );

  it("seals the cert into fiscal.aeat and reads back the three fields intact", async () => {
    const ring = testRing();
    const cert = aeatCert({ certKind: "representante" });

    await sealAeatSecret({ db: suite.db, ring, nodeId: NODE_ID }, cert);

    const readBack = await withTransaction(suite.db, (tx) =>
      getCredential(tx, ring, { purpose: "fiscal.aeat" }),
    );
    expect(readBack).toEqual({
      pfxBase64: cert.pfxBase64,
      passphrase: cert.passphrase,
      certKind: "representante",
    });
  });

  it("refuses a certKind outside {sello, representante} and seals nothing", async () => {
    const ring = testRing();
    // A non-empty string, so `putCredential`'s own `validatePayload` would accept it.
    const cert = aeatCert({ certKind: "bogus" as AeatCert["certKind"] });

    const error = await sealAeatSecret({ db: suite.db, ring, nodeId: NODE_ID }, cert).catch(
      (e: unknown) => e,
    );
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && hasCode(error, "setup.request_invalid") && error.params.field).toBe(
      "certKind",
    );

    const missing = await withTransaction(suite.db, (tx) =>
      getCredential(tx, ring, { purpose: "fiscal.aeat" }),
    ).catch((e: unknown) => e);
    expect(isAppError(missing) && missing.code).toBe("credentials.missing");
  });

  // `"QQ"` is valid characters but not a whole 4-char group.
  it.each([
    { label: "empty", pfxBase64: "" },
    { label: "non-base64 characters", pfxBase64: "not valid base64!!!" },
    { label: "a malformed base64 length", pfxBase64: "QQ" },
  ])("refuses a pfxBase64 that is $label and seals nothing", async ({ pfxBase64 }) => {
    const ring = testRing();
    const cert = aeatCert({ pfxBase64 });

    const error = await sealAeatSecret({ db: suite.db, ring, nodeId: NODE_ID }, cert).catch(
      (e: unknown) => e,
    );
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && hasCode(error, "setup.request_invalid") && error.params.field).toBe(
      "pfxBase64",
    );

    const missing = await withTransaction(suite.db, (tx) =>
      getCredential(tx, ring, { purpose: "fiscal.aeat" }),
    ).catch((e: unknown) => e);
    expect(isAppError(missing) && missing.code).toBe("credentials.missing");
  });

  it("accepts a short, canonically-padded base64 pfxBase64 (the tightened regex does not over-reject)", async () => {
    const ring = testRing();
    // `Buffer.from("hello").toString("base64")`: a genuine encoding with a padded tail.
    const cert = aeatCert({ pfxBase64: "aGVsbG8=" });

    await sealAeatSecret({ db: suite.db, ring, nodeId: NODE_ID }, cert);

    const readBack = await withTransaction(suite.db, (tx) =>
      getCredential(tx, ring, { purpose: "fiscal.aeat" }),
    );
    expect(readBack.pfxBase64).toBe("aGVsbG8=");
  });

  it("refuses a non-object raw blob naming aeatCert and seals nothing", async () => {
    const ring = testRing();

    const error = await sealAeatSecret(
      { db: suite.db, ring, nodeId: NODE_ID },
      "not-an-object",
    ).catch((e: unknown) => e);
    expect(isAppError(error) && hasCode(error, "setup.request_invalid") && error.params.field).toBe(
      "aeatCert",
    );

    const missing = await withTransaction(suite.db, (tx) =>
      getCredential(tx, ring, { purpose: "fiscal.aeat" }),
    ).catch((e: unknown) => e);
    expect(isAppError(missing) && missing.code).toBe("credentials.missing");
  });
});

// Tested directly: the empty-passphrase branch is unreachable through `parseAeatCert`, whose
// `asString` already refuses an empty string.
describe("validateAeatCert — full cert-value validation", () => {
  function goodCert(overrides: Partial<AeatCert> = {}): AeatCert {
    return {
      pfxBase64: randomBytes(48).toString("base64"),
      passphrase: "cert-pass-9",
      certKind: "sello",
      ...overrides,
    };
  }

  it("accepts a well-formed cert (base64 pfx + non-empty passphrase)", () => {
    expect(() => validateAeatCert(goodCert())).not.toThrow();
  });

  it.each<[string, AeatCert, string]>([
    ["an empty pfxBase64", goodCert({ pfxBase64: "" }), "pfxBase64"],
    ["a non-base64 pfxBase64", goodCert({ pfxBase64: "not base64!" }), "pfxBase64"],
    ["a malformed base64 length", goodCert({ pfxBase64: "QQ" }), "pfxBase64"],
    ["an empty passphrase", goodCert({ passphrase: "" }), "passphrase"],
  ])("rejects %s with setup.request_invalid naming the field", (_label, cert, field) => {
    let error: unknown;
    try {
      validateAeatCert(cert);
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && hasCode(error, "setup.request_invalid") && error.params.field).toBe(
      field,
    );
  });
});

describe("parseAeatCert — the checked secret the host carries", () => {
  const cert = { pfxBase64: randomBytes(48).toString("base64"), passphrase: "cert-pass-9" };

  it.each(["sello", "representante"])("reads a checked secret of type %s", (certKind) => {
    expect(parseAeatCert({ ...cert, certKind })).toEqual({ ...cert, certKind });
  });

  it.each([["bogus"], [undefined]])(
    "refuses a type %s outside the set, naming certKind",
    (certKind) => {
      expect(() => parseAeatCert({ ...cert, certKind })).toThrowError(
        expect.objectContaining({ code: "setup.request_invalid", params: { field: "certKind" } }),
      );
    },
  );
});

it("does not seal credentials when its opener is unavailable", async () => {
  const ring = testRing();
  const node = process.execPath;
  try {
    process.execPath = "/nonexistent/waitron-node";
    await expect(
      sealAeatSecret({ db: suite.db, ring, nodeId: NODE_ID }, aeatCert()),
    ).rejects.toMatchObject({
      code: "setup.certificate_refused",
      params: { field: "body", reason: "setup_stopped" },
    });
  } finally {
    process.execPath = node;
  }
  await expect(
    withTransaction(suite.db, (tx) => getCredential(tx, ring, { purpose: "fiscal.aeat" })),
  ).rejects.toMatchObject({ code: "credentials.missing" });
});
