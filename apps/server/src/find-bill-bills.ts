import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { type Transaction, workingOrderLines } from "@waitron/db";
import { persons } from "@waitron/identity";
import { readLocationClock } from "@waitron/reporting";
import { AppError, businessDayAt, businessDayBounds, rawCentsToDecimal } from "@waitron/shared";
import type { BillsQuery, BillRow, FindBillPage } from "./find-bill-types.js";
import { VENUE_SERVICE } from "./modules.js";
import { readPartyTables } from "./orders-list.js";
import type { TillConfig } from "./till-config.js";
import type { OrderZoneCondition } from "./zone-access.js";
import "./errors.js";

type RawBill = {
  id: string;
  opened_at: string;
  order_number: number;
  label: string | null;
  party_id: string | null;
  party_name: string | null;
  party_table_names: string | null;
  delivery_label: string | null;
  zone_id: string | null;
  zone_name: string | null;
  item_count: number;
  total_cents: string;
  paid_cents: string;
  owing_cents: string;
  state: BillRow["state"];
  invoice_number: string | null;
  departed_at: string | null;
  order_status: BillRow["orderStatus"];
  collection_status: BillRow["collectionStatus"];
};

export function findBillsRelation(cfg: TillConfig, inZones?: OrderZoneCondition): SQL {
  const zone = VENUE_SERVICE.orderZoneIdSql(cfg, sql`wo.id`);
  return sql`with facts as (
    select wo.id, wo.opened_at, wo.order_number, wo.label, wo.party_id,
      wo.status as order_status, p.name as party_name, p.table_names as party_table_names,
      coalesce(dt.label, wo.delivery_table_label) as delivery_label,
      ${zone} as zone_id,
      s.id as sale_id, case when s.id is null then null else sr.code || '/' || s.invoice_number end as invoice_number,
      ud.recorded_at as departed_at,
      (select count(*) from working_order_lines l where l.working_order_id = wo.id) as item_count,
      coalesce(s.total, (select coalesce(sum(l.line_total),0) from working_order_lines l where l.working_order_id = wo.id)) as total_cents,
      coalesce((select sum(c.total) from sales c where c.corrects_sale_id = s.id),0) as corrections,
      case when exists(select 1 from sale_settlements settled where settled.sale_id = s.id) then
        (select coalesce(sum(t.amount - t.tip_amount),0) from tenders t where t.sale_id = s.id)
      else (select coalesce(sum(bp.applied - coalesce((select sum(br.applied_amount) from bill_payment_refunds br
        where br.bill_payment_id = bp.id and br.state = 'completed'),0)),0)
        from bill_payments bp where bp.working_order_id = wo.id and bp.state = 'received') end as paid_cents,
      coalesce(
        (select group_concat(n.value, ' ') from json_each(p.table_names) n),
        (select group_concat(d.label, ' ') from party_tables pt join dining_tables d on d.id = pt.table_id where pt.party_id = wo.party_id),
        dt.label, wo.delivery_table_label) as table_text,
      (select group_concat(names.name, ' ') from
        (select distinct coalesce(person.display_name, l.credited_to) as name
          from working_order_lines l left join persons person on person.id = l.credited_to
          where l.working_order_id = wo.id and l.credited_to is not null order by name) names) as staff_key,
      case when wo.status = 'placed' and s.id is not null
        and not exists(select 1 from sale_voids v where v.sale_id = s.id)
        and not exists(select 1 from sale_settlements ss where ss.sale_id = s.id)
        then case when ud.id is null then 'waiting_for_payment' else 'left_without_paying' end
        else null end as collection_candidate
    from working_orders wo
    left join parties p on p.id = wo.party_id
    left join dining_tables dt on dt.id = wo.delivery_table_id
    left join sales s on s.working_order_id = wo.id
    left join invoice_series sr on sr.id = s.series_id
    left join unpaid_departures ud on ud.working_order_id = wo.id
    where wo.location_id = ${cfg.locationId} and (${inZones?.(sql`wo.id`) ?? sql`1`})
      and (wo.status in ('open','placed') or (wo.status = 'settled' and wo.party_id is null
        and wo.collected_at is null and exists(select 1 from ticket_items ti where ti.working_order_id = wo.id)))
  ), bills as (
    select f.*, z.name as zone_name,
      case when f.total_cents + f.corrections > 0
        and not exists(select 1 from bill_payments bp where bp.working_order_id = f.id and bp.state in ('pending','received'))
        then f.collection_candidate else null end as collection_status,
      coalesce(nullif(f.label,''), f.party_name, f.table_text) as table_key,
      max(0, f.total_cents + f.corrections - f.paid_cents) as owing_cents,
      case when f.order_status = 'settled' then 'paid-not-handed-over'
        when f.paid_cents > 0 then 'part-paid'
        when f.party_id is null and f.order_status = 'open' then 'held' else 'unpaid' end as state
    from facts f left join floor_zones z on z.id = f.zone_id
  )`;
}

function filtered(query: BillsQuery): SQL {
  const clauses = [sql`r.search_rank is not null`];
  if (query.zoneId !== undefined) clauses.push(sql`r.zone_id = ${query.zoneId}`);
  if (query.state !== undefined) clauses.push(sql`r.state = ${query.state}`);
  if (query.staffId !== undefined)
    clauses.push(sql`exists(select 1 from working_order_lines l
    where l.working_order_id = r.id and l.credited_to = ${query.staffId})`);
  return sql.join(clauses, sql` and `);
}

const sorts: Readonly<Record<string, SQL>> = {
  openedAt: sql`r.opened_at`,
  tableName: sql`r.table_key`,
  zone: sql`r.zone_name`,
  staff: sql`r.staff_key`,
  items: sql`r.item_count`,
  total: sql`r.total_cents`,
  paid: sql`r.paid_cents`,
  state: sql`r.state`,
};
const selection = sql`r.id, r.opened_at, r.order_number, r.label, r.party_id, r.party_name,
  r.party_table_names, r.delivery_label, r.zone_id, r.zone_name, r.item_count,
  cast(r.total_cents as text) as total_cents, cast(r.paid_cents as text) as paid_cents,
  cast(r.owing_cents as text) as owing_cents, r.state, r.invoice_number, r.departed_at,
  r.order_status, r.collection_status`;

async function projectBills(tx: Transaction, cfg: TillConfig, raw: RawBill[]): Promise<BillRow[]> {
  if (raw.length === 0) return [];
  const tables = await readPartyTables(
    tx,
    raw.flatMap((row) =>
      row.party_id === null || row.party_table_names !== null ? [] : [row.party_id],
    ),
  );
  const staff = await tx
    .selectDistinct({
      bill: workingOrderLines.workingOrderId,
      id: workingOrderLines.creditedTo,
      name: persons.displayName,
    })
    .from(workingOrderLines)
    .leftJoin(persons, eq(persons.id, workingOrderLines.creditedTo))
    .where(
      and(
        inArray(
          workingOrderLines.workingOrderId,
          raw.map((row) => row.id),
        ),
        isNotNull(workingOrderLines.creditedTo),
      ),
    )
    .orderBy(persons.displayName, workingOrderLines.creditedTo);
  const clock = await readLocationClock(tx, cfg.locationId);
  const dayStart = businessDayBounds(clock, businessDayAt(clock, new Date())).startAt;
  return raw.map((row) => ({
    workingOrderId: row.id,
    openedAt: row.opened_at,
    orderNumber: row.order_number,
    label: row.label,
    partyId: row.party_id,
    partyName: row.party_name,
    tables:
      row.party_id === null
        ? row.delivery_label === null
          ? []
          : [row.delivery_label]
        : row.party_table_names === null
          ? (tables.get(row.party_id) ?? [])
          : (JSON.parse(row.party_table_names) as string[]),
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    staff: staff
      .filter((person) => person.bill === row.id)
      .map((person) => ({ id: person.id!, name: person.name })),
    itemCount: row.item_count,
    total: rawCentsToDecimal(row.total_cents),
    paid: rawCentsToDecimal(row.paid_cents),
    stillOwed: rawCentsToDecimal(row.owing_cents),
    state: row.state,
    earlierDay: row.opened_at < dayStart,
    invoiceNumber: row.invoice_number,
    departedAt: row.departed_at,
    orderStatus: row.order_status,
    collectionStatus: row.collection_status,
  }));
}

export async function readFindBills(
  tx: Transaction,
  cfg: TillConfig,
  query: BillsQuery,
  inZones?: OrderZoneCondition,
): Promise<FindBillPage<BillRow>> {
  const relation = findBillsRelation(cfg, inZones);
  const ranked = sql`${relation}, ranked as materialized (
    select r.*, ${query.q === "" ? sql`0` : sql`waitron_search_rank(${query.q}, r.label, r.party_name, r.table_text, cast(r.order_number as text), r.invoice_number)`} as search_rank from bills r
  )`;
  const where = filtered(query);
  const { rows: counts } = await tx.execute<{ total: number; open_count: number }>(sql`${ranked}
    select (select count(*) from ranked r where ${where}) as total, (select count(*) from bills) as open_count`);
  const key = sorts[query.sort.key] ?? sorts.openedAt!;
  const direction = query.sort.direction === "ascending" ? sql`asc` : sql`desc`;
  const { rows: raw } = await tx.execute<RawBill>(sql`${ranked}
    select ${selection} from ranked r where ${where}
    order by r.search_rank, ${key} is null, ${key} ${direction}, r.id desc limit ${50} offset ${query.page * 50}`);
  return {
    rows: await projectBills(tx, cfg, raw),
    total: counts[0]!.total,
    openCount: counts[0]!.open_count,
    page: query.page,
    pageSize: 50,
  };
}

export async function readFindBill(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  inZones?: OrderZoneCondition,
): Promise<BillRow> {
  const { rows } = await tx.execute<RawBill>(
    sql`${findBillsRelation(cfg, inZones)} select ${selection} from bills r where r.id = ${workingOrderId} limit 1`,
  );
  if (rows.length === 0) throw new AppError("working_order.not_found", { workingOrderId });
  return (await projectBills(tx, cfg, rows))[0]!;
}
