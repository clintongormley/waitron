import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  pairingPayload,
  verifyPairingProof,
  encodeMachine,
  verifyMachine,
  createLeaseIssuer,
  verifyLease,
} from "@waitron/contract";
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
const origin = "https://cloud.example.test",
  now = 1_800_000_000_000;
const id = (n: number) => `${n}2345678-1234-4234-8234-123456789abc`;
const pair = {
  origin,
  action: "start" as const,
  requestId: id(1),
  publicKey,
  localVenueId: id(2),
  environment: "test" as const,
  code: "12345678",
  organisationId: "",
  legalBusinessId: "",
  issuedAt: now,
};
const bytes = pairingPayload(pair);
assert.equal(
  bytes.toString(),
  JSON.stringify([
    "waitron-cloud-pair-v1",
    origin,
    "start",
    id(1),
    publicKey,
    id(2),
    "test",
    "12345678",
    "",
    "",
    now,
  ]),
);
assert.deepEqual(
  verifyPairingProof(
    bytes.toString("base64url"),
    sign(null, bytes, keys.privateKey).toString("base64url"),
    origin,
    "start",
    now,
  ),
  pair,
);
const claims = {
  origin,
  action: "configuration" as const,
  installationId: id(3),
  operationId: id(4),
  issuedAt: now,
  lease: "{}",
  body: "{}",
};
const machine = encodeMachine(claims),
  envelope = {
    payload: machine.toString("base64url"),
    signature: sign(null, machine, keys.privateKey).toString("base64url"),
  };
assert.equal(
  machine.toString(),
  JSON.stringify([
    "waitron-cloud-machine-v1",
    origin,
    "configuration",
    id(3),
    id(4),
    now,
    "{}",
    "{}",
  ]),
);
assert.deepEqual(verifyMachine(envelope, publicKey, origin, "configuration", now), claims);
assert.throws(() => verifyMachine(envelope, publicKey, origin, "report", now));
const issuer = createLeaseIssuer(
  keys.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url"),
);
const leaseClaims = {
  origin,
  leaseId: id(5),
  installationId: id(3),
  venueId: id(2),
  environment: "test" as const,
  publicKey,
  issuedAt: now,
  expiresAt: now + 3600000,
};
const lease = issuer.issue(leaseClaims);
assert.equal(
  Buffer.from(lease.payload, "base64url").toString(),
  JSON.stringify([
    "waitron-cloud-access-v1",
    origin,
    issuer.keyId,
    id(5),
    id(3),
    id(2),
    "test",
    publicKey,
    now,
    now + 3600000,
    "control",
  ]),
);
assert.deepEqual(verifyLease(lease, new Map([[issuer.keyId, issuer.publicKey]]), origin, now), {
  ...leaseClaims,
  keyId: issuer.keyId,
  audience: "control",
});
assert.throws(() => verifyLease(lease, new Map(), origin, now));
