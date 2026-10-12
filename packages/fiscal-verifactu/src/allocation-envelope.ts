import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { OperationOperator } from "@waitron/module";
import { parseAllocationOperator } from "./allocation-operator.js";
import {
  encodeEmergencyIdentity,
  installationChecksum,
  isAllocatedSeries,
  isInstallationIdentity,
  matchesInstallationChecksum,
} from "./allocation-identity.js";
import { verifyPaperEvidence, type PaperCustodianTrust } from "./paper-evidence.js";

export interface FiscalAllocation {
  readonly version: 1;
  readonly allocationId: string;
  readonly taxpayerNif: string;
  readonly softwareId: string;
  readonly environment: "preproduction" | "production";
  readonly installationIdentity: string;
  readonly series: readonly { readonly code: string; readonly purpose: string }[];
  readonly source: "initial-paper" | "paper" | "cloud" | "emergency";
  readonly reservationEvidence: unknown;
  readonly issuedAt: string;
}

export interface RecoveryApproval {
  readonly version: 1;
  readonly eventId: string;
  readonly operatorId: OperationOperator;
  readonly sourceId: string;
  readonly targetNodeId: string;
  readonly oldMachineOffline: boolean;
  readonly oldMachineAbsent: boolean;
  readonly noParallelRecovery: boolean;
  readonly confirmedAt: string;
  readonly incidentEvidence: string;
}

export interface EmergencyDraw {
  readonly identity: string;
  readonly checksum: string;
}

const emergencyDraws = new WeakSet<EmergencyDraw>();

export function drawEmergencyIdentity(): EmergencyDraw {
  const identity = encodeEmergencyIdentity(randomBytes(16));
  const draw = Object.freeze({ identity, checksum: installationChecksum(identity)! });
  emergencyDraws.add(draw);
  return draw;
}

export interface AllocationContext {
  readonly taxpayerNif: string;
  readonly softwareId: string;
  readonly environment: "preproduction" | "production";
  readonly mode: "initial-setup" | "recovery";
  readonly eventId: string;
  readonly operatorId: OperationOperator;
  readonly sourceId: string;
  readonly targetNodeId: string;
  readonly incidentEvidence: string;
  readonly requiredBases: readonly { readonly code: string; readonly purpose: string }[];
  readonly reauthentication: {
    readonly operatorId: OperationOperator;
    readonly eventId: string;
  } | null;
  readonly priorActivation: "none" | "committed" | "uncertain";
  readonly authority:
    | {
        readonly kind: "paper";
        readonly trust: PaperCustodianTrust | null;
        readonly recipientVenueId: string;
        readonly generationId: string;
        readonly blockId: string;
        readonly currentRegisterConfirmed: boolean;
        readonly consumptionConfirmed: boolean;
        readonly currentEntryState:
          "consumed-for-event" | "reserved" | "consumed-elsewhere" | "retired" | "abandoned";
      }
    | { readonly kind: "cloud" }
    | {
        readonly kind: "emergency";
        readonly draw: EmergencyDraw;
        readonly knownIdentities: readonly string[] | null;
        readonly incidentRecorded: boolean;
        readonly uncertaintyRecorded: boolean;
      };
}

export type AllocationRefusal =
  | "malformed_allocation"
  | "malformed_approval"
  | "taxpayer_mismatch"
  | "software_mismatch"
  | "environment_mismatch"
  | "source_mismatch"
  | "series_mismatch"
  | "event_mismatch"
  | "old_machine_active"
  | "old_machine_absence_unconfirmed"
  | "parallel_recovery"
  | "reauthentication_required"
  | "uncertain_prior_activation"
  | "prior_activation_requires_replay"
  | "reservation_missing"
  | "reservation_untrusted"
  | "outside_confirmation_missing"
  | "reservation_mismatch"
  | "reservation_not_consumed"
  | "allocation_consumed"
  | "allocation_retired"
  | "reservation_abandoned"
  | "emergency_draw_untrusted"
  | "checksum_invalid"
  | "identity_known"
  | "emergency_uncertainty_missing";

export type AllocationValidation =
  | {
      readonly ok: true;
      readonly allocation: FiscalAllocation;
      readonly approval: RecoveryApproval;
    }
  | { readonly ok: false; readonly reason: AllocationRefusal };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
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

function timestamp(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))
    return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function allocationShape(value: unknown): value is FiscalAllocation {
  return (
    record(value) &&
    exact(value, [
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
    ]) &&
    value.version === 1 &&
    text(value.allocationId) &&
    typeof value.taxpayerNif === "string" &&
    /^[A-Z0-9]{9}$/.test(value.taxpayerNif) &&
    typeof value.softwareId === "string" &&
    /^[A-Z0-9]{2}$/.test(value.softwareId) &&
    (value.environment === "preproduction" || value.environment === "production") &&
    isInstallationIdentity(value.installationIdentity) &&
    ["initial-paper", "paper", "cloud", "emergency"].includes(value.source as string) &&
    timestamp(value.issuedAt) &&
    Array.isArray(value.series) &&
    value.series.every(
      (item: unknown) =>
        record(item) &&
        exact(item, ["code", "purpose"]) &&
        typeof item.code === "string" &&
        typeof item.purpose === "string",
    )
  );
}

function approvalShape(value: unknown): value is RecoveryApproval {
  return (
    record(value) &&
    exact(value, [
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
    ]) &&
    value.version === 1 &&
    parseAllocationOperator(value.operatorId) !== null &&
    ["eventId", "sourceId", "targetNodeId", "incidentEvidence"].every((key) => text(value[key])) &&
    ["oldMachineOffline", "oldMachineAbsent", "noParallelRecovery"].every(
      (key) => typeof value[key] === "boolean",
    ) &&
    timestamp(value.confirmedAt)
  );
}

function paperEvidenceShape(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, ["block", "consumption"]) &&
    record(value.block) &&
    exact(value.block, ["payload", "signature"]) &&
    record(value.consumption) &&
    exact(value.consumption, ["payload", "signature"])
  );
}

function freeze(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

// Scope, authentication and outside facts must come from the host, never submitted module state.
export function validateAllocationEnvelope(
  input: unknown,
  permission: unknown,
  context: AllocationContext,
): AllocationValidation {
  return validateEnvelope(input, permission, context, false);
}

export function validateAllocationReplay(
  input: unknown,
  permission: unknown,
  context: AllocationContext,
  committed: { readonly allocation: FiscalAllocation; readonly approval: RecoveryApproval },
): AllocationValidation {
  if (
    !isDeepStrictEqual(input, committed.allocation) ||
    !isDeepStrictEqual(permission, committed.approval)
  )
    return { ok: false, reason: "event_mismatch" };
  return validateEnvelope(input, permission, { ...context, priorActivation: "none" }, true);
}

function validateEnvelope(
  input: unknown,
  permission: unknown,
  context: AllocationContext,
  replay: boolean,
): AllocationValidation {
  const refuse = (reason: AllocationRefusal): AllocationValidation => ({ ok: false, reason });
  if (!allocationShape(input)) return refuse("malformed_allocation");
  if (!approvalShape(permission)) return refuse("malformed_approval");
  if (input.taxpayerNif !== context.taxpayerNif) return refuse("taxpayer_mismatch");
  if (input.softwareId !== context.softwareId) return refuse("software_mismatch");
  if (input.environment !== context.environment) return refuse("environment_mismatch");
  const prefix = { "initial-paper": "S", paper: "P", cloud: "C", emergency: "E" }[input.source];
  if (
    !input.installationIdentity.startsWith(prefix) ||
    (input.source === "initial-paper" && context.mode !== "initial-setup") ||
    ((input.source === "paper" || input.source === "emergency") && context.mode !== "recovery")
  )
    return refuse("source_mismatch");
  if (
    !["eventId", "operatorId", "sourceId", "targetNodeId", "incidentEvidence"].every((key) =>
      isDeepStrictEqual(
        permission[key as keyof RecoveryApproval],
        context[key as keyof AllocationContext],
      ),
    )
  )
    return refuse("event_mismatch");
  if ((context.mode === "initial-setup") !== permission.oldMachineAbsent)
    return refuse("old_machine_absence_unconfirmed");
  if (context.mode === "recovery" && !permission.oldMachineOffline)
    return refuse("old_machine_active");
  if (!permission.noParallelRecovery) return refuse("parallel_recovery");
  if (
    !isDeepStrictEqual(context.reauthentication?.operatorId, permission.operatorId) ||
    context.reauthentication?.eventId !== permission.eventId ||
    (typeof permission.operatorId !== "string" &&
      (context.mode !== "recovery" ||
        permission.operatorId.nodeId !== context.targetNodeId ||
        permission.operatorId.eventId !== context.eventId))
  )
    return refuse("reauthentication_required");
  if (context.priorActivation === "uncertain") return refuse("uncertain_prior_activation");
  if (context.priorActivation === "committed") return refuse("prior_activation_requires_replay");
  if (input.source === "emergency" && context.authority.kind === "emergency") {
    if (
      (!replay && !emergencyDraws.has(context.authority.draw)) ||
      context.authority.draw.identity !== input.installationIdentity
    )
      return refuse("emergency_draw_untrusted");
    if (!record(input.reservationEvidence) || !exact(input.reservationEvidence, ["checksum"]))
      return refuse("reservation_missing");
    if (
      !matchesInstallationChecksum(input.installationIdentity, input.reservationEvidence.checksum)
    )
      return refuse("checksum_invalid");
    if (!context.authority.incidentRecorded) return refuse("outside_confirmation_missing");
    if (context.authority.knownIdentities === null && !context.authority.uncertaintyRecorded)
      return refuse("emergency_uncertainty_missing");
    if (!replay && context.authority.knownIdentities?.includes(input.installationIdentity))
      return refuse("identity_known");
  } else {
    if (
      (input.source !== "paper" && input.source !== "initial-paper") ||
      context.authority.kind !== "paper"
    )
      return refuse("reservation_untrusted");
    if (!paperEvidenceShape(input.reservationEvidence)) return refuse("reservation_missing");
    switch (context.authority.currentEntryState) {
      case "reserved":
        return refuse("reservation_not_consumed");
      case "consumed-elsewhere":
        return refuse("allocation_consumed");
      case "retired":
        return refuse("allocation_retired");
      case "abandoned":
        return refuse("reservation_abandoned");
      case "consumed-for-event":
        break;
      default:
        return refuse("outside_confirmation_missing");
    }
    const verified = verifyPaperEvidence(input.reservationEvidence, context.authority.trust, {
      ...context,
      ...context.authority,
      allocationId: input.allocationId,
    });
    if (!verified.ok) {
      if (verified.reason === "outside_confirmation_missing")
        return refuse("outside_confirmation_missing");
      if (verified.reason === "scope_mismatch") return refuse("reservation_mismatch");
      if (verified.reason === "series_mismatch") return refuse("series_mismatch");
      return refuse("reservation_untrusted");
    }
    if (
      verified.allocation.installationIdentity !== input.installationIdentity ||
      verified.allocation.source !== input.source ||
      verified.allocation.issuedAt !== input.issuedAt
    )
      return refuse("reservation_mismatch");
  }
  if (!isAllocatedSeries(input.series, input.installationIdentity, context.requiredBases))
    return refuse("series_mismatch");
  const result = structuredClone({ ok: true as const, allocation: input, approval: permission });
  freeze(result);
  return result;
}
