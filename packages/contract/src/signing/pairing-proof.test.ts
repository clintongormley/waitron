import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { pairingPayload, verifyPairingProof, PairingError, type PairingClaims } from "../index.js";
const keys = generateKeyPairSync("ed25519");
const now = 1_800_000_000_000;
const claims: PairingClaims = {
  origin: "https://cloud.example.test",
  action: "start",
  requestId: "12345678-1234-4234-8234-123456789abc",
  venueId: "22345678-1234-4234-8234-123456789abc",
  publicKey: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
  environment: "test",
  code: "12345678",
  organisationId: "",
  legalBusinessId: "",
  issuedAt: now,
};
const proof = (c = claims) => {
  const bytes = pairingPayload(c);
  return {
    payload: bytes.toString("base64url"),
    signature: sign(null, bytes, keys.privateKey).toString("base64url"),
  };
};
const check = (p = proof(), origin = claims.origin, action = "start", at = now) =>
  verifyPairingProof(p.payload, p.signature, origin, action, at);
it("encodes the literal v2 fields and binds every signed field", () => {
  expect(pairingPayload(claims).toString()).toBe(
    JSON.stringify([
      "waitron-cloud-pair-v2",
      claims.origin,
      "start",
      claims.requestId,
      claims.publicKey,
      claims.venueId,
      "test",
      "12345678",
      "",
      "",
      now,
    ]),
  );
  expect(check()).toEqual(claims);
  for (const changed of [
    { requestId: randomUUID() },
    { code: "87654321" },
    { venueId: randomUUID() },
    { environment: "production" as const },
  ])
    expect(() =>
      check({ ...proof({ ...claims, ...changed }), signature: proof().signature }),
    ).toThrow(PairingError);
  expect(() => check(proof(), "https://other.test")).toThrow(PairingError);
  expect(() => check(proof(), claims.origin, "complete")).toThrow(PairingError);
});
it.each([-60000, 60000])("accepts the inclusive %i ms clock allowance", (delta) =>
  expect(check(proof({ ...claims, issuedAt: now + delta }))).toEqual({
    ...claims,
    issuedAt: now + delta,
  }),
);
it("enforces the 4096-character encoded payload limit with a matching origin", () => {
  const value = { ...claims, origin: `https://${"a".repeat(2845)}.test` };
  const boundary = proof(value);
  expect(boundary.payload).toHaveLength(4096);
  expect(check(boundary, value.origin)).toEqual(value);
  const oversized = { ...value, origin: value.origin + "a" };
  const envelope = proof(oversized);
  expect(envelope.payload).toHaveLength(4098);
  expect(() => check(envelope, oversized.origin)).toThrow(PairingError);
});
it.each([
  { issuedAt: now - 60001 },
  { issuedAt: now + 60001 },
  { issuedAt: 1.5 },
  { requestId: "bad" },
  { venueId: "bad" },
  { code: "123" },
  { organisationId: randomUUID() },
  { publicKey: "a".repeat(129) },
  { environment: "dev" },
])("refuses invalid claims %j", (changed) =>
  expect(() => check(proof({ ...claims, ...changed } as PairingClaims))).toThrow(PairingError),
);
it("refuses malformed, noncanonical and differently signed envelopes", () => {
  for (const value of [
    [],
    {},
    ["v2"],
    [...JSON.parse(pairingPayload(claims).toString()), "extra"],
  ]) {
    const bytes = Buffer.from(JSON.stringify(value));
    expect(() =>
      check({
        payload: bytes.toString("base64url"),
        signature: sign(null, bytes, keys.privateKey).toString("base64url"),
      }),
    ).toThrow(PairingError);
  }
  expect(() => check({ ...proof(), payload: proof().payload + "=" })).toThrow(PairingError);
  expect(() => check({ ...proof(), signature: proof().signature + "=" })).toThrow(PairingError);
  const other = generateKeyPairSync("ed25519");
  expect(() =>
    check({
      ...proof(),
      signature: sign(null, pairingPayload(claims), other.privateKey).toString("base64url"),
    }),
  ).toThrow(PairingError);
  const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 });
  expect(() =>
    check(
      proof({
        ...claims,
        publicKey: rsa.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
      }),
    ),
  ).toThrow(PairingError);
});
it("requires empty status choices and complete business identifiers", () => {
  const status = { ...claims, action: "status" as const, code: "" };
  expect(check(proof(status), claims.origin, "status")).toEqual(status);
  expect(() => check(proof({ ...status, code: "12345678" }), claims.origin, "status")).toThrow(
    PairingError,
  );
  const complete = {
    ...status,
    action: "complete" as const,
    organisationId: randomUUID(),
    legalBusinessId: randomUUID(),
  };
  expect(check(proof(complete), claims.origin, "complete")).toEqual(complete);
  for (const key of ["organisationId", "legalBusinessId"])
    expect(() => check(proof({ ...complete, [key]: "" }), claims.origin, "complete")).toThrow(
      PairingError,
    );
});

it("rejects a supported-size non-Ed25519 key and checks the default clock", () => {
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  expect(() =>
    check(
      proof({
        ...claims,
        publicKey: ec.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
      }),
    ),
  ).toThrow(PairingError);
  vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    const stale = proof({ ...claims, issuedAt: now - 60001 });
    expect(() =>
      verifyPairingProof(stale.payload, stale.signature, claims.origin, "start"),
    ).toThrow(PairingError);
  } finally {
    vi.restoreAllMocks();
  }
});

it("refuses an unpadded base64 alias of an otherwise valid signature", () => {
  const value = proof(),
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const alias =
    value.signature.slice(0, -1) + alphabet[alphabet.indexOf(value.signature.at(-1)!) + 1];
  expect(Buffer.from(alias, "base64url").equals(Buffer.from(value.signature, "base64url"))).toBe(
    true,
  );
  expect(() => check({ ...value, signature: alias })).toThrow(PairingError);
});

it("accepts a new venue without an id and refuses a signed v1 request", () => {
  const fresh = { ...claims, venueId: "" };
  expect(check(proof(fresh))).toEqual(fresh);
  const old = JSON.parse(pairingPayload(claims).toString());
  old[0] = "waitron-cloud-pair-v1";
  const bytes = Buffer.from(JSON.stringify(old));
  expect(() =>
    check({
      payload: bytes.toString("base64url"),
      signature: sign(null, bytes, keys.privateKey).toString("base64url"),
    }),
  ).toThrow(PairingError);
});
