import {
  invoiceSeries,
  readTaxpayer,
  type Transaction,
  type DeploymentEnvironment,
} from "@waitron/db";
import type { HourHistorySource } from "./hour-history.js";
import { isMinuteAllocatedSeries, isMinuteSeriesBases } from "./hour-identity.js";
import { allocationOf } from "./identity-allocation.js";
import { verifactuIdentities } from "./schema/verifactu-identities.js";

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
    isMinuteSeriesBases(value)
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

type Moment = Date | string | null;

/** The rows `hourHistorySource` judges. */
export interface HourHistoryRows {
  readonly taxpayer: boolean;
  readonly series: readonly {
    id: string;
    nodeId: string;
    code: string;
    purpose: string;
    retiredAt: Moment;
  }[];
  readonly sifs: readonly (typeof verifactuIdentities.$inferSelect)[];
}

export function hourHistorySource(
  { taxpayer, series, sifs }: HourHistoryRows,
  environment: DeploymentEnvironment | null,
): HourHistorySource {
  let complete = series.length + sifs.length === 0 || (taxpayer && environment !== null);
  const records: unknown[] = [];
  for (const row of sifs)
    records.push({
      reference: `verifactu_identities/${row.id}`,
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
  for (const sif of sifs) {
    const retained = allocationOf(sif);
    if (retained === undefined) continue;
    const { allocation, approval, bases, eventKey, allocationKey, result } = retained;
    if (
      allocation?.allocationId !== allocationKey ||
      allocation.taxpayerNif !== sif.nif ||
      allocation.softwareId !== sif.idSistemaInformatico ||
      allocation.environment !== retained.environment ||
      allocation.installationIdentity !== sif.numeroInstalacion ||
      approval?.eventId !== eventKey ||
      approval.targetNodeId !== sif.nodeId ||
      result?.activationEventId !== eventKey ||
      result.sifId !== sif.id ||
      !validBases(bases) ||
      !isMinuteAllocatedSeries(allocation.series, sif.numeroInstalacion, bases) ||
      !Array.isArray(result.series) ||
      !isMinuteAllocatedSeries(result.series, sif.numeroInstalacion, bases) ||
      result.series.some(
        (entry) =>
          !series.some(
            (stored) =>
              stored.id === entry.id &&
              stored.nodeId === sif.nodeId &&
              stored.code === entry.code &&
              stored.purpose === entry.purpose,
          ),
      )
    )
      complete = false;
    records.push({
      reference: `verifactu_identities/allocation/${eventKey}`,
      kind: "intent",
      taxpayerNif: sif.nif,
      environment: retained.environment,
      softwareId: sif.idSistemaInformatico,
      nodeId: sif.nodeId,
      identity: sif.numeroInstalacion,
      recordedAtMs: time(sif.registradoEn, allocation?.issuedAt, approval?.confirmedAt),
    });
  }
  return { reference: "venue", complete, records };
}

export async function readHourHistory(
  tx: Transaction,
  environment: DeploymentEnvironment | null,
): Promise<HourHistorySource> {
  const taxpayer = await readTaxpayer(tx);
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
  const sifs = await tx.select().from(verifactuIdentities);
  return hourHistorySource({ taxpayer: taxpayer !== null, series, sifs }, environment);
}
