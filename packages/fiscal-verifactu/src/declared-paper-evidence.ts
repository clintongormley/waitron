import "./errors.js";
import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import { AppError } from "@waitron/shared";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type OperationBinding,
  type OperationOperator,
} from "@waitron/module";
import type {
  AllocationContext,
  AllocationValidation,
  FiscalAllocation,
  RecoveryApproval,
} from "./allocation-envelope.js";
import { isAllocatedSeries } from "./allocation-identity.js";
import { parseAllocationOperator } from "./allocation-operator.js";
import {
  declaredHistoryBytes,
  parseDeclaredHistory,
  projectDeclaredHistory,
} from "./paper-register-history.js";
import { parsePaperAllocation } from "./paper-protocol.js";
import type {
  CurrentStatement,
  DeclaredConsumption,
  DeclaredRegisterHistory,
  DeclaredReservation,
  KnownRegisterEvidence,
} from "./paper-register-protocol.js";

export interface DeclaredPaperEvidence {
  readonly kind: "paper-declared-evidence";
  readonly version: 2;
  readonly historyDigest: string;
  readonly reservation: DeclaredReservation;
  readonly consumption: DeclaredConsumption;
  readonly reservationDigest: string;
  readonly consumptionDigest: string;
}
export interface DeclaredPaperConfirmation {
  readonly kind: "paper-declared-confirmation";
  readonly version: 2;
  readonly binding: OperationBinding;
  readonly operatorId: OperationOperator;
  readonly input: { readonly allocation: FiscalAllocation; readonly approval: RecoveryApproval };
  readonly history: DeclaredRegisterHistory;
  readonly known: KnownRegisterEvidence;
  readonly current: CurrentStatement;
  readonly recipientVenueId: string;
  readonly requiredBases: AllocationContext["requiredBases"];
  readonly priorActivation: AllocationContext["priorActivation"];
  readonly phase: "activate";
  readonly delivery: {
    readonly kept: true;
    readonly documentDigest: string;
    readonly historyDigest: string;
  };
}
export interface DeclaredAdmissionRequest {
  readonly operation: ModuleOperationInput;
  readonly facts: unknown;
}
const issued = new WeakMap<
  object,
  { readonly operation: ModuleOperationInput; readonly facts: DeclaredPaperConfirmation }
>();

function refuse(reason = "reservation_mismatch"): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
function record(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function exact(v: unknown, keys: readonly string[]): v is Record<string, unknown> {
  return (
    record(v) && Reflect.ownKeys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k))
  );
}
function text(v: unknown): v is string {
  return (
    typeof v === "string" && v.length > 0 && v.length <= 256 && v.trim() === v && !/\p{Cc}/u.test(v)
  );
}
function timestamp(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString() === v
  );
}
function hex(v: unknown): v is string {
  return typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
}
function digest(v: unknown): string {
  return createHash("sha256").update(declaredHistoryBytes(v)).digest("hex");
}
function freeze<T>(v: T): T {
  if (typeof v === "object" && v !== null) {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v;
}

// This is public structural inspection, never an operator or kept-document grant.
export function readDeclaredPaperInput(value: unknown) {
  if (
    !exact(value, ["allocation", "approval"]) ||
    !exact(value.allocation, [
      "version",
      "allocationId",
      "taxpayerNif",
      "softwareId",
      "environment",
      "installationIdentity",
      "series",
      "source",
      "issuedAt",
      "reservationEvidence",
    ])
  )
    refuse("malformed_allocation");
  const { reservationEvidence: proof, ...candidateValue } = value.allocation;
  const candidate = parsePaperAllocation(candidateValue);
  if (
    candidate === null ||
    !exact(proof, [
      "kind",
      "version",
      "historyDigest",
      "reservation",
      "consumption",
      "reservationDigest",
      "consumptionDigest",
    ]) ||
    proof.kind !== "paper-declared-evidence" ||
    proof.version !== 2 ||
    !hex(proof.historyDigest)
  )
    refuse();
  const reservation = proof.reservation,
    consumption = proof.consumption;
  if (
    !exact(reservation, ["kind", "allocation", "recipientVenueId", "binding", "reservedAt"]) ||
    reservation.kind !== "reserve" ||
    !equal(reservation.allocation, candidate) ||
    !text(reservation.recipientVenueId) ||
    !timestamp(reservation.reservedAt) ||
    !exact(reservation.binding, ["module", "action", "eventId", "sourceId", "targetNodeId"]) ||
    !Object.values(reservation.binding).every(text) ||
    !exact(consumption, [
      "kind",
      "allocationId",
      "reservationDigest",
      "eventId",
      "operatorId",
      "sourceId",
      "targetNodeId",
      "incidentEvidence",
      "consumedAt",
    ]) ||
    consumption.kind !== "consume" ||
    !timestamp(consumption.consumedAt) ||
    parseAllocationOperator(consumption.operatorId) === null ||
    ![
      consumption.eventId,
      consumption.sourceId,
      consumption.targetNodeId,
      consumption.incidentEvidence,
    ].every(text) ||
    consumption.allocationId !== candidate.allocationId ||
    consumption.reservationDigest !== digest(reservation) ||
    proof.reservationDigest !== digest(reservation) ||
    proof.consumptionDigest !== digest(consumption)
  )
    refuse();
  const approval = value.approval;
  if (
    !exact(approval, [
      "version",
      "eventId",
      "operatorId",
      "sourceId",
      "targetNodeId",
      "oldMachineAbsent",
      "oldMachineOffline",
      "noParallelRecovery",
      "confirmedAt",
      "incidentEvidence",
    ]) ||
    approval.version !== 1 ||
    !timestamp(approval.confirmedAt) ||
    ![approval.eventId, approval.sourceId, approval.targetNodeId, approval.incidentEvidence].every(
      text,
    ) ||
    parseAllocationOperator(approval.operatorId) === null ||
    ![approval.oldMachineAbsent, approval.oldMachineOffline, approval.noParallelRecovery].every(
      (x) => typeof x === "boolean",
    )
  )
    refuse("malformed_approval");
  for (const key of ["eventId", "operatorId", "sourceId", "targetNodeId", "incidentEvidence"])
    if (!equal(approval[key], consumption[key])) refuse("event_mismatch");
  for (const key of ["eventId", "sourceId", "targetNodeId"])
    if (!equal(reservation.binding[key], consumption[key])) refuse("event_mismatch");
  if (
    reservation.binding.module !== "fiscal-verifactu" ||
    (candidate.source === "initial-paper"
      ? reservation.binding.action !== "setup"
      : !["restore", "re-register", "promote"].includes(reservation.binding.action as string))
  )
    refuse("event_mismatch");
  return freeze(structuredClone(value) as unknown as DeclaredPaperConfirmation["input"]);
}

export function readDeclaredPaperConfirmation(value: unknown): DeclaredPaperConfirmation {
  if (
    !exact(value, [
      "kind",
      "version",
      "binding",
      "operatorId",
      "input",
      "history",
      "known",
      "current",
      "recipientVenueId",
      "requiredBases",
      "priorActivation",
      "phase",
      "delivery",
    ]) ||
    value.kind !== "paper-declared-confirmation" ||
    value.version !== 2 ||
    value.phase !== "activate" ||
    !["none", "committed", "uncertain"].includes(value.priorActivation as string) ||
    !text(value.recipientVenueId) ||
    !exact(value.current, [
      "currentRegisterConfirmed",
      "noParallelPaperAllocation",
      "confirmedAt",
    ]) ||
    value.current.currentRegisterConfirmed !== true ||
    value.current.noParallelPaperAllocation !== true ||
    !timestamp(value.current.confirmedAt) ||
    !exact(value.delivery, ["kept", "documentDigest", "historyDigest"]) ||
    value.delivery.kept !== true ||
    !hex(value.delivery.documentDigest) ||
    value.delivery.historyDigest !== digest(value.history)
  )
    refuse("outside_confirmation_missing");
  const input = readDeclaredPaperInput(value.input);
  const proof = input.allocation.reservationEvidence as DeclaredPaperEvidence;
  if (
    !equal(value.binding, proof.reservation.binding) ||
    !equal(value.operatorId, input.approval.operatorId) ||
    value.recipientVenueId !== proof.reservation.recipientVenueId
  )
    refuse("event_mismatch");
  if (
    !Array.isArray(value.requiredBases) ||
    !value.requiredBases.every(
      (x) => exact(x, ["code", "purpose"]) && text(x.code) && text(x.purpose),
    ) ||
    !isAllocatedSeries(
      input.allocation.series,
      input.allocation.installationIdentity,
      value.requiredBases as AllocationContext["requiredBases"],
    )
  )
    refuse("series_mismatch");
  const history = parseDeclaredHistory(value.history);
  const knownKeys = [
    "scope",
    "sHighWater",
    "pHighWater",
    "sBurnFloor",
    "pBurnFloor",
    "currentHead",
    "retainedHeads",
    "originals",
    "retiredBindings",
  ];
  if (
    !record(value.known) ||
    !exact(
      value.known,
      Object.hasOwn(value.known, "history") ? [...knownKeys, "history"] : knownKeys,
    )
  )
    refuse();
  const known = value.known as unknown as KnownRegisterEvidence;
  const projected = projectDeclaredHistory(history, known);
  const entry = projected.occupied.find(
    (x) => x.allocation.allocationId === input.allocation.allocationId,
  );
  const events = history.revisions.flatMap((x) => x.events);
  const serial = Number(input.allocation.installationIdentity.slice(1));
  if (
    proof.historyDigest !== digest(history) ||
    entry?.state !== "consumed" ||
    !equal(entry.allocation, proof.reservation.allocation) ||
    !equal(entry.binding, value.binding) ||
    entry.recipientVenueId !== value.recipientVenueId ||
    !events.some((x) => equal(x, proof.reservation)) ||
    !events.some((x) => equal(x, proof.consumption)) ||
    serial <=
      (input.allocation.source === "initial-paper" ? projected.sBurnFloor : projected.pBurnFloor) ||
    projected.retiredBindings.some((x) => equal(x, value.binding))
  )
    refuse();
  return freeze(
    structuredClone({ ...value, input, history }) as unknown as DeclaredPaperConfirmation,
  );
}

export async function withDeclaredPaperAdmission<T>(
  request: DeclaredAdmissionRequest,
  run: (token: object) => Promise<T>,
): Promise<T> {
  const operation = { ...request.operation, binding: { ...request.operation.binding } };
  const operator = readOperationAuthority(operation.authority, operation.binding);
  if (operator === undefined) refuse("reauthentication_required");
  const facts = readDeclaredPaperConfirmation(request.facts);
  if (
    !equal(facts.binding, operation.binding) ||
    !equal(facts.operatorId, operator.operatorId) ||
    !equal(facts.input, operation.input)
  )
    refuse("event_mismatch");
  const token = Object.freeze({});
  issued.set(token, { operation, facts });
  try {
    return await run(token);
  } finally {
    issued.delete(token);
  }
}

export function validateDeclaredPaperEvidence(
  input: unknown,
  context: AllocationContext,
  replay: boolean,
): AllocationValidation {
  if (context.authority.kind !== "paper-declared")
    return { ok: false, reason: "reservation_untrusted" };
  const held = issued.get(context.authority.token);
  if (held === undefined) return { ok: false, reason: "outside_confirmation_missing" };
  const { operation, facts } = held;
  const operator = readOperationAuthority(operation.authority, operation.binding);
  if (operator === undefined) return { ok: false, reason: "reauthentication_required" };
  if (
    !equal(input, facts.input.allocation) ||
    !equal(operator.operatorId, context.operatorId) ||
    !equal(facts.history.scope, {
      taxpayerNif: context.taxpayerNif,
      softwareId: context.softwareId,
      environment: context.environment,
    }) ||
    facts.binding.eventId !== context.eventId ||
    facts.binding.sourceId !== context.sourceId ||
    facts.binding.targetNodeId !== context.targetNodeId ||
    facts.input.approval.incidentEvidence !== context.incidentEvidence ||
    (facts.binding.action === "setup" ? "initial-setup" : "recovery") !== context.mode ||
    !isAllocatedSeries(
      facts.input.allocation.series,
      facts.input.allocation.installationIdentity,
      context.requiredBases,
    ) ||
    (replay
      ? facts.priorActivation !== "committed"
      : facts.priorActivation !== context.priorActivation)
  )
    return { ok: false, reason: "reservation_mismatch" };
  return freeze(
    structuredClone({
      ok: true,
      allocation: facts.input.allocation,
      approval: facts.input.approval,
    }),
  );
}
