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
import type { ProvisionedNode } from "@waitron/module";
import {
  validateAllocationEnvelope,
  type AllocationContext,
  type AllocationRefusal,
  type AllocationValidation,
} from "./allocation-envelope.js";
import { WAITRON_ID_SISTEMA } from "./provisioning.js";
import { liveSeriesBases } from "./reserved-series.js";
import { registroSif } from "./schema/sif.js";
import { cadenas } from "./schema/cadenas.js";
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
  const storedBases = await liveSeriesBases(tx, node);
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
    const validated = validateAllocationEnvelope(allocation, approval, {
      ...context,
      priorActivation: "none",
      taxpayerNif: prior.taxpayerNif,
      softwareId: prior.softwareId,
      environment: stamp.environment,
      requiredBases: prior.bases,
    });
    if (!validated.ok) return refuse(validated.reason);
    if (
      !isDeepStrictEqual(validated.allocation, prior.allocation) ||
      !isDeepStrictEqual(validated.approval, prior.approval)
    )
      return refuse("event_mismatch");
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
    return prior.result;
  }
  const validated = await validateAllocationForActivation(tx, node, allocation, approval, context);
  if (!validated.ok) return refuse(validated.reason);
  const bases = await liveSeriesBases(tx, node);
  const retiredAt = now();
  const sifId = newId();
  await tx
    .update(registroSif)
    .set({ revocadoEn: retiredAt })
    .where(and(eq(registroSif.nodeId, node.nodeId), isNull(registroSif.revocadoEn)));
  await tx
    .insert(registroSif)
    .values({
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
  await tx
    .insert(fiscalAllocations)
    .values({
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
