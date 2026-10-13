import "./errors.js";
import { isDeepStrictEqual } from "node:util";
import { and, eq, isNull, sql } from "drizzle-orm";
import { deployment, invoiceSeries, nodes, readTenant, type Transaction } from "@waitron/db";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type OperationBinding,
  type OperationOperator,
  type ProvisionedNode,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import type { AllocationContext } from "./allocation-envelope.js";
import {
  activateAuthenticatedAllocation,
  activateAuthenticatedDormantAllocation,
} from "./allocation.js";
import { WAITRON_ID_SISTEMA } from "./provisioning.js";
import type { ActivationResult } from "./schema/allocations.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";

type SeriesBases = readonly { readonly code: string; readonly purpose: string }[];

export async function readModuleAllocationSeries(
  tx: Transaction,
  node: ProvisionedNode,
  requestedBases: SeriesBases,
): Promise<ActivationResult["series"]> {
  const bases = requestedBases.map((base) => ({ code: base.code, purpose: base.purpose }));
  const refuse = (reason: string): never => {
    throw new AppError("sif.allocation_invalid", { reason });
  };
  const [storedNode] = await tx.select().from(nodes).where(eq(nodes.id, node.nodeId));
  if (storedNode?.locationId !== node.locationId) return refuse("node_mismatch");
  const [sif] = await tx
    .select({
      id: registroSif.id,
      taxpayerNif: registroSif.nif,
      softwareId: registroSif.idSistemaInformatico,
      identity: sql<string>`${registroSif.numeroInstalacion}`,
    })
    .from(registroSif)
    .where(and(eq(registroSif.nodeId, node.nodeId), isNull(registroSif.revocadoEn)));
  if (sif === undefined) return refuse("activation_superseded");
  const [retained] = await tx
    .select()
    .from(fiscalAllocations)
    .where(and(eq(fiscalAllocations.nodeId, node.nodeId), eq(fiscalAllocations.sifId, sif.id)));
  const tenant = await readTenant(tx);
  const [stamp] = await tx.select().from(deployment).where(eq(deployment.id, 1));
  if (
    retained === undefined ||
    retained.taxpayerNif !== tenant?.taxId ||
    retained.taxpayerNif !== sif.taxpayerNif ||
    retained.softwareId !== sif.softwareId ||
    retained.installationIdentity !== sif.identity ||
    retained.environment !== stamp?.environment
  )
    return refuse("activation_superseded");
  const ordered = (values: SeriesBases) =>
    values
      .map(({ code, purpose }) => [code, purpose])
      .sort((left, right) => {
        const a = JSON.stringify(left);
        const b = JSON.stringify(right);
        return a < b ? -1 : a > b ? 1 : 0;
      });
  if (!isDeepStrictEqual(ordered(bases), ordered(retained.bases))) return refuse("series_mismatch");
  const active = await tx
    .select({ id: invoiceSeries.id, code: invoiceSeries.code, purpose: invoiceSeries.purpose })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.nodeId, node.nodeId), isNull(invoiceSeries.retiredAt)))
    .orderBy(invoiceSeries.code);
  if (!isDeepStrictEqual(active, retained.result.series)) return refuse("activation_superseded");
  return retained.result.series;
}

// The host must collect outside confirmations and enrolled trust independently of submitted input.
export interface AllocationOperationEvidence {
  readonly allocationId?: string;
  readonly authority: AllocationContext["authority"];
  readonly priorActivation: AllocationContext["priorActivation"];
  readonly incidentEvidence: string;
  readonly requiredBases?: SeriesBases;
}

export interface AllocationEvidenceRequest {
  readonly binding: OperationBinding;
  readonly operatorId: OperationOperator;
}

export type AllocationEvidenceSource = (
  request: AllocationEvidenceRequest,
) => Promise<
  (AllocationEvidenceRequest & { readonly evidence: AllocationOperationEvidence }) | null
>;

export async function withCollectedModuleAllocation<T>(
  operation: ModuleOperationInput,
  source: AllocationEvidenceSource | undefined,
  run: (
    activate: (tx: Transaction, node: ProvisionedNode) => Promise<ActivationResult>,
  ) => Promise<T>,
): Promise<T> {
  const refuse = (reason: string): never => {
    throw new AppError("sif.allocation_invalid", { reason });
  };
  const binding = { ...operation.binding };
  const authority = operation.authority;
  const operator = readOperationAuthority(authority, binding);
  if (
    operator === undefined ||
    binding.module !== "fiscal-verifactu" ||
    !["setup", "restore", "re-register", "promote"].includes(binding.action)
  )
    return refuse("reauthentication_required");
  const input = snapshotAllocationInput(binding, operation.input);
  if (source === undefined) return refuse("outside_confirmation_missing");
  const receipt = await source(structuredClone({ binding, operatorId: operator.operatorId }));
  if (readOperationAuthority(authority, binding) === undefined)
    return refuse("reauthentication_required");
  if (receipt == null || !Object.hasOwn(receipt, "evidence") || receipt.evidence == null)
    return refuse("outside_confirmation_missing");
  if (
    !isDeepStrictEqual(receipt.binding, binding) ||
    !isDeepStrictEqual(receipt.operatorId, operator.operatorId)
  )
    return refuse("event_mismatch");
  const evidence = snapshotAllocationEvidence(receipt.evidence);
  const heldOperation = { binding, authority, input };
  let active = true;
  const authorise = (): void => {
    if (!active || readOperationAuthority(authority, binding) === undefined)
      refuse("reauthentication_required");
  };
  try {
    return await run(async (tx, node) => {
      authorise();
      const result = await activateModuleAllocation(tx, node, heldOperation, evidence);
      authorise();
      return result;
    });
  } finally {
    active = false;
  }
}

function snapshotAllocationEvidence(evidence: AllocationOperationEvidence) {
  return {
    ...evidence,
    requiredBases: evidence.requiredBases?.map((base) => ({ ...base })),
    authority:
      evidence.authority.kind === "emergency"
        ? {
            ...evidence.authority,
            knownIdentities:
              evidence.authority.knownIdentities === null
                ? null
                : [...evidence.authority.knownIdentities],
          }
        : structuredClone(evidence.authority),
  };
}

function snapshotAllocationInput(binding: OperationBinding, supplied: unknown) {
  const refuse = (): never => {
    throw new AppError("sif.allocation_invalid", { reason: "malformed_allocation" });
  };
  if (typeof supplied !== "object" || supplied === null || Array.isArray(supplied)) return refuse();
  const keys =
    binding.action === "promote"
      ? ["allocation", "approval", "reservationEventId"]
      : ["allocation", "approval"];
  // Check every own field before cloning can discard symbols and non-enumerable fields.
  if (
    !keys.slice(0, 2).every((key) => Object.hasOwn(supplied, key)) ||
    Reflect.ownKeys(supplied).some((key) => typeof key !== "string" || !keys.includes(key))
  )
    return refuse();
  try {
    return structuredClone(supplied) as {
      allocation: unknown;
      approval: unknown;
      reservationEventId?: unknown;
    };
  } catch {
    return refuse();
  }
}

export async function activateModuleAllocation(
  tx: Transaction,
  node: ProvisionedNode,
  operation: ModuleOperationInput,
  evidence: AllocationOperationEvidence,
): Promise<ActivationResult> {
  const binding = { ...operation.binding };
  const authority = operation.authority;
  const operator = readOperationAuthority(authority, binding);
  if (operator === undefined)
    throw new AppError("sif.allocation_invalid", { reason: "reauthentication_required" });
  const refuse = (reason: string): never => {
    throw new AppError("sif.allocation_invalid", { reason });
  };
  const input = snapshotAllocationInput(binding, operation.input);
  const heldEvidence = snapshotAllocationEvidence(evidence);
  if (
    heldEvidence.allocationId !== undefined &&
    (typeof input.allocation !== "object" ||
      input.allocation === null ||
      !Object.hasOwn(input.allocation, "allocationId") ||
      (input.allocation as Record<string, unknown>).allocationId !== heldEvidence.allocationId)
  )
    return refuse("reservation_mismatch");
  if (
    binding.action === "promote" &&
    (typeof input.reservationEventId !== "string" || input.reservationEventId.length === 0)
  )
    return refuse("reservation_missing");
  const tenant = await readTenant(tx);
  const [stamp] = await tx.select().from(deployment).where(eq(deployment.id, 1));
  const context: AllocationContext = {
    taxpayerNif: tenant?.taxId ?? "",
    softwareId: WAITRON_ID_SISTEMA,
    environment: stamp?.environment === "production" ? "production" : "preproduction",
    mode: binding.action === "setup" ? "initial-setup" : "recovery",
    eventId: binding.eventId,
    sourceId: binding.sourceId,
    targetNodeId: node.nodeId,
    operatorId: operator.operatorId,
    incidentEvidence: heldEvidence.incidentEvidence,
    requiredBases: heldEvidence.requiredBases ?? [],
    reauthentication: null,
    priorActivation: heldEvidence.priorActivation,
    authority: heldEvidence.authority,
  };
  if (binding.action === "promote")
    return activateAuthenticatedDormantAllocation(
      tx,
      node,
      input.reservationEventId as string,
      input.allocation,
      input.approval,
      context,
      authority,
    );
  return activateAuthenticatedAllocation(
    tx,
    node,
    input.allocation,
    input.approval,
    context,
    authority,
    binding.action,
  );
}
