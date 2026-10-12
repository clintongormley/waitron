import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { deployment, invoiceSeries, nodes, readTenant, type Transaction } from "@waitron/db";
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
