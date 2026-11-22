import type {
  ReturnedInvoiceRecord,
  ReturnedInvoicesQuery,
  ReturnedInvoicesPage,
} from "@waitron/fiscal";
import { decimal, isAppError, sumDecimals } from "@waitron/shared";
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";

export function absentInvoiceIds(tx: Transaction, ids: readonly string[]): string[] {
  const held = new Set(
    tx
      .all<{ id: string }>(
        sql`select id from verifactu_records
    where id in (select value from json_each(${JSON.stringify(ids)}))`,
      )
      .map((row) => row.id),
  );
  return ids.filter((id) => !held.has(id));
}

export async function markReturnedInvoices(
  tx: Transaction,
  ids: readonly string[],
  now: Date,
): Promise<void> {
  await tx.execute(sql`insert into returned_invoice_records (record_id, received_at)
    select id, ${now.toISOString()} from verifactu_records
    where id in (select value from json_each(${JSON.stringify(ids)}))`);
}

export async function hasReturnedInvoices(tx: Transaction): Promise<boolean> {
  return (
    tx.get(sql`select 1 from returned_invoice_records m
    join verifactu_records r on r.id = m.record_id
    join nodes n on n.id = r.node_id join verifactu_identities s on s.id = r.sif_id
    limit 1`) !== undefined
  );
}

export async function returnedInvoices(
  tx: Transaction,
  request: ReturnedInvoicesQuery,
): Promise<ReturnedInvoicesPage> {
  const joins = sql`from returned_invoice_records m
    join verifactu_records r on r.id = m.record_id
    join nodes n on n.id = r.node_id join verifactu_identities s on s.id = r.sif_id`;
  const searching = request.search.trim() !== "";
  const matches = searching
    ? sql`with ranked as materialized (
        select r.id, waitron_search_rank(${request.search}, r.num_serie_factura,
          n.name, r.node_id, s.numero_instalacion, r.sif_id, r.id, r.sale_id,
          r.corrects_registro_id) as search_rank ${joins}
      ), matched as (select * from ranked where search_rank is not null)`
    : sql`with matched as (select r.id, 0 as search_rank ${joins})`;
  const total = tx.get<{ total: number }>(
    sql`${matches} select count(*) as total from matched`,
  )!.total;
  const page = Math.min(request.page, Math.max(0, Math.ceil(total / 50) - 1));
  const receivedSort =
    request.sortKey === "receivedAt"
      ? request.sortDirection === "ascending"
        ? sql`m.received_at asc,`
        : sql`m.received_at desc,`
      : sql``;
  const rows = tx.all<ReturnedInvoiceRecord & { breakdown: string | null }>(sql`
    ${matches}
    select r.id as recordId, r.sale_id as saleId, r.node_id as sourceNodeId,
      n.name as sourceName, r.sif_id as generationId, s.numero_instalacion as installation,
      r.secuencia as sequence, r.num_serie_factura as invoiceNumber,
      r.fecha_expedicion_factura as issueDate,
      case when r.tipo_registro = 'anulacion' then 'cancellation' else r.tipo_factura end as kind,
      case when r.tipo_registro = 'anulacion' then 'cancellation'
        when r.tipo_factura = 'F2' then 'simplified'
        when r.tipo_factura = 'F3' then 'replacement'
        when r.tipo_factura in ('R1', 'R2', 'R3', 'R4', 'R5') then 'correction'
        else 'invoice' end as category,
      r.corrects_registro_id as correctsRecordId, r.desglose as breakdown,
      r.importe_total as gross, r.cuota_total as tax, m.received_at as receivedAt
    ${joins} join matched on matched.id = r.id
    order by matched.search_rank, ${receivedSort} m.received_at desc, r.node_id asc, r.secuencia asc, r.id asc
    limit 50 offset ${page * 50}`);
  return {
    rows: rows.map(({ breakdown, ...row }) => ({ ...row, taxable: storedBases(breakdown) })),
    total,
    page,
    pageSize: 50,
  };
}

export function storedBases(breakdown: string | null): string | null {
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
