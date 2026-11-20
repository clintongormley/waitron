import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  pairingPayload,
  pairingV4Payload,
  pairingVenueName,
  PAIRING_VENUE_NAME_MAX,
  verifyPairingProof,
  verifyPairingV4Proof,
  encodeMachine,
  verifyMachine,
  createLeaseIssuer,
  verifyLease,
  type PairingV4Action,
  type PairingV4Claims,
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
  venueId: "",
  environment: "test" as const,
  code: "12345678",
  organisationId: "",
  legalBusinessId: "",
  issuedAt: now,
  venueName: "Bar Pepe",
};
const bytes = pairingPayload(pair);
assert.equal(
  bytes.toString(),
  JSON.stringify([
    "waitron-cloud-pair-v3",
    origin,
    "start",
    id(1),
    publicKey,
    "",
    "test",
    "12345678",
    "",
    "",
    now,
    "Bar Pepe",
  ]),
);
assert.equal(pairingVenueName(` ${"😀".repeat(121)} `), "😀".repeat(PAIRING_VENUE_NAME_MAX));
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
const status: PairingV4Action = "status";
const pairV4: PairingV4Claims = {
  origin,
  requestId: id(1),
  publicKey,
  issuedAt: now,
  action: status,
  args: [],
};
const bytesV4 = pairingV4Payload(pairV4);
assert.equal(
  bytesV4.toString(),
  JSON.stringify(["waitron-cloud-pair-v4", origin, status, id(1), publicKey, "test", now, []]),
);
assert.deepEqual(
  verifyPairingV4Proof(
    bytesV4.toString("base64url"),
    sign(null, bytesV4, keys.privateKey).toString("base64url"),
    origin,
    status,
    now,
  ),
  pairV4,
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
for (const action of [
  "owner-recovery-read",
  "owner-recovery-approve",
  "owner-recovery-refuse",
] as const) {
  const recoveryClaims = { ...claims, action },
    bytes = encodeMachine(recoveryClaims),
    signed = {
      payload: bytes.toString("base64url"),
      signature: sign(null, bytes, keys.privateKey).toString("base64url"),
    };
  assert.deepEqual(verifyMachine(signed, publicKey, origin, action, now), recoveryClaims);
  assert.throws(() => verifyMachine(signed, publicKey, origin, "configuration", now), {
    code: "invalid_proof",
  });
}
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
