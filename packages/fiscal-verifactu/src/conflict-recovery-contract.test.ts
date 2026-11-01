import { expect, it } from "vitest";
import {
  parseConflictActivation,
  parseConflictInput,
  parseConflictRequest,
  parseConflictResult,
} from "./conflict-recovery-contract.js";

const result = {
  activationEventId: "event-1",
  sifId: "sif-2",
  series: [{ id: "series-2", code: "A-0CNQR", purpose: "standard" }],
};
it("reads the complete committed activation without adding or losing facts", () => {
  expect(parseConflictActivation(result)).toEqual(result);
});
it.each([
  null,
  [],
  {},
  { ...result, unexpected: "do not disclose" },
  { ...result, sifId: undefined },
  { ...result, activationEventId: 12 },
  { ...result, series: null },
  { ...result, series: [{ ...result.series[0], unexpected: true }] },
  { ...result, series: [{ code: "A-0CNQR", purpose: "standard" }] },
  { ...result, series: [{ ...result.series[0], code: "" }] },
])("refuses missing, malformed or additional committed-result fields %j", (value) => {
  expect(parseConflictActivation(value)).toBeNull();
});

const input = {
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
    issuedAt: "2026-10-16T12:40:00.000Z",
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
    confirmedAt: "2026-10-16T12:40:00.000Z",
    incidentEvidence: "hour/event-1",
  },
};
const ref = { registroId: "record-1", caseId: "case-1", sifId: "sif-1" };
const active = {
  ...ref,
  installationIdentity: "0CNNW",
  invoiceIdentity: "A-0CNNW/1",
  observedAt: "2026-10-16T11:40:00.000Z",
  evidence: null,
  cause: "fiscal.huella_divergente",
  evidenceId: null,
};
const request = {
  recoveryKey: " paper-key ",
  eventId: "event-1",
  conflict: ref,
  oldMachineOffline: true,
  noParallelRecovery: true,
  command: { kind: "activate", input },
};
it("retains the exact key bytes and complete explicit activation body without sharing mutable input", () => {
  const parsed = parseConflictRequest(request);
  expect(parsed).toEqual(request);
  expect(parsed).not.toBe(request);
  expect(parsed!.command).not.toBe(request.command);
});
it("requires an exact conflict reference for preparation and activation but allows an initial status", () => {
  const without: Record<string, unknown> = { ...request };
  delete without.conflict;
  expect(parseConflictRequest(without)).toBeNull();
  expect(
    parseConflictRequest({
      ...without,
      command: { kind: "prepare", proposal: { action: "preview" } },
    }),
  ).toBeNull();
  expect(parseConflictRequest({ ...without, command: { kind: "status" } })).toEqual({
    ...without,
    command: { kind: "status" },
  });
});
it.each([
  { line: {}, csv: "CSV-1", comparison: { kind: "annulled" } },
  {
    line: {},
    csv: null,
    comparison: { kind: "lookup-mismatch", storedFingerprint: "hash-1", storedSystem: null },
  },
  {
    line: {},
    csv: null,
    comparison: {
      kind: "lookup-mismatch",
      storedFingerprint: "hash-1",
      storedSystem: { taxId: null, softwareId: "WT", installation: "0CNQR" },
    },
  },
])("preserves the authenticated retained comparison facts %j", (evidence) => {
  const value = {
    kind: "status",
    active: [{ ...active, evidence, evidenceId: "evidence-1" }],
    event: { kind: "none" },
  };
  expect(parseConflictResult(value)).toEqual(value);
});
it.each([
  { line: [], csv: null, comparison: { kind: "annulled" } },
  { line: {}, csv: 10, comparison: { kind: "annulled" } },
  {
    line: {},
    csv: null,
    comparison: { kind: "lookup-mismatch", storedFingerprint: 1, storedSystem: null },
  },
  {
    line: {},
    csv: null,
    comparison: {
      kind: "lookup-mismatch",
      storedFingerprint: "hash",
      storedSystem: { taxId: 1, softwareId: "WT", installation: null },
    },
  },
])("refuses malformed comparison facts %j", (evidence) => {
  expect(
    parseConflictResult({
      kind: "status",
      active: [{ ...active, evidence }],
      event: { kind: "none" },
    }),
  ).toBeNull();
});
it.each([
  {
    usable: [],
    unavailable: [],
    secondClock: "yes",
    disagreement: false,
    releaseBlocked: false,
    rangeBlocked: false,
  },
  {
    usable: [{ source: "box", lowerMs: 2, upperMs: 1 }],
    unavailable: [],
    secondClock: false,
    disagreement: false,
    releaseBlocked: false,
    rangeBlocked: false,
  },
  {
    usable: [],
    unavailable: [{ source: "internet", result: "unavailable", reason: "tls", private: true }],
    secondClock: false,
    disagreement: false,
    releaseBlocked: false,
    rangeBlocked: false,
  },
])("refuses malformed clock decisions %j", (clock) => {
  expect(parseConflictResult({ kind: "prepared", value: { id: "clock", clock } })).toBeNull();
});
it("retains timed unavailable observations with an explicitly unknown uncertainty", () => {
  const clock = {
    usable: [],
    unavailable: [
      {
        source: "internet",
        result: "unavailable",
        reason: "tls",
        wallStartedMs: 1,
        wallFinishedMs: 2,
        monotonicStartedMs: 3,
        monotonicFinishedMs: 4,
        uncertaintyMs: null,
      },
    ],
    secondClock: false,
    disagreement: false,
    releaseBlocked: false,
    rangeBlocked: false,
  };
  const value = { kind: "prepared", value: { id: "clock", clock } };
  expect(parseConflictResult(value)).toEqual(value);
});
it.each([
  { kind: "status" },
  { kind: "prepare", proposal: { action: "clock-challenge" } },
  { kind: "prepare", proposal: { action: "compare-clocks", browser: null } },
  {
    kind: "prepare",
    proposal: {
      action: "compare-clocks",
      browser: { challengeId: "clock-1", instantMs: 1792154400000 },
    },
  },
  { kind: "prepare", proposal: { action: "preview" } },
  { kind: "prepare", proposal: { action: "select", comparisonId: "comparison-1" } },
])("reads the exact supported command %j", (command) => {
  expect(parseConflictRequest({ ...request, command })).toEqual({ ...request, command });
});
it.each([
  { ...input, allocation: { ...input.allocation, extra: "secret" } },
  { ...input, allocation: { ...input.allocation, series: [] } },
  { ...input, allocation: { ...input.allocation, source: "paper" } },
  { ...input, allocation: { ...input.allocation, reservationEvidence: "secret" } },
  { ...input, allocation: { ...input.allocation, version: "1" } },
  { ...input, allocation: { ...input.allocation, environment: "dev" } },
  {
    ...input,
    allocation: { ...input.allocation, series: [{ code: "A", purpose: "standard", extra: true }] },
  },
  { ...input, approval: { ...input.approval, operatorId: "administrator" } },
  { ...input, approval: { ...input.approval, oldMachineOffline: null } },
  { ...input, approval: { ...input.approval, extra: true } },
  null,
])("refuses malformed, non-hour or non-key activation input %j", (value) => {
  expect(parseConflictInput(value)).toBeNull();
});
it.each([
  { kind: "committed", result },
  { kind: "status", active: [active], event: { kind: "none" } },
  { kind: "status", active: [], event: { kind: "restart-required" } },
  { kind: "status", active: [], event: { kind: "committed", result } },
  {
    kind: "prepared",
    value: { id: "challenge-1", boxInstantMs: 1792154400000, expiresInMs: 5000 },
  },
  {
    kind: "prepared",
    value: {
      id: "comparison-1",
      clock: {
        usable: [{ source: "box", lowerMs: 100, upperMs: 101 }],
        unavailable: [{ source: "internet", result: "unavailable", reason: "tls" }],
        secondClock: false,
        disagreement: false,
        releaseBlocked: false,
        rangeBlocked: false,
      },
    },
  },
  { kind: "prepared", value: { status: "waiting", targetMs: 1792154400000, remainingMs: 120000 } },
  { kind: "prepared", value: { status: "preview", identity: "0CNQR" } },
  { kind: "prepared", value: { status: "selected", identity: "0CNQR", input } },
])("reads the complete public result %j", (value) => {
  expect(parseConflictResult(value)).toEqual(value);
});
it.each([
  { kind: "prepared", value: { id: "challenge", boxInstantMs: Infinity, expiresInMs: 5000 } },
  { kind: "prepared", value: { status: "selected", identity: "0CNQR", input, authority: {} } },
  { kind: "prepared", value: { status: "waiting", targetMs: 1000, remainingMs: -1 } },
  { kind: "status", active: [active], event: { kind: "committed" } },
  {
    kind: "status",
    active: [{ ...active, evidence: { line: {}, csv: null, comparison: {} } }],
    event: { kind: "none" },
  },
  {
    kind: "status",
    active: [
      {
        ...active,
        evidence: { line: {}, csv: null, comparison: { kind: "annulled", recoveryKey: "secret" } },
      },
    ],
    event: { kind: "none" },
  },
  { kind: "status", active: [{ ...active, cause: "other" }], event: { kind: "none" } },
  { kind: "status", active: [active], event: { kind: "none" }, recoveryKey: "secret" },
])("refuses incomplete or private result fields %j", (value) => {
  expect(parseConflictResult(value)).toBeNull();
});
