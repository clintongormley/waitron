import "./errors.js";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type ModuleOperationPreparation,
  type StandbyProvisioning,
} from "@waitron/module";
import type { AllocationEvidenceRequest } from "./allocation-operation.js";
import type { PaperReservationContext } from "./paper-evidence.js";
import { activatePreparedFiscalStandby } from "./allocated-lifecycle.js";
import { reserveHourDormant, establishHourDormant } from "./hour-dormant-standby.js";

export interface StandbyAllocationEvidence extends Pick<
  PaperReservationContext,
  | "allocationId"
  | "recipientVenueId"
  | "generationId"
  | "blockId"
  | "incidentEvidence"
  | "currentRegisterConfirmed"
  | "reservationConfirmed"
  | "currentEntryState"
> {
  readonly trust: unknown;
  readonly knownHistory?: unknown;
}
export type StandbyAllocationEvidenceSource = (
  request: AllocationEvidenceRequest,
) => Promise<(AllocationEvidenceRequest & { readonly evidence: StandbyAllocationEvidence }) | null>;

const prepared = new WeakMap<
  object,
  {
    readonly operation: ModuleOperationInput;
    readonly evidence: StandbyAllocationEvidence;
    readonly input: unknown;
  }
>();
function refuse(reason: string): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
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
function snapshot(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return refuse("malformed");
  }
}

export function createStandbyAllocationPreparation(
  source: StandbyAllocationEvidenceSource | undefined,
): ModuleOperationPreparation {
  return {
    async prepare(operation, run) {
      const held = { ...operation, binding: Object.freeze({ ...operation.binding }) };
      const operator = readOperationAuthority(held.authority, held.binding);
      if (
        operator === undefined ||
        typeof operator.operatorId !== "string" ||
        held.binding.module !== "fiscal-verifactu" ||
        !["reserve", "establish"].includes(held.binding.action)
      )
        return refuse("reauthentication_required");
      if (!exact(operation.input, ["block", "reservation"])) return refuse("malformed");
      const input = snapshot(operation.input);
      if (source === undefined) return refuse("outside_confirmation_missing");
      const receipt = await source(
        structuredClone({ binding: held.binding, operatorId: operator.operatorId }),
      );
      if (readOperationAuthority(held.authority, held.binding) === undefined)
        return refuse("reauthentication_required");
      if (
        receipt === null ||
        !exact(receipt.evidence, [
          "trust",
          "allocationId",
          "recipientVenueId",
          "generationId",
          "blockId",
          "incidentEvidence",
          "currentRegisterConfirmed",
          "reservationConfirmed",
          "currentEntryState",
          ...(Object.hasOwn(receipt.evidence, "knownHistory") ? ["knownHistory"] : []),
        ])
      )
        return refuse("outside_confirmation_missing");
      if (
        !isDeepStrictEqual(receipt.binding, held.binding) ||
        !isDeepStrictEqual(receipt.operatorId, operator.operatorId)
      )
        return refuse("event_mismatch");
      const evidence = snapshot(receipt.evidence) as StandbyAllocationEvidence;
      if (evidence.currentRegisterConfirmed !== true || evidence.reservationConfirmed !== true)
        return refuse("outside_confirmation_missing");
      if (evidence.currentEntryState !== "reserved") return refuse("reservation_not_current");
      const token = Object.freeze({});
      prepared.set(token, { operation: held, evidence, input });
      try {
        return await run(Object.freeze({ ...held, input: token }));
      } finally {
        prepared.delete(token);
      }
    },
  };
}

function refuseNonHourStandby(operation: ModuleOperationInput | undefined): never {
  if (
    operation === undefined ||
    readOperationAuthority(operation.authority, operation.binding) === undefined
  )
    return refuse("reauthentication_required");
  return refuse("outside_confirmation_missing");
}

export const ALLOCATED_FISCAL_STANDBY: StandbyProvisioning = {
  series: "on-activation",
  async reserve(tx, primary, standby, operation) {
    if (standby === undefined) return refuse("node_mismatch");
    const dormant = await reserveHourDormant(tx, primary, standby, operation);
    if (dormant !== undefined) return dormant;
    return refuseNonHourStandby(operation);
  },
  async establish(tx: Transaction, standby, state, operation) {
    if (await establishHourDormant(tx, standby, state, operation)) return;
    return refuseNonHourStandby(operation);
  },
  activate: activatePreparedFiscalStandby,
};
