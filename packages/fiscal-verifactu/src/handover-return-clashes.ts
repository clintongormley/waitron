import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { canonicalize } from "@waitron/membership";
import type { ReturnDiscrepancy } from "@waitron/module";
import type { ReturnedOriginals, ReturnRow } from "./handover-return.js";

export function recordCounterparts(tx: Transaction, record: ReturnRow): ReturnRow[] {
  return tx.all<ReturnRow>(sql`select * from registros_facturacion where
    id = ${record.id} or
    (node_id = ${record.node_id} and secuencia = ${record.secuencia}) or
    (${record.corrects_registro_id} is not null and corrects_registro_id = ${record.corrects_registro_id}) or
    (${record.corrects_registro_id} is null and corrects_registro_id is null and
      id_emisor_factura = ${record.id_emisor_factura} and num_serie_factura = ${record.num_serie_factura}
      and fecha_expedicion_factura = ${record.fecha_expedicion_factura}
      and tipo_registro = ${record.tipo_registro}) order by id`);
}

const DELIVERY_LABELS: Record<string, string> = {
  pendiente: "Pending",
  enviando: "Sending",
  aceptado: "Accepted",
  aceptado_con_errores: "Accepted with errors",
  rechazado: "Rejected",
  detenido: "Stopped",
  retenido: "Held",
};

function readableRecord(record: ReturnRow, delivery: ReturnRow | undefined): string {
  const fields: [string, string][] = [
    ["Record id", "id"],
    ["Invoice", "num_serie_factura"],
    ["Invoice date", "fecha_expedicion_factura"],
    ["Record type", "tipo_registro"],
    ["Invoice type", "tipo_factura"],
    ["Issuer", "nombre_razon_emisor"],
    ["Issuer tax id", "id_emisor_factura"],
    ["Customers", "destinatarios"],
    ["Description", "descripcion_operacion"],
    ["Total", "importe_total"],
    ["Tax total", "cuota_total"],
    ["Tax breakdown", "desglose"],
    ["Correction target", "corrects_registro_id"],
    ["Correction type", "tipo_rectificativa"],
    ["Corrected invoices", "facturas_rectificadas"],
    ["Replaced invoices", "facturas_sustituidas"],
    ["Correction amounts", "importe_rectificacion"],
    ["Node", "node_id"],
    ["Fiscal installation id", "sif_id"],
    ["Chain position", "secuencia"],
    ["Generated at (UTC)", "fecha_hora_huso_gen_registro"],
    ["Original offset (minutes)", "offset_minutos"],
    ["First record", "primer_registro"],
    ["Predecessor issuer", "anterior_id_emisor_factura"],
    ["Predecessor invoice", "anterior_num_serie_factura"],
    ["Predecessor date", "anterior_fecha_expedicion_factura"],
    ["Predecessor hash", "anterior_huella"],
    ["Hash", "huella"],
  ];
  const state = String(delivery?.estado ?? "unknown");
  return [
    ...fields.map(([label, key]) => `${label}: ${record[key] ?? "—"}`),
    `Filing status: ${DELIVERY_LABELS[state] ?? "Unknown"} (${state})`,
    `Tax-agency receipt (CSV): ${delivery?.csv ?? "—"}`,
    `Filing error code: ${delivery?.codigo_error ?? "—"}`,
    `Filing error: ${delivery?.mensaje_error ?? "—"}`,
  ].join("\n");
}

export function inspectReturnedRecords(
  tx: Transaction,
  sourceNodeId: string,
  returned: ReturnedOriginals,
): ReturnDiscrepancy[] {
  const records = [...returned.records].sort((a, b) => Number(a.secuencia) - Number(b.secuencia));
  const pending = records.filter(
    (record) =>
      !recordCounterparts(tx, record).some(
        (own) => own.id === record.id && canonicalize(own) === canonicalize(record),
      ),
  );
  return pending.flatMap((record) => {
    const held = recordCounterparts(tx, record);
    if (!held.length) return [];
    const original = { record, held };
    const readable = [
      "Returned invoice-record clash",
      "The new main will not submit the old box's conflicting record. Check its filing status and tax-agency receipt below; it may already have been submitted.",
      "Later records may remain blocked. Later batches have not been downloaded. Resetting the old box deletes those records too, including sale lines and local backups.",
      "Keep this file: local clash evidence survives restart, but is not included in venue backups or the next handover.",
      "\nOld-box record",
      readableRecord(
        record,
        returned.deliveries.find((row) => row.registro_id === record.id),
      ),
      ...held.map(
        (row) =>
          "\nRecord held by the new main\n" +
          readableRecord(
            row,
            tx.all<ReturnRow>(sql`select * from envios where registro_id = ${row.id}`)[0],
          ),
      ),
      "\nRecords in this batch still waiting",
      ...pending.map(
        (row) =>
          `Invoice ${row.num_serie_factura}, date ${row.fecha_expedicion_factura}, record ${row.id}, node ${row.node_id}, position ${row.secuencia}`,
      ),
    ].join("\n");
    return [
      {
        kind: "record" as const,
        saleId: String(record.sale_id),
        fingerprint: createHash("sha256").update(canonicalize(original)).digest("hex"),
        eligible: record === pending[0] && record.node_id === sourceNodeId,
        outstanding: pending,
        original,
        incoming: record,
        held,
        readable,
      },
    ];
  });
}
