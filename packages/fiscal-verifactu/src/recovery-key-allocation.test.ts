import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
  verifyPaperEvidence,
} from "./paper-evidence.js";
import { validateAllocationEnvelope, type AllocationContext } from "./allocation-envelope.js";
const primary = { nodeId: "old-node" };
const target = { nodeId: "replacement-node" };
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const trust = enrolPaperCustodian("custodian", publicKey, paperCustodianFingerprint(publicKey))!;
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const candidate = {
  version: 1 as const,
  allocationId: "allocation-42",
  taxpayerNif: "89890001K",
  softwareId: "W1",
  environment: "preproduction" as const,
  installationIdentity: "P000042",
  source: "paper" as const,
  issuedAt: "2026-10-12T08:00:00.000Z",
  series: [
    { code: "A-P000042", purpose: "standard" },
    { code: "FF-P000042", purpose: "full" },
    { code: "R-P000042", purpose: "rectificative" },
  ],
};
const block = signPaperBlock(
  {
    version: 1,
    custodianId: "custodian",
    generationId: "generation-1",
    blockId: "block-1",
    packVersion: 1,
    recipientVenueId: "venue-1",
    allocations: [candidate],
  },
  privateKey,
);
const recoveryOperator = {
  kind: "recovery-key" as const,
  nodeId: target.nodeId,
  eventId: "takeover-1",
};
const approval = {
  version: 1 as const,
  eventId: "takeover-1",
  operatorId: recoveryOperator,
  sourceId: primary.nodeId,
  targetNodeId: target.nodeId,
  incidentEvidence: "master/takeover-1",
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: "2026-10-12T10:00:00.000Z",
};
const consumption = {
  version: 1 as const,
  custodianId: "custodian",
  blockDigest: createHash("sha256")
    .update(
      JSON.stringify([
        "waitron.paper-block",
        1,
        "custodian",
        "generation-1",
        "block-1",
        1,
        "venue-1",
        [
          [
            1,
            "allocation-42",
            "89890001K",
            "W1",
            "preproduction",
            "P000042",
            [
              ["A-P000042", "standard"],
              ["FF-P000042", "full"],
              ["R-P000042", "rectificative"],
            ],
            "paper",
            "2026-10-12T08:00:00.000Z",
          ],
        ],
      ]),
    )
    .digest("hex"),
  allocationId: "allocation-42",
  eventId: "takeover-1",
  operatorId: recoveryOperator,
  sourceId: primary.nodeId,
  targetNodeId: target.nodeId,
  incidentEvidence: "master/takeover-1",
  consumedAt: "2026-10-12T10:00:00.000Z",
};
const signedConsumption = {
  payload: consumption,
  signature: sign(
    null,
    Buffer.from(
      JSON.stringify([
        "waitron.paper-consumption",
        1,
        "custodian",
        consumption.blockDigest,
        "allocation-42",
        "takeover-1",
        { kind: "recovery-key", nodeId: target.nodeId, eventId: "takeover-1" },
        primary.nodeId,
        target.nodeId,
        "master/takeover-1",
        "2026-10-12T10:00:00.000Z",
      ]),
    ),
    privateKey,
  ).toString("base64url"),
};
const allocation = { ...candidate, reservationEvidence: { block, consumption: signedConsumption } };

const context: AllocationContext = {
  taxpayerNif: candidate.taxpayerNif,
  softwareId: "W1",
  environment: "preproduction",
  mode: "recovery",
  eventId: "takeover-1",
  operatorId: recoveryOperator,
  sourceId: primary.nodeId,
  targetNodeId: target.nodeId,
  incidentEvidence: "master/takeover-1",
  requiredBases: bases,
  reauthentication: { operatorId: recoveryOperator, eventId: "takeover-1" },
  priorActivation: "none",
  authority: {
    kind: "paper",
    trust,
    recipientVenueId: "venue-1",
    generationId: "generation-1",
    blockId: "block-1",
    currentRegisterConfirmed: true,
    consumptionConfirmed: true,
    currentEntryState: "consumed-for-event",
  },
};
const event = {
  eventId: "takeover-1",
  operatorId: recoveryOperator,
  sourceId: primary.nodeId,
  targetNodeId: target.nodeId,
  incidentEvidence: "master/takeover-1",
  consumedAt: "2026-10-12T10:00:00.000Z",
};
const evidenceContext = {
  ...context,
  ...context.authority,
  allocationId: candidate.allocationId,
  currentRegisterConfirmed: true,
  consumptionConfirmed: true,
  recipientVenueId: "venue-1",
  generationId: "generation-1",
  blockId: "block-1",
};

describe("signed recovery-key allocation", () => {
  it("verifies independent signed bytes and canonicalises the key event regardless of object key order", () => {
    const signed = signPaperConsumptionForBlock(
      block,
      candidate.allocationId,
      {
        ...event,
        operatorId: { eventId: "takeover-1", nodeId: target.nodeId, kind: "recovery-key" },
      },
      privateKey,
    );
    expect(signed).toEqual(signedConsumption);
    expect(verifyPaperEvidence(allocation.reservationEvidence, trust, evidenceContext)).toEqual({
      ok: true,
      allocation: candidate,
    });
    expect(validateAllocationEnvelope(allocation, approval, context)).toEqual({
      ok: true,
      allocation,
      approval,
    });
  });

  it.each([
    null,
    undefined,
    [],
    1,
    true,
    "",
    " ",
    "bad\nvalue",
    "x".repeat(257),
    {},
    { kind: "password", nodeId: target.nodeId, eventId: "takeover-1" },
    { ...recoveryOperator, nodeId: "" },
    { ...recoveryOperator, eventId: "" },
    { ...recoveryOperator, secret: "must-never-be-recorded" },
    Object.assign(Object.create({ nodeId: target.nodeId, eventId: "takeover-1" }) as object, {
      kind: "recovery-key",
      unexpected: true,
      secret: "must-never-be-recorded",
    }),
  ])("refuses malformed attribution %# in both the signer and the approval", (operatorId) => {
    expect(() =>
      signPaperConsumptionForBlock(
        block,
        candidate.allocationId,
        { ...event, operatorId },
        privateKey,
      ),
    ).toThrow("Invalid paper consumption");
    expect(
      validateAllocationEnvelope(
        allocation,
        { ...approval, operatorId },
        { ...context, operatorId: operatorId as never },
      ),
    ).toEqual({ ok: false, reason: "malformed_approval" });
  });

  it.each([
    { ...recoveryOperator, nodeId: primary.nodeId },
    { ...recoveryOperator, eventId: "other-event" },
  ])("refuses a key event for another node or event before signing %#", (operatorId) => {
    expect(() =>
      signPaperConsumptionForBlock(
        block,
        candidate.allocationId,
        { ...event, operatorId },
        privateKey,
      ),
    ).toThrow("Invalid paper consumption");
    expect(
      validateAllocationEnvelope(
        allocation,
        { ...approval, operatorId },
        { ...context, operatorId, reauthentication: { operatorId, eventId: "takeover-1" } },
      ),
    ).toEqual({ ok: false, reason: "reauthentication_required" });
  });

  it("refuses a changed key event under the original signature", () => {
    const altered = structuredClone(allocation.reservationEvidence);
    altered.consumption.payload.operatorId.nodeId = "substituted";
    altered.consumption.payload.targetNodeId = "substituted";
    expect(verifyPaperEvidence(altered, trust, evidenceContext)).toEqual({
      ok: false,
      reason: "untrusted",
    });
  });

  it("keeps recovery-key authority out of initial setup", () => {
    const initial = {
      ...candidate,
      source: "initial-paper" as const,
      installationIdentity: "S000042",
      series: [
        { code: "A-S000042", purpose: "standard" },
        { code: "FF-S000042", purpose: "full" },
        { code: "R-S000042", purpose: "rectificative" },
      ],
    };
    expect(
      validateAllocationEnvelope(
        { ...initial, reservationEvidence: {} },
        { ...approval, oldMachineAbsent: true },
        { ...context, mode: "initial-setup" },
      ),
    ).toEqual({ ok: false, reason: "reauthentication_required" });
  });
});
