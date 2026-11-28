import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import {
  correctivesOf,
  orderPlaceFactsSql,
  readPlacedOrders,
  readVenueClock,
  type OrderPlaceFacts,
  type Transaction,
  workingOrderLines,
} from "@waitron/db";
import { persons } from "@waitron/identity";
import { AppError, businessDayAt, businessDayBounds, rawCentsToDecimal } from "@waitron/shared";
import type { BillsQuery, BillRow, FindBillPage } from "./find-bill-types.js";
import { VENUE_SERVICE } from "./modules.js";
import type { OrderZoneCondition } from "./zone-access.js";
import { recordedTableNamesSql } from "./orders-list-places.js";
import { readPendingOff, type PendingOff } from "./pending-off-sql.js";
import "./errors.js";

type RawBill = {
  id: string;
  opened_at: string;
  order_number: number;
  party_id: string | null;
  bill_name: string | null;
  departed_tables: string | null;
  place?: string | null;
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

function findBillsRelation(off: PendingOff, inZones?: OrderZoneCondition): SQL {
  const zone = VENUE_SERVICE.orderZoneIdSql(sql`wo.id`);
  const active = sql`l.quantity - coalesce(cancelled.quantity, 0)`;
  // The part payments the bill's own ticket took off: their money was paid on the bill but is not
  // in the ticket's total, so the meal is that total with them added back.
  const takenOff = sql`(select coalesce(-sum(dl.line_gross), 0) from sale_lines dl
       where dl.sale_id = s.id and dl.deducts_sale_id is not null)`;
  // A payment that paid an advance holds what is left of the advance, as the Pay window counts it
  // (readBillAdvances): a give-back is a corrective of the advance, not a refund of the payment.
  const paymentHolds = sql`case when a.id is null
          then bp.applied - coalesce((select sum(br.applied_amount) from refunds br
            where br.bill_payment_id = bp.id and br.state = 'completed'),0)
          else a.total + coalesce((select sum(ac.total) from sales ac where ${correctivesOf(sql`ac`, sql`a.id`)}),0) end`;
  return sql`with facts as (
    select wo.id, wo.opened_at, wo.order_number, wo.party_id,
      case when ud.id is null then wo.bill_name else coalesce(wo.bill_name, wo.label) end as bill_name,
      wo.delivery_table_id,
      case when ud.id is not null then
        coalesce(p.table_names, ${recordedTableNamesSql(sql`wo.party_id`)}) end as departed_tables,
      wo.status as order_status,
      ${zone} as zone_id,
      s.id as sale_id, case when s.id is null then null else sr.code || '/' || s.invoice_number end as invoice_number,
      ud.recorded_at as departed_at,
      (select coalesce(sum(case
        when ${active} <= 0 then 0
        when l.count_as_portions = 0 or (${active}) % 1000 <> 0 then 1
        else (${active}) / 1000 end), 0)
       from working_order_lines l
       left join line_service_cancellations cancelled on cancelled.line_id = l.id
       where l.working_order_id = wo.id and l.parent_line_id is null) as item_count,
      coalesce(s.total + ${takenOff}, (select coalesce(sum(l.line_total),0) from working_order_lines l where l.working_order_id = wo.id) - ${off.of(sql`wo.id`)}) as total_cents,
      coalesce((select sum(c.total) from sales c where ${correctivesOf(sql`c`, sql`s.id`)}),0) as corrections,
      case when exists(select 1 from sale_settlements settled where settled.sale_id = s.id) then
        (select coalesce(sum(t.amount - t.tip_amount),0) from tenders t where t.sale_id = s.id)
        + ${takenOff}
        - (select coalesce(sum(tr.applied_amount),0) from refunds tr
          join tenders t on t.id = tr.tender_id
          join invoice_correction_refunds icr on icr.tender_refund_id = tr.id
          join invoice_corrections ic on ic.id = icr.invoice_correction_id
          where tr.sale_id = s.id and t.sale_id = s.id and tr.state = 'completed' and ic.state = 'filed')
      else (select coalesce(sum(${paymentHolds}),0)
        from bill_payments bp
        left join bill_advances ba on ba.bill_payment_id = bp.id
        left join sales a on a.id = ba.advance_sale_id
        where bp.working_order_id = wo.id and bp.state = 'received') end as paid_cents,
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
    left join sales s on s.working_order_id = wo.id
    left join invoice_series sr on sr.id = s.series_id
    left join unpaid_departures ud on ud.working_order_id = wo.id
    left join parties p on p.id = wo.party_id
    where (${inZones?.(sql`wo.id`) ?? sql`1`})
      and (wo.status in ('open','placed') or (wo.status = 'settled' and wo.party_id is null
        and wo.collected_at is null and exists(select 1 from working_order_lines wl join ticket_items ti on ti.working_order_line_id = wl.id where wl.working_order_id = wo.id)
        and not exists(select 1 from deferred_closures tc where tc.working_order_id = wo.id)))
  ), bills as (
    select f.*, z.name as zone_name,
      case when f.total_cents + f.corrections > 0
        and not exists(select 1 from bill_payments bp where bp.working_order_id = f.id and bp.state in ('pending','received'))
        then f.collection_candidate else null end as collection_status,
      max(0, f.total_cents + f.corrections - f.paid_cents) as owing_cents,
      case when f.order_status = 'settled' then 'paid-not-handed-over'
        when f.paid_cents > 0 then 'part-paid'
        when f.party_id is null and f.order_status = 'open' then 'held' else 'unpaid' end as state
    from facts f left join floor_zones z on z.id = f.zone_id
  )`;
}

function filtered(query: BillsQuery): SQL {
  const clauses = [sql`r.search_rank is not null`];
  const kinds: SQL[] = [];
  // Owed: the guests left with the bill unpaid. Not `collection_status`, which a part payment
  // clears. A departure always issues the invoice and places the bill; cancelling the bill abandons
  // its order.
  if (query.owed === true) kinds.push(sql`(r.departed_at is not null and r.owing_cents > 0)`);
  if (query.counter === true) kinds.push(sql`r.party_id is null`);
  if (kinds.length > 0) clauses.push(sql`(${sql.join(kinds, sql` or `)})`);
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
const selection = sql`r.id, r.opened_at, r.order_number, r.party_id, r.bill_name, r.zone_id, r.zone_name, r.item_count,
  cast(r.total_cents as text) as total_cents, cast(r.paid_cents as text) as paid_cents,
  cast(r.owing_cents as text) as owing_cents, r.state, r.invoice_number, r.departed_at,
  r.order_status, r.collection_status, r.departed_tables`;

async function projectBills(tx: Transaction, raw: RawBill[]): Promise<BillRow[]> {
  if (raw.length === 0) return [];
  const places = await readPlacedOrders(
    tx,
    raw.flatMap((row) => (row.place == null ? [row.id] : [])),
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
  const clock = await readVenueClock(tx);
  const dayStart = businessDayBounds(clock, businessDayAt(clock, new Date())).startAt;
  return raw.map((row) => {
    const { names, sittingWith } =
      row.place == null
        ? { names: places.get(row.id)!.places.names, sittingWith: places.get(row.id)!.sittingWith }
        : (JSON.parse(row.place) as OrderPlaceFacts);
    return {
      workingOrderId: row.id,
      openedAt: row.opened_at,
      orderNumber: row.order_number,
      label: row.bill_name,
      partyId: row.party_id,
      partyName: sittingWith,
      tables: row.departed_tables === null ? names : (JSON.parse(row.departed_tables) as string[]),
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
    };
  });
}

export async function readFindBills(
  tx: Transaction,
  query: BillsQuery,
  inZones?: OrderZoneCondition,
): Promise<FindBillPage<BillRow>> {
  const relation = findBillsRelation(await readPendingOff(tx), inZones);
  const place =
    query.q === "" && query.sort.key !== "tableName"
      ? sql`null`
      : orderPlaceFactsSql(sql`r.party_id`, sql`r.delivery_table_id`, {
          searchable: query.q !== "",
        });
  const tableText = sql`(select group_concat(value, ' ') from json_each(coalesce(r.departed_tables, r.place -> '$.names')))`;
  const searchTables = sql`(select group_concat(value, ' ') from json_each(coalesce(r.departed_tables, r.place -> '$.searchNames')))`;
  const partyName = sql`r.place ->> '$.sittingWith'`;
  const ranked = sql`${relation}, named as materialized (select r.*, ${place} as place from bills r),
    ranked as materialized (
      select r.*, coalesce(${tableText}, r.bill_name, ${partyName}) as table_key,
        ${query.q === "" ? sql`0` : sql`waitron_search_rank(${query.q}, r.bill_name, ${partyName}, ${searchTables}, cast(r.order_number as text), r.invoice_number)`} as search_rank
      from named r
    )`;
  const where = filtered(query);
  const { rows: counts } = await tx.execute<{ total: number }>(sql`${ranked}
    select count(*) as total from ranked r where ${where}`);
  const key = sorts[query.sort.key] ?? sorts.openedAt!;
  const direction = query.sort.direction === "ascending" ? sql`asc` : sql`desc`;
  const { rows: raw } = await tx.execute<RawBill>(sql`${ranked}
    select ${selection}, r.place from ranked r where ${where}
    order by r.search_rank, ${key} is null, ${key} ${direction}, r.id desc limit ${50} offset ${query.page * 50}`);
  return {
    rows: await projectBills(tx, raw),
    total: counts[0]!.total,
    page: query.page,
    pageSize: 50,
  };
}

export async function readFindBill(
  tx: Transaction,
  workingOrderId: string,
  inZones?: OrderZoneCondition,
): Promise<BillRow> {
  const { rows } = await tx.execute<RawBill>(
    sql`${findBillsRelation(await readPendingOff(tx), inZones)} select ${selection} from bills r where r.id = ${workingOrderId} limit 1`,
  );
  if (rows.length === 0) throw new AppError("working_order.not_found", { workingOrderId });
  return (await projectBills(tx, rows))[0]!;
}
