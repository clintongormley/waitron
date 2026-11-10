import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createLeaseIssuer, verifyLease, InstallationError } from "../index.js";
const keys = generateKeyPairSync("ed25519"),
  other = generateKeyPairSync("ed25519");
const issuer = createLeaseIssuer(
  keys.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url"),
);
const publicKey = other.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
const now = 1_800_000_000_000;
const claims = {
  origin: "https://cloud.example.test",
  leaseId: randomUUID(),
  installationId: randomUUID(),
  venueId: randomUUID(),
  environment: "test" as const,
  publicKey,
  issuedAt: now,
  expiresAt: now + 3600000,
};
const trusted = new Map([[issuer.keyId, issuer.publicKey]]);
const check = (lease: unknown = issuer.issue(claims), at = now) =>
  verifyLease(lease, trusted, claims.origin, at);
it("emits literal access-v1 fields and binds the supplied issuer trust and scope", () => {
  const lease = issuer.issue(claims);
  expect(Buffer.from(lease.payload, "base64url").toString()).toBe(
    JSON.stringify([
      "waitron-cloud-access-v1",
      claims.origin,
      issuer.keyId,
      claims.leaseId,
      claims.installationId,
      claims.venueId,
      "test",
      publicKey,
      now,
      now + 3600000,
      "control",
    ]),
  );
  expect(check(lease)).toEqual({ ...claims, keyId: issuer.keyId, audience: "control" });
  expect(() => verifyLease(lease, new Map(), claims.origin, now)).toThrow(InstallationError);
  expect(() =>
    verifyLease(lease, new Map([[issuer.keyId, publicKey]]), claims.origin, now),
  ).toThrow(InstallationError);
  expect(() => verifyLease(lease, trusted, "https://other.test", now)).toThrow(InstallationError);
  const values = JSON.parse(Buffer.from(lease.payload, "base64url").toString());
  for (let index = 1; index <= 10; index++) {
    const changed = [...values];
    changed[index] = index === 8 || index === 9 ? now + 1 : "changed";
    expect(() =>
      check({ ...lease, payload: Buffer.from(JSON.stringify(changed)).toString("base64url") }),
    ).toThrow(InstallationError);
  }
});
it("allows at most sixty seconds ahead and refuses exactly expired authority", () => {
  const value = { ...claims, issuedAt: now + 60000, expiresAt: now + 3600000 };
  expect(check(issuer.issue(value))).toEqual({
    ...value,
    keyId: issuer.keyId,
    audience: "control",
  });
  expect(() => check(issuer.issue({ ...value, issuedAt: now + 60001 }))).toThrow(InstallationError);
  expect(() => check(issuer.issue(claims), claims.expiresAt)).toThrow(InstallationError);
  expect(check(issuer.issue(claims), claims.expiresAt - 1)).toEqual({
    ...claims,
    keyId: issuer.keyId,
    audience: "control",
  });
});
it.each([
  { installationId: "bad" },
  { venueId: "bad" },
  { leaseId: "bad" },
  { expiresAt: now },
  { expiresAt: now + 3600001 },
  { environment: "dev" },
  { publicKey: "bad" },
  { issuedAt: -1 },
  { expiresAt: 1.5 },
  { origin: "ftp://other.test" },
])("refuses invalid authority %j", (change) =>
  expect(() => issuer.issue({ ...claims, ...change } as typeof claims)).toThrow(InstallationError),
);
it("refuses other key algorithms, malformed private encodings and malformed envelopes", () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 });
  expect(() =>
    createLeaseIssuer(
      rsa.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url"),
    ),
  ).toThrow(InstallationError);
  for (const value of ["", "bad=", "a".repeat(257)])
    expect(() => createLeaseIssuer(value)).toThrow();
  for (const value of [null, [], {}, { ...issuer.issue(claims), extra: true }])
    expect(() => check(value)).toThrow(InstallationError);
});

it("rejects a supported-size non-Ed25519 issuer and checks default-clock expiry", () => {
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  expect(() =>
    createLeaseIssuer(ec.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url")),
  ).toThrow(InstallationError);
  vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    expect(() =>
      verifyLease(
        issuer.issue({ ...claims, issuedAt: now - 60000, expiresAt: now }),
        trusted,
        claims.origin,
      ),
    ).toThrow(InstallationError);
  } finally {
    vi.restoreAllMocks();
  }
});

it("refuses a differently named format even with valid issuer authority", () => {
  const values = JSON.parse(Buffer.from(issuer.issue(claims).payload, "base64url").toString());
  values[0] = "waitron-cloud-access-v2";
  const bytes = Buffer.from(JSON.stringify(values));
  expect(() =>
    check({
      payload: bytes.toString("base64url"),
      signature: sign(null, bytes, keys.privateKey).toString("base64url"),
    }),
  ).toThrow(InstallationError);
});
