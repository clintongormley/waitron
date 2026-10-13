import "./errors.js";
import { isDeepStrictEqual } from "node:util";
import { and, eq, isNull, sql } from "drizzle-orm";
import { deployment, invoiceSeries, nodes, readTenant, type Transaction } from "@waitron/db";
import {
  readOperationAuthority,
  type ModuleOperationInput,
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
  readonly authority: AllocationContext["authority"];
  readonly priorActivation: AllocationContext["priorActivation"];
  readonly incidentEvidence: string;
  readonly requiredBases?: SeriesBases;
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
  const supplied = operation.input;
  if (typeof supplied !== "object" || supplied === null || Array.isArray(supplied))
    return refuse("malformed_allocation");
  const keys =
    binding.action === "promote"
      ? ["allocation", "approval", "reservationEventId"]
      : ["allocation", "approval"];
  const required = keys.slice(0, 2);
  if (
    !required.every((key) => Object.hasOwn(supplied, key)) ||
    Reflect.ownKeys(supplied).some((key) => typeof key !== "string" || !keys.includes(key))
  )
    return refuse("malformed_allocation");
  let input: { allocation: unknown; approval: unknown; reservationEventId?: unknown };
  try {
    input = structuredClone(supplied) as typeof input;
  } catch {
    return refuse("malformed_allocation");
  }
  const heldEvidence: AllocationOperationEvidence = {
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
