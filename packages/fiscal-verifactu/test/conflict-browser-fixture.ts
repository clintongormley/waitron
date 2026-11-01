import type {
  ConflictRequest,
  ConflictAllocationInput,
} from "../src/conflict-recovery-contract.js";
export const active = {
  registroId: "record-1",
  caseId: "case-1",
  sifId: "sif-1",
  installationIdentity: "0CNQA",
  invoiceIdentity: "A-0CNQA/19",
  observedAt: "2026-11-01T10:00:00.000Z",
  evidence: null,
  cause: "fiscal.huella_divergente",
  evidenceId: null,
};
export const input: ConflictAllocationInput = {
  allocation: {
    version: 1,
    allocationId: "hour/event-1",
    taxpayerNif: "89890001K",
    softwareId: "01",
    environment: "preproduction",
    installationIdentity: "0CNQR",
    series: [{ code: "A-0CNQR", purpose: "standard" }],
    source: "hour",
    reservationEvidence: null,
    issuedAt: "2026-11-01T10:00:00.000Z",
  },
  approval: {
    version: 1,
    eventId: "event-1",
    operatorId: { kind: "recovery-key", nodeId: "node-1", eventId: "event-1" },
    sourceId: '["conflict","sif-1","record-1","case-1"]',
    targetNodeId: "node-1",
    oldMachineOffline: true,
    oldMachineAbsent: false,
    noParallelRecovery: true,
    confirmedAt: "2026-11-01T10:00:00.000Z",
    incidentEvidence: "hour/event-1",
  },
};
export const committed = {
  activationEventId: "event-1",
  sifId: "sif-2",
  series: [{ id: "series-2", code: "A-0CNQR", purpose: "standard" }],
};
export function prepared(body: ConflictRequest): unknown {
  if (body.command.kind !== "prepare") throw new Error("Expected preparation");
  if (body.command.proposal.action === "clock-challenge")
    return {
      kind: "prepared",
      value: { id: "challenge-1", boxInstantMs: Date.now(), expiresInMs: 5000 },
    };
  if (body.command.proposal.action === "compare-clocks")
    return {
      kind: "prepared",
      value: {
        id: "comparison-1",
        clock: {
          usable: [],
          unavailable: [],
          secondClock: true,
          disagreement: false,
          releaseBlocked: false,
          rangeBlocked: false,
        },
      },
    };
  return {
    kind: "prepared",
    value: {
      status: "selected",
      identity: "0CNQR",
      input: {
        ...input,
        approval: {
          ...input.approval,
          eventId: body.eventId,
          operatorId: { kind: "recovery-key", nodeId: "node-1", eventId: body.eventId },
        },
        allocation: { ...input.allocation, allocationId: `hour/${body.eventId}` },
      },
    },
  };
}
