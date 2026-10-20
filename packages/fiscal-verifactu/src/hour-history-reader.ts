import {
  invoiceSeries,
  readTenant,
  type Transaction,
  type DeploymentEnvironment,
} from "@waitron/db";
import type { HourHistorySource } from "./hour-history.js";
import { isHourAllocatedSeries } from "./hour-identity.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { fiscalReservations } from "./schema/reservations.js";
import { registroSif } from "./schema/sif.js";

function validBases(value: unknown): value is { code: string; purpose: string }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (base) =>
        base !== null &&
        typeof base === "object" &&
        typeof base.code === "string" &&
        typeof base.purpose === "string",
    ) &&
    isHourAllocatedSeries(
      value.map((base) => ({ code: `${base.code}-0000`, purpose: base.purpose })),
      "0000",
      value,
    )
  );
}
function time(...values: (Date | string | null | undefined)[]): number | null {
  const present = values.filter((value) => value !== null);
  return present.length === 0
    ? null
    : Math.max(
        ...present.map((value) =>
          value instanceof Date
            ? value.getTime()
            : typeof value === "string"
              ? Date.parse(value)
              : NaN,
        ),
      );
}

export async function readHourHistory(
  tx: Transaction,
  environment: DeploymentEnvironment | null,
): Promise<HourHistorySource> {
  const tenant = await readTenant(tx);
  // No node, software or retirement predicate may hide an already spent invoice name.
  const series = await tx
    .select({
      id: invoiceSeries.id,
      nodeId: invoiceSeries.nodeId,
      code: invoiceSeries.code,
      purpose: invoiceSeries.purpose,
      retiredAt: invoiceSeries.retiredAt,
    })
    .from(invoiceSeries);
  const sifs = await tx
    .select({
      id: registroSif.id,
      nodeId: registroSif.nodeId,
      nif: registroSif.nif,
      idSistemaInformatico: registroSif.idSistemaInformatico,
      numeroInstalacion: registroSif.numeroInstalacion,
      registradoEn: registroSif.registradoEn,
      revocadoEn: registroSif.revocadoEn,
    })
    .from(registroSif);
  const allocations = await tx
    .select({
      eventKey: fiscalAllocations.eventKey,
      allocationKey: fiscalAllocations.allocationKey,
      nodeId: fiscalAllocations.nodeId,
      sifId: fiscalAllocations.sifId,
      taxpayerNif: fiscalAllocations.taxpayerNif,
      softwareId: fiscalAllocations.softwareId,
      environment: fiscalAllocations.environment,
      installationIdentity: fiscalAllocations.installationIdentity,
      allocation: fiscalAllocations.allocation,
      approval: fiscalAllocations.approval,
      bases: fiscalAllocations.bases,
      result: fiscalAllocations.result,
      activatedAt: fiscalAllocations.activatedAt,
    })
    .from(fiscalAllocations);
  const reservations = await tx
    .select({
      eventKey: fiscalReservations.eventKey,
      allocationKey: fiscalReservations.allocationKey,
      nodeId: fiscalReservations.nodeId,
      sourceNodeId: fiscalReservations.sourceNodeId,
      taxpayerNif: fiscalReservations.taxpayerNif,
      softwareId: fiscalReservations.softwareId,
      environment: fiscalReservations.environment,
      installationIdentity: fiscalReservations.installationIdentity,
      evidence: fiscalReservations.evidence,
      bases: fiscalReservations.bases,
      establishedAt: fiscalReservations.establishedAt,
    })
    .from(fiscalReservations);
  let complete =
    series.length + sifs.length + allocations.length + reservations.length === 0 ||
    (tenant !== null && environment !== null);
  const records: unknown[] = [];
  for (const row of sifs)
    records.push({
      reference: `registro_sif/${row.id}`,
      kind: "activation",
      taxpayerNif: row.nif,
      environment,
      softwareId: row.idSistemaInformatico,
      nodeId: row.nodeId,
      identity: row.numeroInstalacion,
      recordedAtMs: time(row.registradoEn, row.revocadoEn),
    });
  for (const row of series) {
    const matching = sifs.filter(
      (sif) => sif.nodeId === row.nodeId && row.code.endsWith(`-${sif.numeroInstalacion}`),
    );
    if (matching.length !== 1) complete = false;
    const sif = matching[0];
    records.push({
      reference: `invoice_series/${row.id}`,
      kind: "series",
      taxpayerNif: sif?.nif,
      environment,
      softwareId: sif?.idSistemaInformatico,
      nodeId: row.nodeId,
      identity: sif?.numeroInstalacion,
      recordedAtMs: time(row.retiredAt),
    });
  }
  for (const row of allocations) {
    const sif = sifs.find((value) => value.id === row.sifId);
    const allocation = row.allocation;
    const result = row.result;
    const approval = row.approval;
    if (
      sif === undefined ||
      sif.nodeId !== row.nodeId ||
      sif.nif !== row.taxpayerNif ||
      sif.idSistemaInformatico !== row.softwareId ||
      sif.numeroInstalacion !== row.installationIdentity ||
      allocation?.allocationId !== row.allocationKey ||
      allocation.taxpayerNif !== row.taxpayerNif ||
      allocation.softwareId !== row.softwareId ||
      allocation.environment !== row.environment ||
      allocation.installationIdentity !== row.installationIdentity ||
      approval?.eventId !== row.eventKey ||
      approval.targetNodeId !== row.nodeId ||
      result?.activationEventId !== row.eventKey ||
      result.sifId !== row.sifId ||
      !validBases(row.bases) ||
      !isHourAllocatedSeries(allocation.series, row.installationIdentity, row.bases) ||
      !Array.isArray(result.series) ||
      !isHourAllocatedSeries(result.series, row.installationIdentity, row.bases) ||
      result.series.some(
        (entry) =>
          !series.some(
            (stored) =>
              stored.id === entry.id &&
              stored.nodeId === row.nodeId &&
              stored.code === entry.code &&
              stored.purpose === entry.purpose,
          ),
      )
    )
      complete = false;
    records.push({
      reference: `fiscal_allocations/${row.eventKey}`,
      kind: "intent",
      taxpayerNif: row.taxpayerNif,
      environment: row.environment,
      softwareId: row.softwareId,
      nodeId: row.nodeId,
      identity: row.installationIdentity,
      recordedAtMs: time(row.activatedAt, allocation?.issuedAt, approval?.confirmedAt),
    });
  }
  for (const row of reservations) {
    if (
      row.evidence === null ||
      typeof row.evidence !== "object" ||
      Array.isArray(row.evidence) ||
      !validBases(row.bases) ||
      row.sourceNodeId === row.nodeId
    )
      complete = false;
    // A reservation's explicit scope is evidence even if a later database stamp differs.
    records.push({
      reference: `fiscal_reservations/${row.eventKey}`,
      kind: "reservation",
      taxpayerNif: row.taxpayerNif,
      environment: row.environment,
      softwareId: row.softwareId,
      nodeId: row.nodeId,
      identity: row.installationIdentity,
      recordedAtMs: time(row.establishedAt),
    });
  }
  return { reference: "venue", complete, records };
}
