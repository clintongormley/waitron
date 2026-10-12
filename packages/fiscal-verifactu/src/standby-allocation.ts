import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { deployment, invoiceSeries, nodes, readTenant, type Transaction } from "@waitron/db";
import type { ProvisionedNode } from "@waitron/module";
import {
  verifyPaperReservation,
  type PaperReservationContext,
  type PaperReservationVerification,
} from "./paper-evidence.js";
import { liveSeriesBases } from "./reserved-series.js";
import { registroSif } from "./schema/sif.js";
import { fiscalAllocations } from "./schema/allocations.js";

export type StandbyAllocationValidation =
  | PaperReservationVerification
  | {
      readonly ok: false;
      readonly reason:
        | "node_mismatch"
        | "taxpayer_missing"
        | "environment_unstamped"
        | "primary_not_registered"
        | "allocation_consumed"
        | "installation_used"
        | "series_collision";
    };

export async function validateStandbyAllocation(
  tx: Transaction,
  primary: ProvisionedNode,
  targetNodeId: string,
  evidence: unknown,
  trust: unknown,
  context: PaperReservationContext,
): Promise<StandbyAllocationValidation> {
  const [source] = await tx
    .select({ locationId: nodes.locationId })
    .from(nodes)
    .where(eq(nodes.id, primary.nodeId));
  if (source?.locationId !== primary.locationId) return { ok: false, reason: "node_mismatch" };
  const tenant = await readTenant(tx);
  if (tenant === null) return { ok: false, reason: "taxpayer_missing" };
  const [stamp] = await tx
    .select({ environment: deployment.environment })
    .from(deployment)
    .where(eq(deployment.id, 1));
  if (stamp?.environment !== "production" && stamp?.environment !== "preproduction")
    return { ok: false, reason: "environment_unstamped" };
  const [sif] = await tx
    .select({ nif: registroSif.nif, softwareId: registroSif.idSistemaInformatico })
    .from(registroSif)
    .where(and(eq(registroSif.nodeId, primary.nodeId), isNull(registroSif.revocadoEn)));
  if (sif === undefined) return { ok: false, reason: "primary_not_registered" };
  if (sif.nif !== tenant.taxId) return { ok: false, reason: "scope_mismatch" };
  const bases = await liveSeriesBases(tx, primary);
  const validated = verifyPaperReservation(evidence, trust, {
    ...context,
    taxpayerNif: tenant.taxId,
    softwareId: sif.softwareId,
    environment: stamp.environment,
    sourceId: primary.nodeId,
    targetNodeId,
    requiredBases: bases,
  });
  if (!validated.ok) return validated;
  const [usedAllocation] = await tx
    .select({ id: fiscalAllocations.eventKey })
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
