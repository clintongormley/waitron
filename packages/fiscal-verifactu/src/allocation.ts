import "./errors.js";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "@waitron/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  deployment,
  invoiceSeries,
  newId,
  nodes,
  now,
  readTenant,
  type Transaction,
} from "@waitron/db";
import { readOperationAuthority, type ProvisionedNode } from "@waitron/module";
import {
  validateAllocationEnvelope,
  validateAllocationReplay,
  type AllocationContext,
  type AllocationRefusal,
  type AllocationValidation,
} from "./allocation-envelope.js";
import { WAITRON_ID_SISTEMA } from "./provisioning.js";
import { liveSeriesBases } from "./reserved-series.js";
import { registroSif } from "./schema/sif.js";
import { cadenas } from "./schema/cadenas.js";
import { fiscalReservations } from "./schema/reservations.js";
import { verifyRetainedPaperReservation } from "./paper-evidence.js";
import { fiscalAllocations, type ActivationResult } from "./schema/allocations.js";

export type ActivationRefusal =
  | AllocationRefusal
  | "node_mismatch"
  | "environment_unstamped"
  | "installation_used"
  | "series_collision";
export type ActivationValidation =
  | Exclude<AllocationValidation, { ok: false }>
  | { readonly ok: false; readonly reason: ActivationRefusal };

export async function validateAllocationForActivation(
  tx: Transaction,
  node: ProvisionedNode,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
): Promise<ActivationValidation> {
  return validateForActivation(tx, node, allocation, approval, context);
}

type SeriesBases = readonly { readonly code: string; readonly purpose: string }[];

async function validateForActivation(
  tx: Transaction,
  node: ProvisionedNode,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
  dormantBases?: SeriesBases,
): Promise<ActivationValidation> {
  const [storedNode] = await tx
    .select({ locationId: nodes.locationId })
    .from(nodes)
    .where(eq(nodes.id, node.nodeId));
  if (storedNode?.locationId !== node.locationId || context.targetNodeId !== node.nodeId)
    return { ok: false, reason: "node_mismatch" };
  const tenant = await readTenant(tx);
  if (tenant === null) return { ok: false, reason: "taxpayer_mismatch" };
  const [stamp] = await tx
    .select({ environment: deployment.environment })
    .from(deployment)
    .where(eq(deployment.id, 1));
  const environment = stamp?.environment;
  if (environment !== "production" && environment !== "preproduction")
    return { ok: false, reason: "environment_unstamped" };
  const [liveSif] = await tx
    .select({ softwareId: registroSif.idSistemaInformatico })
    .from(registroSif)
    .where(and(eq(registroSif.nodeId, node.nodeId), isNull(registroSif.revocadoEn)));
  const storedBases = dormantBases ?? (await liveSeriesBases(tx, node));
  if (storedBases.length === 0 && context.mode !== "initial-setup")
    return { ok: false, reason: "series_mismatch" };
  const validated = validateAllocationEnvelope(allocation, approval, {
    ...context,
    taxpayerNif: tenant.taxId,
    environment,
    softwareId: liveSif?.softwareId ?? WAITRON_ID_SISTEMA,
    requiredBases: storedBases.length > 0 ? storedBases : context.requiredBases,
  });
  if (!validated.ok) return validated;
  const [reserved] = await tx
    .select({ eventKey: fiscalReservations.eventKey })
    .from(fiscalReservations)
    .where(eq(fiscalReservations.allocationKey, validated.allocation.allocationId));
  if (reserved !== undefined && dormantBases === undefined)
    return { ok: false, reason: "reservation_mismatch" };
  const [usedAllocation] = await tx
    .select({ eventKey: fiscalAllocations.eventKey })
    .from(fiscalAllocations)
    .where(eq(fiscalAllocations.allocationKey, validated.allocation.allocationId));
  if (usedAllocation !== undefined) return { ok: false, reason: "allocation_consumed" };
  const [usedIdentity] = await tx
    .select({ id: registroSif.id })
    .from(registroSif)
    .where(
      and(
        eq(registroSif.nif, validated.allocation.taxpayerNif),
        eq(registroSif.idSistemaInformatico, validated.allocation.softwareId),
        sql`${registroSif.numeroInstalacion} = ${validated.allocation.installationIdentity}`,
      ),
    )
    .limit(1);
  if (usedIdentity !== undefined) return { ok: false, reason: "installation_used" };
  const [usedSeries] = await tx
    .select({ id: invoiceSeries.id })
    .from(invoiceSeries)
    .where(
      inArray(
        invoiceSeries.code,
        validated.allocation.series.map((series) => series.code),
      ),
    )
    .limit(1);
  if (usedSeries !== undefined) return { ok: false, reason: "series_collision" };
  return validated;
}

export async function activateAllocation(
  tx: Transaction,
  node: ProvisionedNode,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
): Promise<ActivationResult> {
  return activate(tx, node, allocation, approval, context);
}

export async function activateAuthenticatedAllocation(
  tx: Transaction,
  node: ProvisionedNode,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
  authority: unknown,
  action: string,
): Promise<ActivationResult> {
  const authorised = authenticatedContext(context, authority, action);
  return activate(tx, node, allocation, approval, authorised.context, undefined, authorised.check);
}

function authenticatedContext(context: AllocationContext, authority: unknown, action: string) {
  const binding = {
    module: "fiscal-verifactu",
    action,
    eventId: context.eventId,
    sourceId: context.sourceId,
    targetNodeId: context.targetNodeId,
  };
  const operatorId =
    typeof context.operatorId === "string"
      ? context.operatorId
      : Object.freeze({ ...context.operatorId });
  const mode = context.mode;
  const authorise = (): void => {
    const verified = readOperationAuthority(authority, binding);
    if (
      !isDeepStrictEqual(verified?.operatorId, operatorId) ||
      (mode === "initial-setup"
        ? action !== "setup"
        : !["restore", "re-register", "promote"].includes(action))
    )
      throw new AppError("sif.allocation_invalid", { reason: "reauthentication_required" });
  };
  authorise();
  return {
    context: {
      ...context,
      reauthentication: { operatorId, eventId: binding.eventId },
    },
    check: authorise,
  };
}

export async function activateAuthenticatedDormantAllocation(
  tx: Transaction,
  node: ProvisionedNode,
  reservationEventId: string,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
  authority: unknown,
): Promise<ActivationResult> {
  const authorised = authenticatedContext(context, authority, "promote");
  return activateDormant(
    tx,
    node,
    reservationEventId,
    allocation,
    approval,
    authorised.context,
    authorised.check,
  );
}

export async function activateDormantAllocation(
  tx: Transaction,
  node: ProvisionedNode,
  reservationEventId: string,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
): Promise<ActivationResult> {
  return activateDormant(tx, node, reservationEventId, allocation, approval, context);
}

async function activateDormant(
  tx: Transaction,
  node: ProvisionedNode,
  reservationEventId: string,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
  authorise?: () => void,
): Promise<ActivationResult> {
  const refuse = (reason: string): never => {
    throw new AppError("sif.allocation_invalid", { reason });
  };
  try {
    allocation = structuredClone(allocation);
    approval = structuredClone(approval);
  } catch {
    return refuse("reservation_mismatch");
  }
  const [retained] = await tx
    .select()
    .from(fiscalReservations)
    .where(eq(fiscalReservations.eventKey, reservationEventId));
  if (retained === undefined) return refuse("reservation_missing");
  if (
    retained.nodeId !== node.nodeId ||
    retained.nodeId !== context.targetNodeId ||
    retained.sourceNodeId !== context.sourceId ||
    retained.eventKey === context.eventId ||
    context.mode !== "recovery" ||
    context.authority.kind !== "paper"
  )
    return refuse("reservation_mismatch");
  const proof = retained.evidence as {
    block?: unknown;
    reservation?: { payload?: { operatorId?: unknown; incidentEvidence?: unknown } };
  } | null;
  const historical = verifyRetainedPaperReservation(retained.evidence, context.authority.trust, {
    allocationId: retained.allocationKey,
    taxpayerNif: retained.taxpayerNif,
    softwareId: retained.softwareId,
    environment: retained.environment,
    recipientVenueId: context.authority.recipientVenueId,
    generationId: context.authority.generationId,
    blockId: context.authority.blockId,
    eventId: retained.eventKey,
    operatorId:
      typeof proof?.reservation?.payload?.operatorId === "string"
        ? proof.reservation.payload.operatorId
        : "",
    sourceId: retained.sourceNodeId,
    targetNodeId: retained.nodeId,
    incidentEvidence:
      typeof proof?.reservation?.payload?.incidentEvidence === "string"
        ? proof.reservation.payload.incidentEvidence
        : "",
    requiredBases: retained.bases,
  });
  if (!historical.ok) return refuse("reservation_untrusted");
  const supplied = allocation as { reservationEvidence?: { block?: unknown } } | null;
  if (
    historical.allocation.installationIdentity !== retained.installationIdentity ||
    !isDeepStrictEqual(allocation, {
      ...historical.allocation,
      reservationEvidence: supplied?.reservationEvidence,
    }) ||
    !isDeepStrictEqual(supplied?.reservationEvidence?.block, proof?.block)
  )
    return refuse("reservation_mismatch");
  if (context.priorActivation !== "committed") {
    const [activeSif] = await tx
      .select({ id: registroSif.id })
      .from(registroSif)
      .where(and(eq(registroSif.nodeId, node.nodeId), isNull(registroSif.revocadoEn)))
      .limit(1);
    const [activeSeries] = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, node.nodeId), isNull(invoiceSeries.retiredAt)))
      .limit(1);
    if (activeSif !== undefined || activeSeries !== undefined)
      return refuse("standby_already_active");
  }
  // Historical join signatures do not establish current outside consumption.
  return activate(tx, node, allocation, approval, context, retained.bases, authorise);
}

async function activate(
  tx: Transaction,
  node: ProvisionedNode,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
  dormantBases?: SeriesBases,
  authorise?: () => void,
): Promise<ActivationResult> {
  const refuse = (reason: string): never => {
    throw new AppError("sif.allocation_invalid", { reason });
  };
  const [prior] = await tx
    .select()
    .from(fiscalAllocations)
    .where(eq(fiscalAllocations.eventKey, context.eventId));
  if (prior !== undefined) {
    if (context.priorActivation !== "committed")
      return refuse(
        context.priorActivation === "uncertain"
          ? "uncertain_prior_activation"
          : "outside_confirmation_missing",
      );
    const tenant = await readTenant(tx);
    const [stamp] = await tx.select().from(deployment).where(eq(deployment.id, 1));
    const [storedNode] = await tx.select().from(nodes).where(eq(nodes.id, node.nodeId));
    if (
      storedNode?.locationId !== node.locationId ||
      prior.nodeId !== node.nodeId ||
      context.targetNodeId !== node.nodeId
    )
      return refuse("node_mismatch");
    if (tenant?.taxId !== prior.taxpayerNif) return refuse("taxpayer_mismatch");
    if (stamp?.environment !== "production" && stamp?.environment !== "preproduction")
      return refuse("environment_unstamped");
    if (stamp.environment !== prior.environment) return refuse("environment_mismatch");
    const validated = validateAllocationReplay(
      allocation,
      approval,
      {
        ...context,
        taxpayerNif: prior.taxpayerNif,
        softwareId: prior.softwareId,
        environment: stamp.environment,
        requiredBases: prior.bases,
      },
      prior,
    );
    if (!validated.ok) return refuse(validated.reason);
    const [activeSif] = await tx
      .select({
        id: registroSif.id,
        nif: registroSif.nif,
        softwareId: registroSif.idSistemaInformatico,
        identity: sql<string>`${registroSif.numeroInstalacion}`,
      })
      .from(registroSif)
      .where(and(eq(registroSif.nodeId, node.nodeId), isNull(registroSif.revocadoEn)));
    const live = await tx
      .select({ id: invoiceSeries.id, code: invoiceSeries.code, purpose: invoiceSeries.purpose })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, node.nodeId), isNull(invoiceSeries.retiredAt)))
      .orderBy(invoiceSeries.code);
    if (
      activeSif?.id !== prior.sifId ||
      activeSif.nif !== prior.taxpayerNif ||
      activeSif.softwareId !== prior.softwareId ||
      activeSif.identity !== prior.installationIdentity ||
      !isDeepStrictEqual(live, prior.result.series)
    )
      return refuse("activation_superseded");
    authorise?.();
    return prior.result;
  }
  const validated = await validateForActivation(
    tx,
    node,
    allocation,
    approval,
    context,
    dormantBases,
  );
  if (!validated.ok) return refuse(validated.reason);
  const bases = dormantBases ?? (await liveSeriesBases(tx, node));
  authorise?.();
  const retiredAt = now();
  const sifId = newId();
  await tx
    .update(registroSif)
    .set({ revocadoEn: retiredAt })
    .where(and(eq(registroSif.nodeId, node.nodeId), isNull(registroSif.revocadoEn)));
  await tx.insert(registroSif).values({
    id: sifId,
    nodeId: node.nodeId,
    nif: validated.allocation.taxpayerNif,
    idSistemaInformatico: validated.allocation.softwareId,
    numeroInstalacion: sql`${validated.allocation.installationIdentity}`,
  });
  await tx
    .insert(cadenas)
    .values({ nodeId: node.nodeId })
    .onConflictDoUpdate({
      target: cadenas.nodeId,
      set: { ultimoRegistroId: null, ultimaHuella: null, actualizadoEn: retiredAt },
    });
  await tx
    .update(invoiceSeries)
    .set({ retiredAt })
    .where(and(eq(invoiceSeries.nodeId, node.nodeId), isNull(invoiceSeries.retiredAt)));
  const series = [...validated.allocation.series]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((s) => ({ id: newId(), ...s }));
  for (const entry of series)
    await tx.insert(invoiceSeries).values({ ...entry, nodeId: node.nodeId });
  const result: ActivationResult = { activationEventId: validated.approval.eventId, sifId, series };
  await tx.insert(fiscalAllocations).values({
    eventKey: result.activationEventId,
    allocationKey: validated.allocation.allocationId,
    nodeId: node.nodeId,
    sifId,
    taxpayerNif: validated.allocation.taxpayerNif,
    softwareId: validated.allocation.softwareId,
    environment: validated.allocation.environment,
    installationIdentity: validated.allocation.installationIdentity,
    allocation: validated.allocation,
    approval: validated.approval,
    bases: bases.length > 0 ? bases : context.requiredBases,
    result,
  });
  return result;
}
