import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import type { PaperBlock, PaperConsumption } from "../paper-protocol.js";
import type { RegisterScope } from "../register-protocol.js";
import { paperBlockBytes, paperConsumptionBytes } from "../paper-protocol.js";

export const registerScope: RegisterScope = {
  taxpayerNif: "B12345674",
  softwareId: "W1",
  environment: "production",
};
export const registerSeed = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
export const registerPrivate = createPrivateKey({
  key: Buffer.from("302e020100300506032b657004220420" + registerSeed, "hex"),
  format: "der",
  type: "pkcs8",
});
const publicKey = createPublicKey(registerPrivate);
export const registerTrust = {
  scope: { ...registerScope, custodianId: "10000000-0000-4000-8000-000000000001" },
  publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  fingerprint: createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex"),
};
export function canonicalFixture(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalFixture).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalFixture(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function fixtureDigest(value: unknown): string {
  return createHash("sha256").update(canonicalFixture(value)).digest("hex");
}
export function fixtureSign<T>(payload: T, domain: string) {
  return {
    payload,
    signature: sign(
      null,
      Buffer.from(canonicalFixture([domain, 1, payload])),
      registerPrivate,
    ).toString("base64url"),
  };
}
export function reservation(serial: number, recipient = "venue-1") {
  const identity = `S${String(serial).padStart(6, "0")}`;
  const payload: PaperBlock = {
    version: 1,
    custodianId: registerTrust.scope.custodianId,
    generationId: "generation-1",
    blockId: `block-${serial}`,
    packVersion: 1,
    recipientVenueId: recipient,
    allocations: [
      {
        version: 1,
        allocationId: `allocation-${serial}`,
        ...registerScope,
        installationIdentity: identity,
        series: [{ code: `A-${identity}`, purpose: "standard" }],
        source: "initial-paper",
        issuedAt: "2026-10-15T08:00:00.000Z",
      },
    ],
  };
  return {
    payload,
    signature: sign(null, paperBlockBytes(payload), registerPrivate).toString("base64url"),
  };
}
export function consumption(block = reservation(1)) {
  const payload: PaperConsumption = {
    version: 1,
    custodianId: registerTrust.scope.custodianId,
    blockDigest: createHash("sha256").update(paperBlockBytes(block.payload)).digest("hex"),
    allocationId: block.payload.allocations[0]!.allocationId,
    eventId: `event-${block.payload.blockId}`,
    operatorId: "administrator-1",
    sourceId: "first-setup:attempt-1",
    targetNodeId: `node-${block.payload.blockId}`,
    incidentEvidence: "first Live setup",
    consumedAt: "2026-10-15T08:01:00.000Z",
  };
  return {
    payload,
    signature: sign(null, paperConsumptionBytes(payload), registerPrivate).toString("base64url"),
  };
}
export function revision(
  events: readonly unknown[],
  sHighWater: number,
  pHighWater = 0,
  previousDigest = "0".repeat(64),
  number = "1",
) {
  return fixtureSign(
    {
      version: 1,
      registerId: "register-1",
      scope: registerScope,
      revision: number,
      previousDigest,
      createdAt: "2026-10-15T08:02:00.000Z",
      sHighWater,
      pHighWater,
      events,
    },
    "waitron.paper-register-revision",
  );
}
export function completeHistory(
  revisions = [
    revision(
      [
        { kind: "reserve", block: reservation(1) },
        { kind: "consume", consumption: consumption() },
      ],
      1,
    ),
  ],
) {
  return {
    version: 1,
    mode: "complete" as const,
    scope: registerScope,
    registerId: "register-1",
    custodianId: registerTrust.scope.custodianId,
    fingerprint: registerTrust.fingerprint,
    custodyVersion: 1,
    revisions,
  };
}
export function checkpointHistory(sHighWater = 42, pHighWater = 7) {
  return {
    version: 1,
    mode: "checkpoint" as const,
    scope: registerScope,
    registerId: "continuation-1",
    custodianId: registerTrust.scope.custodianId,
    fingerprint: registerTrust.fingerprint,
    custodyVersion: null,
    checkpoint: fixtureSign(
      {
        version: 1,
        kind: "paper-burn-checkpoint",
        checkpointId: "checkpoint-1",
        scope: registerScope,
        custodianId: registerTrust.scope.custodianId,
        fingerprint: registerTrust.fingerprint,
        sHighWater,
        pHighWater,
        sourceHeadTag: "0123456789ABCDEF",
        currentOriginalConfirmed: true,
        noParallelPaperAllocation: true,
        completeHistoryUnavailable: true,
        burnAllPrior: true,
        createdAt: "2026-10-15T08:02:00.000Z",
      },
      "waitron.paper-burn-checkpoint",
    ),
    retainedOriginals: [],
    revisions: [],
  };
}
