import { inArray, sql } from "drizzle-orm";
import { readTenant, type Transaction } from "@waitron/db";
import type { Cabecera, RegistroConsultado } from "@waitron/verifactu";
import type { ReconcileScope } from "./reconcile.js";
import type { LookupConflictEvidence } from "./conflict-types.js";
import { fiscalSeriesConflicts } from "./schema/series-conflicts.js";

type LiveSeries = { sif_id: string; series_id: string; code: string };
export async function readLiveReconciliationSeries(
  tx: Transaction,
  scope: ReconcileScope,
): Promise<LiveSeries[]> {
  return (
    await tx.execute<LiveSeries>(sql`
    select s.id as sif_id, i.id as series_id, i.code
    from registro_sif s join invoice_series i on i.node_id = s.node_id
    where s.node_id = ${scope.nodeId} and s.nif = ${scope.taxpayerId}
      and s.revocado_en is null and i.retired_at is null
      and (
        exists (select 1 from fiscal_allocations a where a.sif_id = s.id and a.environment = ${scope.environment})
        or exists (select 1 from registros_facturacion r where r.sif_id = s.id and r.entorno = ${scope.environment})
      )
  `)
  ).rows;
}
export async function liveLookupHeader(tx: Transaction, scope: ReconcileScope): Promise<Cabecera> {
  const tenant = await readTenant(tx);
  if (tenant === null || tenant.taxId !== scope.taxpayerId)
    throw new Error("reconciliation requires the scoped venue taxpayer");
  return { ObligadoEmision: { NombreRazon: tenant.legalName, NIF: tenant.taxId } };
}

export async function retainUnheldSeriesConflicts(
  tx: Transaction,
  scope: ReconcileScope,
  observed: readonly RegistroConsultado[],
  representedNumbers: ReadonlySet<string>,
  now: Date,
  period: { year: string; month: string },
): Promise<void> {
  const live = await readLiveReconciliationSeries(tx, scope);
  const local = await tx.execute<{ number: string; date: string }>(sql`
    select r.num_serie_factura as number, r.fecha_expedicion_factura as date
    from registros_facturacion r
    where ${inArray(sql`r.node_id`, scope.historyNodeIds)} and r.id_emisor_factura = ${scope.taxpayerId}
      and r.entorno = ${scope.environment}
      and substr(r.fecha_expedicion_factura, 1, 7) = ${`${period.year}-${period.month}`}
  `);
  const held = new Set(local.rows.map((row) => JSON.stringify([row.number, row.date])));
  for (const record of observed) {
    if (record.IDFactura.IDEmisorFactura !== scope.taxpayerId) continue;
    const number = record.IDFactura.NumSerieFactura;
    if (representedNumbers.has(number)) continue;
    const series = live.find(
      (row) =>
        number.startsWith(`${row.code}/`) &&
        /^[1-9][0-9]*$/.test(number.slice(row.code.length + 1)),
    );
    if (series === undefined) continue;
    const date = record.IDFactura.FechaExpedicionFactura.split("-").reverse().join("-");
    // A sale committed during the lookup belongs to the current copy, not missing history.
    if (held.has(JSON.stringify([number, date]))) continue;
    const data = record.DatosRegistroFacturacion;
    const evidence: LookupConflictEvidence = {
      source: "consulta",
      invoice: record.IDFactura,
      reference: typeof data.RefExterna === "string" ? data.RefExterna : null,
      state: record.EstadoRegistro,
      fingerprint: typeof data.Huella === "string" ? data.Huella : null,
      system: lookupSystem(data.SistemaInformatico),
    };
    await tx
      .insert(fiscalSeriesConflicts)
      .values({
        sifId: series.sif_id,
        seriesId: series.series_id,
        invoiceIdentity: number,
        evidence,
        recordedAt: now,
      })
      .onConflictDoNothing({
        target: [fiscalSeriesConflicts.sifId, fiscalSeriesConflicts.invoiceIdentity],
      });
  }
}

export function lookupSystem(value: unknown): LookupConflictEvidence["system"] {
  if (typeof value !== "object" || value === null) return null;
  return {
    taxId: "NIF" in value && typeof value.NIF === "string" ? value.NIF : null,
    softwareId:
      "IdSistemaInformatico" in value && typeof value.IdSistemaInformatico === "string"
        ? value.IdSistemaInformatico
        : null,
    installation:
      "NumeroInstalacion" in value && typeof value.NumeroInstalacion === "string"
        ? value.NumeroInstalacion
        : null,
  };
}
