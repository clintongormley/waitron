import type { ReturnedInvoiceRecord } from "@waitron/fiscal";
import { decimal, isAppError, sumDecimals } from "@waitron/shared";
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";

export function absentInvoiceIds(tx: Transaction, ids: readonly string[]): string[] {
  const absent: string[] = [];
  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500);
    const held = new Set(
      tx
        .all<{ id: string }>(
          sql`select id from registros_facturacion
      where id in (${sql.join(
        chunk.map((id) => sql`${id}`),
        sql`, `,
      )})`,
        )
        .map((row) => row.id),
    );
    absent.push(...chunk.filter((id) => !held.has(id)));
  }
  return absent;
}

export async function markReturnedInvoices(
  tx: Transaction,
  ids: readonly string[],
  now: Date,
): Promise<void> {
  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500);
    await tx.execute(sql`insert into returned_invoice_records (record_id, received_at)
      select id, ${now.toISOString()} from registros_facturacion
      where id in (${sql.join(
        chunk.map((id) => sql`${id}`),
        sql`, `,
      )})`);
  }
}

export async function returnedInvoices(
  tx: Transaction,
  page: { offset: number; limit: number },
): Promise<ReturnedInvoiceRecord[]> {
  const rows = tx.all<ReturnedInvoiceRecord & { breakdown: string | null }>(sql`
    select r.id as recordId, r.sale_id as saleId, r.node_id as sourceNodeId,
      n.name as sourceName, r.sif_id as generationId, s.numero_instalacion as installation,
      r.secuencia as sequence, r.num_serie_factura as invoiceNumber,
      r.fecha_expedicion_factura as issueDate,
      case when r.tipo_registro = 'anulacion' then 'cancellation' else r.tipo_factura end as kind,
      r.corrects_registro_id as correctsRecordId, r.desglose as breakdown,
      r.importe_total as gross, r.cuota_total as tax, m.received_at as receivedAt
    from returned_invoice_records m join registros_facturacion r on r.id = m.record_id
    join nodes n on n.id = r.node_id join registro_sif s on s.id = r.sif_id
    order by m.received_at desc, r.node_id asc, r.secuencia asc
    limit ${page.limit} offset ${page.offset}`);
  return rows.map(({ breakdown, ...row }) => ({ ...row, taxable: storedBases(breakdown) }));
}

function storedBases(breakdown: string | null): string | null {
  if (breakdown === null) return null;
  try {
    const rows: unknown = JSON.parse(breakdown);
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const bases = [];
    for (const row of rows) {
      if (
        typeof row !== "object" ||
        row === null ||
        typeof row.BaseImponibleOimporteNoSujeto !== "string"
      )
        return null;
      const base = decimal(row.BaseImponibleOimporteNoSujeto);
      bases.push(base);
    }
    return sumDecimals(bases);
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (isAppError(error) && error.code === "shared.invalid_decimal")
    )
      return null;
    throw error;
  }
}
