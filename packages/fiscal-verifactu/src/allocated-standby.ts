import "./errors.js";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "@waitron/shared";
import { invoiceSeries, nodes, type Transaction } from "@waitron/db";
import { and, eq, isNull } from "drizzle-orm";
import { registroSif } from "./schema/sif.js";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type ModuleOperationPreparation,
  type StandbyProvisioning,
  type ProvisionedNode,
} from "@waitron/module";
import type { AllocationEvidenceRequest } from "./allocation-operation.js";
import type { PaperReservationContext } from "./paper-evidence.js";
import { validateStandbyAllocation, establishDormantAllocation } from "./standby-allocation.js";
import { readPreparedDeclaredStandby } from "./declared-paper-standby.js";
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

function readPrepared(
  operation: ModuleOperationInput | undefined,
  action: string,
  target: ProvisionedNode,
) {
  const declared = readPreparedDeclaredStandby(operation, action, target);
  if (declared !== undefined) return declared;
  if (
    operation === undefined ||
    readOperationAuthority(operation.authority, operation.binding) === undefined
  )
    return refuse("reauthentication_required");
  const token = operation.input;
  const held = typeof token === "object" && token !== null ? prepared.get(token) : undefined;
  if (held === undefined) return refuse("outside_confirmation_missing");
  if (
    operation.authority !== held.operation.authority ||
    !isDeepStrictEqual(operation.binding, held.operation.binding) ||
    operation.binding.action !== action
  )
    return refuse("event_mismatch");
  if (operation.binding.targetNodeId !== target.nodeId) return refuse("node_mismatch");
  const operator = readOperationAuthority(operation.authority, operation.binding)!;
  const context: PaperReservationContext = {
    ...held.evidence,
    taxpayerNif: "",
    softwareId: "",
    environment: "",
    eventId: operation.binding.eventId,
    operatorId: operator.operatorId,
    sourceId: operation.binding.sourceId,
    targetNodeId: target.nodeId,
    requiredBases: [],
  };
  return { ...held, context, check: () => readPrepared(operation, action, target) };
}

export const ALLOCATED_FISCAL_STANDBY: StandbyProvisioning = {
  series: "on-activation",
  async reserve(tx, primary, standby, operation) {
    if (standby === undefined) return refuse("node_mismatch");
    const dormant = await reserveHourDormant(tx, primary, standby, operation);
    if (dormant !== undefined) return dormant;
    const held = readPrepared(operation, "reserve", standby);
    if (
      primary.nodeId !== held.context.sourceId ||
      primary.locationId !== standby.locationId ||
      primary.nodeId === standby.nodeId
    )
      return refuse("node_mismatch");
    const [target] = await tx
      .select({ locationId: nodes.locationId })
      .from(nodes)
      .where(eq(nodes.id, standby.nodeId));
    if (target !== undefined && target.locationId !== standby.locationId)
      return refuse("node_mismatch");
    const [activeSif] = await tx
      .select({ id: registroSif.id })
      .from(registroSif)
      .where(and(eq(registroSif.nodeId, standby.nodeId), isNull(registroSif.revocadoEn)))
      .limit(1);
    const [activeSeries] = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, standby.nodeId), isNull(invoiceSeries.retiredAt)))
      .limit(1);
    if (activeSif !== undefined || activeSeries !== undefined)
      return refuse("standby_already_active");
    const validated = await validateStandbyAllocation(
      tx,
      primary,
      standby.nodeId,
      held.input,
      held.evidence.trust,
      held.context,
    );
    if (!validated.ok) return refuse(validated.reason);
    held.check();
    return { state: { version: 1, evidence: snapshot(held.input) } };
  },
  async establish(tx: Transaction, standby, state, operation) {
    if (await establishHourDormant(tx, standby, state, operation)) return;
    const held = readPrepared(operation, "establish", standby);
    if (
      !exact(state, ["version", "evidence"]) ||
      state.version !== 1 ||
      !isDeepStrictEqual(state.evidence, held.input)
    )
      return refuse("reservation_mismatch");
    const primary = {
      nodeId: held.context.sourceId as ProvisionedNode["nodeId"],
      locationId: standby.locationId,
    };
    await establishDormantAllocation(
      tx,
      primary,
      standby,
      held.input,
      held.evidence.trust,
      held.context,
    );
    held.check();
  },
  activate: activatePreparedFiscalStandby,
};
