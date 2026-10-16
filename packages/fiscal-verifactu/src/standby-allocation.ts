import "./errors.js";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "@waitron/shared";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { deployment, invoiceSeries, nodes, readTenant, type Transaction } from "@waitron/db";
import type { ProvisionedNode } from "@waitron/module";
import {
  verifyPaperReservation,
  type PaperReservationContext,
  type PaperReservationVerification,
} from "./paper-evidence.js";
import {
  verifyDeclaredStandbyEvidence,
  type DeclaredStandbyContext,
} from "./declared-paper-standby.js";
import { liveSeriesBases } from "./reserved-series.js";
import { registroSif } from "./schema/sif.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { fiscalReservations } from "./schema/reservations.js";

export type StandbyAllocationValidation =
  | ReturnType<typeof verifyDeclaredStandbyEvidence>
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
  context: PaperReservationContext | DeclaredStandbyContext,
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
  const filled = {
    ...context,
    taxpayerNif: tenant.taxId,
    softwareId: sif.softwareId,
    environment: stamp.environment,
    sourceId: primary.nodeId,
    targetNodeId,
    requiredBases: bases,
  };
  const validated =
    "kind" in filled && filled.kind === "paper-declared-standby"
      ? verifyDeclaredStandbyEvidence(evidence, trust, filled)
      : verifyPaperReservation(evidence, trust, filled as PaperReservationContext);
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

export async function establishDormantAllocation(
  tx: Transaction,
  primary: ProvisionedNode,
  standby: ProvisionedNode,
  evidence: unknown,
  trust: unknown,
  context: PaperReservationContext | DeclaredStandbyContext,
): Promise<{ readonly reservationEventId: string; readonly allocationId: string }> {
  const refuse = (reason: string): never => {
    throw new AppError("sif.allocation_invalid", { reason });
  };
  // Validation and persistence must read the same evidence across awaited database reads.
  try {
    evidence = structuredClone(evidence);
  } catch {
    return refuse("malformed");
  }
  const [target] = await tx
    .select({ locationId: nodes.locationId })
    .from(nodes)
    .where(eq(nodes.id, standby.nodeId));
  if (
    standby.nodeId === primary.nodeId ||
    standby.locationId !== primary.locationId ||
    target?.locationId !== standby.locationId
  )
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
    evidence,
    trust,
    context,
  );
  if (!validated.ok) return refuse(validated.reason);
  const { allocation, reservation } = validated;
  const retained = await tx
    .select()
    .from(fiscalReservations)
    .where(
      or(
        eq(fiscalReservations.eventKey, reservation.eventId),
        eq(fiscalReservations.allocationKey, allocation.allocationId),
        and(
          eq(fiscalReservations.taxpayerNif, allocation.taxpayerNif),
          eq(fiscalReservations.softwareId, allocation.softwareId),
          eq(fiscalReservations.environment, allocation.environment),
          eq(fiscalReservations.installationIdentity, allocation.installationIdentity),
        ),
      ),
    );
  const bases = await liveSeriesBases(tx, primary);
  const result = { reservationEventId: reservation.eventId, allocationId: allocation.allocationId };
  if (retained.length !== 0) {
    const prior = retained[0]!;
    if (
      retained.length !== 1 ||
      prior.eventKey !== reservation.eventId ||
      prior.allocationKey !== allocation.allocationId ||
      prior.nodeId !== standby.nodeId ||
      prior.sourceNodeId !== primary.nodeId ||
      !isDeepStrictEqual(prior.evidence, evidence) ||
      !isDeepStrictEqual(prior.bases, bases)
    )
      return refuse("reservation_reused");
    return result;
  }
  await tx.insert(fiscalReservations).values({
    eventKey: reservation.eventId,
    allocationKey: allocation.allocationId,
    nodeId: standby.nodeId,
    sourceNodeId: primary.nodeId,
    taxpayerNif: allocation.taxpayerNif,
    softwareId: allocation.softwareId,
    environment: allocation.environment,
    installationIdentity: allocation.installationIdentity,
    evidence,
    bases,
  });
  return result;
}
