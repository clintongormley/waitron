import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError, rawCentsToDecimal } from "@waitron/shared";
import { findBillsRelation } from "./find-bill-bills.js";
import { resolveFindBillDates } from "./find-bill-dates.js";
import type {
  DateWindow,
  TransactionRow,
  TransactionsPage,
  TransactionsQuery,
} from "./find-bill-types.js";
import type { TillConfig } from "./till-config.js";
import type { OrderZoneCondition } from "./zone-access.js";
import "./errors.js";

function scopeRelation(cfg: TillConfig, saleId?: string): SQL {
  return sql`with recursive invoice_scope(sale_id, source_sale_id) as (
    select s.id, s.id from sales s join nodes n on n.id = s.node_id
      where n.location_id = ${cfg.locationId} ${saleId === undefined ? sql`` : sql`and s.id = ${saleId}`}
    union
    select g.sale_id, s.corrects_sale_id from invoice_scope g join sales s on s.id = g.source_sale_id
      where s.corrects_sale_id is not null
    union
    select g.sale_id, ss.substituted_sale_id from invoice_scope g
      join sale_substitutions ss on ss.substitution_sale_id = g.source_sale_id
  ), scope_orders as (
    select distinct g.sale_id, s.working_order_id as order_id from invoice_scope g
      join sales s on s.id = g.source_sale_id where s.working_order_id is not null
  )`;
}

function scopeCondition(cfg: TillConfig, inZones?: OrderZoneCondition): SQL {
  // Every source matters: allowing one order must not reveal another order's invoice facts.
  return sql`not exists(select 1 from scope_orders so join working_orders wo on wo.id = so.order_id
    where so.sale_id = s.id and (wo.location_id <> ${cfg.locationId}
      or not (${inZones?.(sql`so.order_id`) ?? sql`1`})))`;
}

export function findTransactionsRelation(cfg: TillConfig, inZones?: OrderZoneCondition): SQL {
  return sql`${scopeRelation(cfg)}, tender_methods as (
    select distinct t.sale_id, t.method, case when t.method = 'card' then p.card_last4 else null end as last4
    from tenders t left join payments p on t.method = 'card'
      and p.state in ('captured','settled','accepted_offline','refunded','partially_refunded')
      and ((t.bill_payment_id is not null and p.bill_payment_id = t.bill_payment_id)
        or (t.bill_payment_id is null and p.bill_payment_id is null and p.sale_id = t.sale_id))
  ), order_labels as (
    select so.sale_id, wo.id as order_id, wo.label, p.name as party_name,
      coalesce((select group_concat(j.value, ', ') from json_each(p.table_names) j),
        (select group_concat(d.label, ', ') from party_tables pt join dining_tables d on d.id = pt.table_id
          where pt.party_id = wo.party_id), dt.label, wo.delivery_table_label) as table_names
    from scope_orders so join working_orders wo on wo.id = so.order_id
    left join parties p on p.id = wo.party_id left join dining_tables dt on dt.id = wo.delivery_table_id
  ), invoices as (
    select s.id, s.working_order_id, s.issued_at, sr.code as series_code, s.invoice_number as number,
      sr.code || '/' || s.invoice_number as invoice_number,
      case when s.corrects_sale_id is not null then 'correction'
        when s.counterparty_tax_id is not null then 'full-invoice' else 'sale' end as type,
      s.counterparty_legal_name as customer_name, s.operator_id, person.display_name as staff_name,
      s.total as amount_cents,
      (select json_group_array(so.order_id) from
        (select order_id from scope_orders where sale_id = s.id order by order_id) so) as scope_order_ids,
      (select group_concat(o.name, ', ') from
        (select distinct coalesce(nullif(label,''),party_name,table_names) as name
          from order_labels where sale_id = s.id order by name) o) as table_name,
      (select group_concat(coalesce(o.label,'') || ' ' || coalesce(o.party_name,'') || ' ' || coalesce(o.table_names,''), ' ')
        from order_labels o where o.sale_id = s.id) as order_search,
      (select json_group_array(json_object('method',m.method,'last4',m.last4)) from
        (select method,last4 from tender_methods where sale_id = s.id order by method,last4) m) as methods,
      (select group_concat(m.method || coalesce(m.last4,''), ' ') from
        (select method,last4 from tender_methods where sale_id = s.id order by method,last4) m) as method_key,
      (select group_concat(m.last4,' ') from tender_methods m where m.sale_id = s.id) as card_search
    from sales s join nodes n on n.id = s.node_id join invoice_series sr on sr.id = s.series_id
    left join persons person on person.id = s.operator_id
    where n.location_id = ${cfg.locationId} and ${scopeCondition(cfg, inZones)}
      and not exists(select 1 from sale_voids v where v.sale_id = s.id)
      and (s.corrects_sale_id is not null or s.counterparty_tax_id is not null
        or exists(select 1 from sale_settlements ss where ss.sale_id = s.id))
  ), refund_rows as (
    select r.*, (select p.card_last4 from payments p
      where p.provider = r.provider and p.payment_ref = r.provider_payment_ref) as last4
    from tender_refunds r where r.state = 'completed'
  ), transactions as (
    select i.*, i.id as sale_id, null as refund_id from invoices i
    union all
    select r.id, i.working_order_id, r.completed_at, i.series_code, i.number, i.invoice_number,
      'refund', i.customer_name, r.requested_by, person.display_name,
      -(r.applied_amount + r.tip_amount), i.scope_order_ids, i.table_name, i.order_search,
      json_array(json_object('method',r.method,'last4',r.last4)),
      r.method || coalesce(r.last4,''), r.last4, i.id, r.id
    from refund_rows r join invoices i on i.id = r.sale_id
    left join persons person on person.id = r.requested_by
  )`;
}

function filtered(query: TransactionsQuery, dates: DateWindow): SQL {
  const clauses = [sql`r.search_rank is not null`];
  if (dates !== null)
    clauses.push(sql`r.issued_at >= ${dates.startAt} and r.issued_at < ${dates.endAt}`);
  if (query.method !== undefined)
    clauses.push(
      sql`exists(select 1 from json_each(r.methods) m where json_extract(m.value,'$.method') = ${query.method})`,
    );
  if (query.type !== undefined) clauses.push(sql`r.type = ${query.type}`);
  if (query.staffId !== undefined) clauses.push(sql`r.operator_id = ${query.staffId}`);
  return sql.join(clauses, sql` and `);
}

const sorts: Readonly<Record<string, SQL>> = {
  when: sql`r.issued_at`,
  invoice: sql`r.series_code`,
  type: sql`r.type`,
  tableName: sql`r.table_name`,
  method: sql`r.method_key`,
  staff: sql`r.staff_name`,
  amount: sql`r.amount_cents`,
};
type RawTransaction = {
  id: string;
  sale_id: string;
  refund_id: string | null;
  working_order_id: string | null;
  issued_at: string;
  invoice_number: string;
  type: TransactionRow["type"];
  table_name: string | null;
  customer_name: string | null;
  operator_id: string | null;
  staff_name: string | null;
  amount_cents: string;
  scope_order_ids: string;
  methods: string;
};

export async function readFindTransactions(
  tx: Transaction,
  cfg: TillConfig,
  query: TransactionsQuery,
  inZones?: OrderZoneCondition,
): Promise<TransactionsPage> {
  const dates = resolveFindBillDates(
    await readLocationClock(tx, cfg.locationId),
    query.dates,
    new Date(),
  );
  const ranked = sql`${findTransactionsRelation(cfg, inZones)}, ranked as materialized (
    select r.*, ${query.q === "" ? sql`0` : sql`waitron_search_rank(${query.q},r.invoice_number,r.customer_name,r.order_search,r.card_search)`} as search_rank from transactions r
  )`;
  const where = filtered(query, dates);
  const { rows: counts } = await tx.execute<{ total: number }>(
    sql`${ranked} select count(*) as total from ranked r where ${where}`,
  );
  const { rows: open } = await tx.execute<{ total: number }>(
    sql`${findBillsRelation(cfg, inZones)} select count(*) as total from bills`,
  );
  const key = sorts[query.sort.key] ?? sorts.when!;
  const direction = query.sort.direction === "ascending" ? sql`asc` : sql`desc`;
  const { rows } = await tx.execute<RawTransaction>(sql`${ranked}
    select r.id,r.sale_id,r.refund_id,r.working_order_id,r.issued_at,r.invoice_number,r.type,r.table_name,r.customer_name,
      r.operator_id,r.staff_name,cast(r.amount_cents as text) as amount_cents,r.scope_order_ids,r.methods
    from ranked r where ${where} order by r.search_rank, ${key} is null, ${key} ${direction},
      ${query.sort.key === "invoice" ? sql`r.number ${direction},` : sql``} r.id desc
    limit ${50} offset ${query.page * 50}`);
  return {
    rows: rows.map((row) => ({
      transactionId: `${row.refund_id === null ? "sale" : "refund"}:${row.id}`,
      refundId: row.refund_id,
      saleId: row.sale_id,
      workingOrderId: row.working_order_id,
      scopeOrderIds: JSON.parse(row.scope_order_ids) as string[],
      issuedAt: row.issued_at,
      invoiceNumber: row.invoice_number,
      type: row.type,
      tableName: row.table_name,
      customerName: row.customer_name,
      methods: JSON.parse(row.methods) as TransactionRow["methods"],
      staff: row.operator_id === null ? null : { id: row.operator_id, name: row.staff_name },
      amount: rawCentsToDecimal(row.amount_cents),
    })),
    total: counts[0]!.total,
    openCount: open[0]!.total,
    page: query.page,
    pageSize: 50,
    dates,
  };
}

export async function resolveTransactionScope(
  tx: Transaction,
  cfg: TillConfig,
  saleId: string,
): Promise<{ workingOrderIds: string[]; locationId: string }> {
  const { rows } = await tx.execute<{
    location_id: string;
    order_ids: string;
  }>(sql`${scopeRelation(cfg, saleId)}
    select n.location_id,(select json_group_array(o.order_id) from
      (select order_id from scope_orders where sale_id=s.id order by order_id) o) as order_ids
    from sales s join nodes n on n.id=s.node_id
    where s.id=${saleId} and n.location_id=${cfg.locationId} and ${scopeCondition(cfg)}`);
  if (rows.length === 0) throw new AppError("sale.not_found", { saleId });
  return {
    locationId: rows[0]!.location_id,
    workingOrderIds: JSON.parse(rows[0]!.order_ids) as string[],
  };
}
