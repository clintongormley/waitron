import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  encodeMachine,
  readMachineClaims,
  verifyMachine,
  InstallationError,
  type MachineClaims,
} from "../index.js";
const keys = generateKeyPairSync("ed25519"),
  other = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
const now = 1_800_000_000_000;
const claims: MachineClaims = {
  origin: "https://cloud.example.test",
  action: "configuration",
  installationId: randomUUID(),
  operationId: randomUUID(),
  issuedAt: now,
  lease: "{}",
  body: "{}",
};
const proof = (c = claims) => {
  const bytes = encodeMachine(c);
  return {
    payload: bytes.toString("base64url"),
    signature: sign(null, bytes, keys.privateKey).toString("base64url"),
  };
};
const check = (p: unknown = proof(), at = now) =>
  verifyMachine(p, publicKey, claims.origin, "configuration", at);
it("encodes literal v1 bytes while the checker authenticates its routing fields", () => {
  expect(encodeMachine(claims).toString()).toBe(
    JSON.stringify([
      "waitron-cloud-machine-v1",
      claims.origin,
      "configuration",
      claims.installationId,
      claims.operationId,
      now,
      "{}",
      "{}",
    ]),
  );
  expect(check()).toEqual(claims);
  expect(readMachineClaims(proof())).toEqual(claims);
  for (const change of [
    { origin: "https://other.test" },
    { action: "report" as const },
    { installationId: randomUUID() },
    { operationId: randomUUID() },
    { issuedAt: now + 1 },
    { lease: "" },
    { body: '{"x":1}' },
  ])
    expect(() =>
      check({ ...proof({ ...claims, ...change }), signature: proof().signature }),
    ).toThrow(InstallationError);
  expect(() =>
    verifyMachine(proof(), publicKey, "https://other.test", "configuration", now),
  ).toThrow(InstallationError);
  expect(() => verifyMachine(proof(), publicKey, claims.origin, "report", now)).toThrow(
    InstallationError,
  );
  expect(() =>
    check({
      ...proof(),
      signature: sign(null, encodeMachine(claims), other.privateKey).toString("base64url"),
    }),
  ).toThrow(InstallationError);
});
it.each([-60000, 60000])("accepts the inclusive %i ms clock allowance", (delta) =>
  expect(check(proof(), now + delta)).toEqual(claims),
);
it.each([-60001, 60001])("refuses a request %i ms from the clock", (delta) =>
  expect(() => check(proof(), now + delta)).toThrow(InstallationError),
);
it("enforces the 12000-character encoded payload limit on valid signed claims", () => {
  const value = { ...claims, lease: "x".repeat(4096), body: '"'.repeat(2366) + "a" };
  const boundary = proof(value);
  expect(boundary.payload).toHaveLength(12000);
  expect(check(boundary)).toEqual(value);
  const oversized = proof({ ...value, body: value.body + "a" });
  expect(oversized.payload).toHaveLength(12002);
  expect(() => check(oversized)).toThrow(InstallationError);
});
it.each([
  "billing-display",
  "renew",
  "report",
  "revoke",
  "backup-reserve",
  "backup-publish",
  "guest-menu-publish",
  "guest-menu-status",
  "guest-menu-withdraw",
  "backup-stream-configure",
  "backup-stream-observe",
  "staff-certificate-submit",
  "staff-certificate-status",
  "email-submit",
  "email-status",
  "email-cancel",
  "translation-submit",
  "translation-status",
  "translation-collect",
  "translation-release",
  "address-lookup",
  "tunnel-provision",
  "error-report",
  "release-held",
  "staff-report",
  "staff-description",
] as const)("keeps %s in the existing namespace and binds its action", (action) => {
  const value = { ...claims, action },
    signed = proof(value);
  expect(verifyMachine(signed, publicKey, claims.origin, action, now)).toEqual(value);
  expect(() => check(signed)).toThrow(InstallationError);
});
it("refuses an unknown action in signed routing claims", () => {
  const bytes = encodeMachine({ ...claims, action: "unknown" });
  const signed = {
    payload: bytes.toString("base64url"),
    signature: sign(null, bytes, keys.privateKey).toString("base64url"),
  };
  expect(() => readMachineClaims(signed)).toThrowError(
    expect.objectContaining({ code: "invalid_proof" }),
  );
});
it.each([
  { operationId: "bad" },
  { installationId: "bad" },
  { action: "unknown" },
  { issuedAt: 1.5 },
  { issuedAt: -1 },
  { origin: "ftp://other.test" },
  { origin: "https://cloud.example.test/path" },
  { body: "x".repeat(4097) },
  { lease: "x".repeat(4097) },
])("refuses invalid claims %j", (change) =>
  expect(() => check(proof({ ...claims, ...change } as MachineClaims))).toThrow(InstallationError),
);
it("keeps encoder-only adapter values and both string-cap boundaries", () => {
  expect(
    JSON.parse(
      encodeMachine({ ...claims, action: "adapter-action", installationId: undefined }).toString(),
    ).slice(2, 4),
  ).toEqual(["adapter-action", null]);
  const value = { ...claims, body: "x".repeat(4096), lease: "" };
  expect(check(proof(value))).toEqual(value);
  const leased = { ...claims, lease: "x".repeat(4096), body: "" };
  expect(check(proof(leased))).toEqual(leased);
});
it("refuses noncanonical envelopes, encoding, signatures and shapes", () => {
  for (const value of [
    null,
    [],
    { ...proof(), extra: true },
    { payload: "x", signature: "y" },
    { ...proof(), payload: proof().payload + "=" },
    { ...proof(), signature: proof().signature + "=" },
  ])
    expect(() => check(value)).toThrow(InstallationError);
  for (const value of [
    [],
    {},
    ["v2"],
    [...JSON.parse(encodeMachine(claims).toString()), "extra"],
  ]) {
    const bytes = Buffer.from(JSON.stringify(value));
    expect(() =>
      check({
        payload: bytes.toString("base64url"),
        signature: sign(null, bytes, keys.privateKey).toString("base64url"),
      }),
    ).toThrow(InstallationError);
  }
  const bytes = Buffer.from(" " + encodeMachine(claims).toString());
  expect(() =>
    check({
      payload: bytes.toString("base64url"),
      signature: sign(null, bytes, keys.privateKey).toString("base64url"),
    }),
  ).toThrow(InstallationError);
});

it("rejects a supported-size non-Ed25519 verifier and checks the default clock", () => {
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  expect(() =>
    verifyMachine(
      proof(),
      ec.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
      claims.origin,
      "configuration",
      now,
    ),
  ).toThrow(InstallationError);
  vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    expect(() =>
      verifyMachine(
        proof({ ...claims, issuedAt: now - 60001 }),
        publicKey,
        claims.origin,
        "configuration",
      ),
    ).toThrow(InstallationError);
  } finally {
    vi.restoreAllMocks();
  }
});

it.each([1, "x".repeat(257)])("refuses an origin outside its wire type or size", (origin) => {
  expect(() => readMachineClaims(proof({ ...claims, origin } as MachineClaims))).toThrow(
    InstallationError,
  );
});
