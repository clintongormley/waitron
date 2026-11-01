import type { FiscalAllocation, RecoveryApproval } from "./allocation-envelope.js";
import type { ActivationResult } from "./schema/allocations.js";
import type { ActiveConflict, ConflictRef } from "./conflict-evidence.js";
import type { HourClockDecision } from "./hour-clock.js";
import type { SetupBrowserClockSample } from "./hour-setup-clock.js";
import { parseAllocationOperator } from "./allocation-operator.js";

export interface ConflictAllocationInput {
  allocation: FiscalAllocation;
  approval: RecoveryApproval;
}

export type ConflictProposal =
  | { action: "clock-challenge" }
  | { action: "compare-clocks"; browser: SetupBrowserClockSample | null }
  | { action: "preview" }
  | { action: "select"; comparisonId: string };
export type ConflictCommand =
  | { kind: "status" }
  | { kind: "prepare"; proposal: ConflictProposal }
  | { kind: "activate"; input: ConflictAllocationInput };
export interface ConflictRequest {
  recoveryKey: string;
  eventId: string;
  conflict?: ConflictRef;
  oldMachineOffline: boolean;
  noParallelRecovery: boolean;
  command: ConflictCommand;
}
export type ConflictPreparationResult =
  | { id: string; boxInstantMs: number; expiresInMs: number }
  | { id: string; clock: HourClockDecision }
  | { status: "waiting"; targetMs: number; remainingMs: number }
  | { status: "preview"; identity: string }
  | { status: "selected"; identity: string; input: ConflictAllocationInput };
export type ConflictEvent =
  { kind: "none" } | { kind: "restart-required" } | { kind: "committed"; result: ActivationResult };
export type ConflictResult =
  | { kind: "status"; active: readonly ActiveConflict[]; event: ConflictEvent }
  | { kind: "prepared"; value: ConflictPreparationResult }
  | { kind: "committed"; result: ActivationResult };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    record(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function series(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (row: unknown) => exact(row, ["code", "purpose"]) && text(row.code) && text(row.purpose),
    )
  );
}
export function parseConflictInput(value: unknown): ConflictAllocationInput | null {
  if (!exact(value, ["allocation", "approval"])) return null;
  const a = value.allocation;
  const p = value.approval;
  if (
    !exact(a, [
      "version",
      "allocationId",
      "taxpayerNif",
      "softwareId",
      "environment",
      "installationIdentity",
      "series",
      "source",
      "reservationEvidence",
      "issuedAt",
    ]) ||
    a.version !== 1 ||
    !["allocationId", "taxpayerNif", "softwareId", "installationIdentity", "issuedAt"].every(
      (key) => text(a[key]),
    ) ||
    !["production", "preproduction"].includes(a.environment as string) ||
    a.source !== "hour" ||
    a.reservationEvidence !== null ||
    !series(a.series) ||
    !exact(p, [
      "version",
      "eventId",
      "operatorId",
      "sourceId",
      "targetNodeId",
      "oldMachineOffline",
      "oldMachineAbsent",
      "noParallelRecovery",
      "confirmedAt",
      "incidentEvidence",
    ]) ||
    p.version !== 1 ||
    !["eventId", "sourceId", "targetNodeId", "confirmedAt", "incidentEvidence"].every(
      (key) =>
        text(p[key]) ||
        (key === "sourceId" &&
          typeof p[key] === "string" &&
          p[key].length <= 1024 &&
          p[key].length > 0),
    ) ||
    !record(p.operatorId) ||
    parseAllocationOperator(p.operatorId) === null ||
    typeof p.oldMachineOffline !== "boolean" ||
    typeof p.oldMachineAbsent !== "boolean" ||
    typeof p.noParallelRecovery !== "boolean"
  )
    return null;
  return structuredClone(value) as unknown as ConflictAllocationInput;
}
function validRef(value: unknown): value is ConflictRef {
  return (
    exact(value, ["registroId", "caseId", "sifId"]) &&
    [value.registroId, value.caseId, value.sifId].every(text)
  );
}
function proposal(value: unknown): value is ConflictProposal {
  if (exact(value, ["action"]))
    return value.action === "clock-challenge" || value.action === "preview";
  if (exact(value, ["action", "comparisonId"]))
    return value.action === "select" && text(value.comparisonId);
  return (
    exact(value, ["action", "browser"]) &&
    value.action === "compare-clocks" &&
    (value.browser === null ||
      (exact(value.browser, ["challengeId", "instantMs"]) &&
        text(value.browser.challengeId) &&
        Number.isSafeInteger(value.browser.instantMs)))
  );
}
export function parseConflictRequest(value: unknown): ConflictRequest | null {
  const keys = ["recoveryKey", "eventId", "oldMachineOffline", "noParallelRecovery", "command"];
  if (record(value) && Object.hasOwn(value, "conflict")) keys.push("conflict");
  if (
    !exact(value, keys) ||
    typeof value.recoveryKey !== "string" ||
    value.recoveryKey.length > 4096 ||
    !text(value.eventId) ||
    typeof value.oldMachineOffline !== "boolean" ||
    typeof value.noParallelRecovery !== "boolean" ||
    (Object.hasOwn(value, "conflict") && !validRef(value.conflict))
  )
    return null;
  const command = value.command;
  if (
    !(exact(command, ["kind"]) && command.kind === "status") &&
    !(
      exact(command, ["kind", "proposal"]) &&
      command.kind === "prepare" &&
      proposal(command.proposal)
    ) &&
    !(
      exact(command, ["kind", "input"]) &&
      command.kind === "activate" &&
      parseConflictInput(command.input) !== null
    )
  )
    return null;
  if ((command as { kind: string }).kind !== "status" && value.conflict === undefined) return null;
  return structuredClone(value) as unknown as ConflictRequest;
}
function validClock(value: unknown): value is HourClockDecision {
  if (
    !exact(value, [
      "usable",
      "unavailable",
      "secondClock",
      "disagreement",
      "releaseBlocked",
      "rangeBlocked",
    ]) ||
    !["secondClock", "disagreement", "releaseBlocked", "rangeBlocked"].every(
      (key) => typeof value[key] === "boolean",
    )
  )
    return false;
  const source = (v: unknown) => v === "box" || v === "browser" || v === "internet";
  return (
    Array.isArray(value.usable) &&
    value.usable.every(
      (v: unknown) =>
        exact(v, ["source", "lowerMs", "upperMs"]) &&
        source(v.source) &&
        finite(v.lowerMs) &&
        finite(v.upperMs) &&
        v.lowerMs <= v.upperMs,
    ) &&
    Array.isArray(value.unavailable) &&
    value.unavailable.every(
      (v: unknown) =>
        record(v) &&
        source(v.source) &&
        v.result === "unavailable" &&
        text(v.reason) &&
        Object.keys(v).every((key) =>
          [
            "source",
            "result",
            "reason",
            "wallStartedMs",
            "wallFinishedMs",
            "monotonicStartedMs",
            "monotonicFinishedMs",
            "uncertaintyMs",
          ].includes(key),
        ) &&
        Object.entries(v).every(
          ([key, item]) =>
            ["source", "result", "reason"].includes(key) ||
            finite(item) ||
            (key === "uncertaintyMs" && item === null),
        ),
    )
  );
}
export function parseConflictPreparation(value: unknown): ConflictPreparationResult | null {
  if (
    (exact(value, ["id", "boxInstantMs", "expiresInMs"]) &&
      text(value.id) &&
      finite(value.boxInstantMs) &&
      finite(value.expiresInMs) &&
      value.expiresInMs > 0) ||
    (exact(value, ["id", "clock"]) && text(value.id) && validClock(value.clock)) ||
    (exact(value, ["status", "targetMs", "remainingMs"]) &&
      value.status === "waiting" &&
      finite(value.targetMs) &&
      finite(value.remainingMs) &&
      value.remainingMs >= 0) ||
    (exact(value, ["status", "identity"]) && value.status === "preview" && text(value.identity)) ||
    (exact(value, ["status", "identity", "input"]) &&
      value.status === "selected" &&
      text(value.identity) &&
      parseConflictInput(value.input) !== null)
  )
    return structuredClone(value) as unknown as ConflictPreparationResult;
  return null;
}
export function parseConflictResult(value: unknown): ConflictResult | null {
  if (
    exact(value, ["kind", "result"]) &&
    value.kind === "committed" &&
    parseConflictActivation(value.result) !== null
  )
    return structuredClone(value) as unknown as ConflictResult;
  if (
    exact(value, ["kind", "value"]) &&
    value.kind === "prepared" &&
    parseConflictPreparation(value.value) !== null
  )
    return structuredClone(value) as unknown as ConflictResult;
  if (
    !exact(value, ["kind", "active", "event"]) ||
    value.kind !== "status" ||
    !Array.isArray(value.active)
  )
    return null;
  const event = value.event;
  if (
    !(exact(event, ["kind"]) && (event.kind === "none" || event.kind === "restart-required")) &&
    !(
      exact(event, ["kind", "result"]) &&
      event.kind === "committed" &&
      parseConflictActivation(event.result) !== null
    )
  )
    return null;
  if (
    !value.active.every(
      (row: unknown) =>
        exact(row, [
          "registroId",
          "caseId",
          "sifId",
          "installationIdentity",
          "invoiceIdentity",
          "observedAt",
          "evidence",
          "cause",
          "evidenceId",
        ]) &&
        [
          row.registroId,
          row.caseId,
          row.sifId,
          row.installationIdentity,
          row.invoiceIdentity,
          row.observedAt,
        ].every(text) &&
        (row.cause === "fiscal.huella_divergente" || row.cause === "fiscal.duplicado_anulado") &&
        (row.evidenceId === null || text(row.evidenceId)) &&
        (row.evidence === null || validEvidence(row.evidence)),
    )
  )
    return null;
  return structuredClone(value) as unknown as ConflictResult;
}
function validEvidence(value: unknown): boolean {
  if (
    !exact(value, ["line", "csv", "comparison"]) ||
    !record(value.line) ||
    (value.csv !== null && typeof value.csv !== "string")
  )
    return false;
  const c = value.comparison;
  if (exact(c, ["kind"]) && c.kind === "annulled") return true;
  return (
    exact(c, ["kind", "storedFingerprint", "storedSystem"]) &&
    c.kind === "lookup-mismatch" &&
    typeof c.storedFingerprint === "string" &&
    (c.storedSystem === null ||
      (exact(c.storedSystem, ["taxId", "softwareId", "installation"]) &&
        Object.values(c.storedSystem).every((v) => v === null || typeof v === "string")))
  );
}

export function parseConflictActivation(value: unknown): ActivationResult | null {
  const exact = (item: unknown, keys: readonly string[]): item is Record<string, unknown> =>
    typeof item === "object" &&
    item !== null &&
    !Array.isArray(item) &&
    Reflect.ownKeys(item).length === keys.length &&
    keys.every((key) => Object.hasOwn(item, key));
  const text = (item: unknown): item is string =>
    typeof item === "string" && item.trim().length > 0 && item.length <= 256;
  if (
    !exact(value, ["activationEventId", "sifId", "series"]) ||
    !text(value.activationEventId) ||
    !text(value.sifId) ||
    !Array.isArray(value.series) ||
    !value.series.every(
      (entry: unknown) =>
        exact(entry, ["id", "code", "purpose"]) &&
        text(entry.id) &&
        text(entry.code) &&
        text(entry.purpose),
    )
  )
    return null;
  return structuredClone(value) as unknown as ActivationResult;
}
