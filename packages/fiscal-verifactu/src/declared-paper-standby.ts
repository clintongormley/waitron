import "./errors.js";
import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import { AppError } from "@waitron/shared";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type ModuleOperationPreparation,
  type ProvisionedNode,
} from "@waitron/module";
import { isAllocatedSeries } from "./allocation-identity.js";
import {
  declaredHistoryBytes,
  parseDeclaredHistory,
  projectDeclaredHistory,
  assertPaperFloorAllows,
} from "./paper-register-history.js";
import type { DeclaredReservation, KnownRegisterEvidence } from "./paper-register-protocol.js";
import type { PaperAllocation } from "./paper-protocol.js";
import type { AllocationEvidenceRequest } from "./allocation-operation.js";
interface StandbyInput {
  readonly kind: "paper-declared-reservation";
  readonly version: 2;
  readonly reservation: DeclaredReservation;
  readonly reservationDigest: string;
  readonly historyDigest: string;
}
export interface DeclaredStandbyContext {
  readonly kind: "paper-declared-standby";
  readonly token: object;
  readonly taxpayerNif: string;
  readonly softwareId: string;
  readonly environment: string;
  readonly eventId: string;
  readonly sourceId: string;
  readonly targetNodeId: string;
  readonly requiredBases: readonly { readonly code: string; readonly purpose: string }[];
}
const prepared = new WeakMap<object, { operation: ModuleOperationInput; input: StandbyInput }>();
function refuse(reason = "reservation_mismatch"): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
function exact(v: unknown, keys: readonly string[]): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Reflect.ownKeys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k))
  );
}
const digest = (v: unknown) => createHash("sha256").update(declaredHistoryBytes(v)).digest("hex");
const hex = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function readDeclaredStandbyInput(value: unknown): StandbyInput {
  if (
    !exact(value, ["kind", "version", "reservation", "reservationDigest", "historyDigest"]) ||
    value.kind !== "paper-declared-reservation" ||
    value.version !== 2 ||
    !hex(value.historyDigest) ||
    value.reservationDigest !== digest(value.reservation)
  )
    refuse();
  return structuredClone(value) as unknown as StandbyInput;
}
export function createDeclaredPaperStandbyPreparation(
  source: (request: AllocationEvidenceRequest) => Promise<unknown>,
): ModuleOperationPreparation {
  return {
    async prepare(operation, run) {
      const binding = Object.freeze({ ...operation.binding }),
        authority = operation.authority,
        operator = readOperationAuthority(authority, binding);
      const heldOperation = { ...operation, binding, authority };
      if (
        operator === undefined ||
        typeof operator.operatorId !== "string" ||
        binding.module !== "fiscal-verifactu" ||
        !["reserve", "establish"].includes(binding.action)
      )
        refuse("reauthentication_required");
      const input = readDeclaredStandbyInput(operation.input),
        facts = await source(structuredClone({ binding, operatorId: operator.operatorId }));
      if (
        !exact(facts, [
          "kind",
          "version",
          "binding",
          "operatorId",
          "input",
          "history",
          "known",
          "current",
          "delivery",
        ]) ||
        facts.kind !== "paper-declared-standby-confirmation" ||
        facts.version !== 2 ||
        !equal(facts.binding, binding) ||
        !equal(facts.operatorId, operator.operatorId) ||
        !equal(facts.input, input) ||
        !exact(facts.current, [
          "currentRegisterConfirmed",
          "noParallelPaperAllocation",
          "confirmedAt",
        ]) ||
        facts.current.currentRegisterConfirmed !== true ||
        facts.current.noParallelPaperAllocation !== true ||
        typeof facts.current.confirmedAt !== "string" ||
        !Number.isFinite(Date.parse(facts.current.confirmedAt)) ||
        new Date(facts.current.confirmedAt).toISOString() !== facts.current.confirmedAt ||
        !exact(facts.delivery, ["kept", "documentDigest", "historyDigest"]) ||
        facts.delivery.kept !== true ||
        !hex(facts.delivery.documentDigest) ||
        facts.delivery.historyDigest !== input.historyDigest
      )
        refuse();
      const history = parseDeclaredHistory(facts.history);
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
        typeof facts.known !== "object" ||
        facts.known === null ||
        !exact(
          facts.known,
          Object.hasOwn(facts.known, "history") ? [...knownKeys, "history"] : knownKeys,
        )
      )
        refuse();
      const projection = projectDeclaredHistory(
        history,
        facts.known as unknown as KnownRegisterEvidence,
      );
      if (
        digest(history) !== input.historyDigest ||
        !history.revisions.some((r) => r.events.some((e) => equal(e, input.reservation)))
      )
        refuse();
      assertPaperFloorAllows(projection, input.reservation.allocation, "recovery");
      const entry = projection.occupied.find(
        (e) => e.allocation.allocationId === input.reservation.allocation.allocationId,
      );
      if (
        input.reservation.binding.action !== "reserve" ||
        !equal(input.reservation.binding, { ...binding, action: "reserve" }) ||
        entry?.state !== "reserved" ||
        !equal(entry.binding, input.reservation.binding) ||
        projection.retiredBindings.some((b) => equal(b, input.reservation.binding))
      )
        refuse();
      if (readOperationAuthority(authority, binding) === undefined)
        refuse("reauthentication_required");
      const token = Object.freeze({});
      prepared.set(token, { operation: heldOperation, input });
      try {
        return await run(Object.freeze({ ...heldOperation, input: token }));
      } finally {
        prepared.delete(token);
      }
    },
  };
}
export function readPreparedDeclaredStandby(
  operation: ModuleOperationInput | undefined,
  action: string,
  target: ProvisionedNode,
) {
  const token = operation?.input,
    held = typeof token === "object" && token !== null ? prepared.get(token) : undefined;
  if (held === undefined) return undefined;
  if (
    operation === undefined ||
    readOperationAuthority(operation.authority, operation.binding) === undefined
  )
    refuse("reauthentication_required");
  if (
    operation.authority !== held.operation.authority ||
    !equal(operation.binding, held.operation.binding) ||
    operation.binding.action !== action
  )
    refuse("event_mismatch");
  if (operation.binding.targetNodeId !== target.nodeId) refuse("node_mismatch");
  const context: DeclaredStandbyContext = {
    kind: "paper-declared-standby",
    token: token as object,
    taxpayerNif: "",
    softwareId: "",
    environment: "",
    eventId: operation.binding.eventId,
    sourceId: operation.binding.sourceId,
    targetNodeId: operation.binding.targetNodeId,
    requiredBases: [],
  };
  return {
    input: held.input,
    evidence: { trust: token },
    context,
    check: () => readPreparedDeclaredStandby(operation, action, target),
  };
}
export function verifyDeclaredStandbyEvidence(
  input: unknown,
  trust: unknown,
  context: DeclaredStandbyContext,
):
  | { ok: true; allocation: PaperAllocation; reservation: { eventId: string } }
  | { ok: false; reason: "reservation_mismatch" | "outside_confirmation_missing" } {
  const held = prepared.get(context.token);
  if (
    held === undefined ||
    trust !== context.token ||
    readOperationAuthority(held.operation.authority, held.operation.binding) === undefined
  )
    return { ok: false, reason: "outside_confirmation_missing" };
  const a = held.input.reservation.allocation;
  if (
    !equal(input, held.input) ||
    a.taxpayerNif !== context.taxpayerNif ||
    a.softwareId !== context.softwareId ||
    a.environment !== context.environment ||
    context.eventId !== held.operation.binding.eventId ||
    context.sourceId !== held.operation.binding.sourceId ||
    context.targetNodeId !== held.operation.binding.targetNodeId ||
    !isAllocatedSeries(a.series, a.installationIdentity, context.requiredBases)
  )
    return { ok: false, reason: "reservation_mismatch" };
  return {
    ok: true,
    allocation: structuredClone(a),
    reservation: { eventId: held.input.reservation.binding.eventId },
  };
}
