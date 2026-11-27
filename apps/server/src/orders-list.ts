import type { BusinessDayClock } from "@waitron/shared";
import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { formatInvoiceNumber } from "@waitron/core";
import { correctivesOf, diningTables, partyTables, workingOrderLines } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { validatedRangeWindow } from "@waitron/reporting";
import {
  AppError,
  addDecimal,
  centsToDecimal,
  compareDecimal,
  rawCentsToDecimal,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { FILTER_TEXT_MAX } from "./find-bill-query.js";
import { outstandingOf } from "./bill-payment-money.js";
import { readPaymentsByBill } from "./bill-payment-rows.js";
import { readIssuedSales } from "./sale-due.js";
import {
  LIVE_ORDER_PLACE,
  liveSearchTableNames,
  ordersWordRank,
  readOrderListPlaces,
} from "./orders-list-places.js";
import "./errors.js";

export const ORDER_STATUSES = [
  "open",
  "voided",
  "left_without_paying",
  "waiting_for_payment",
  "paid",
  "deferred_payment",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_FILTERS = ["all", ...ORDER_STATUSES, "unpaid"] as const;
export type OrderStatusFilter = (typeof ORDER_STATUS_FILTERS)[number];
export const DEFAULT_ORDER_PAGE_SIZE = 50;
export interface OrderCursor {
  /** The row's search rank key; present exactly when the list is searched by words. */
  rank?: number;
  at: string;
  id: string;
}
export interface OrderListFilter {
  status: OrderStatusFilter;
  dates: "any" | ({ from: string; to: string } & BusinessDayClock);
  credited: boolean;
  staffId?: string;
  table?: string;
  search?: string;
  limit: number;
  after?: OrderCursor;
  only?: string;
  collectable?: boolean;
  /** A further condition on a bill's order id; an invoice with no bill never passes it. */
  orderIn?: (orderId: SQL) => SQL;
  scope: "all" | { today: { from: string; to: string } & BusinessDayClock };
}
export interface OrderRow {
  kind: "bill" | "sale";
  id: string;
  at: string;
  orderNumber: number | null;
  label: string | null;
  partyId: string | null;
  partyName: string | null;
  tables: string[];
  counter: boolean;
  saleId: string | null;
  invoiceNumber: string | null;
  invoiceType: "F1" | "F2" | null;
  correctives: string[];
  status: OrderStatus;
  credited: "in_full" | "in_part" | null;
  total: Decimal;
  stillOwed: Decimal | null;
  staff: { id: string; name: string | null }[];
  departedAt: string | null;
}
export interface OrderPage {
  rows: OrderRow[];
  next: OrderCursor | null;
}
export interface OrderTableRequest {
  page: number;
  sortKey: "" | "opened" | "invoice" | "total";
  sortDirection: "ascending" | "descending";
}

const ZERO = centsToDecimal(0);
const OWING: readonly OrderStatus[] = ["open", "waiting_for_payment", "left_without_paying"];

/** An empty bill that was never sent leaves no order to show. */
const LISTED_BILL = sql`(wo.status <> 'abandoned'
  or exists (select 1 from order_amendments oa where oa.working_order_id = wo.id and oa.kind = 'order_placed')
  or exists (select 1 from working_order_lines l where l.working_order_id = wo.id))`;

/**
 * A void does not change the bill status, so it wins before Waiting for payment. A cancel settles
 * the invoice it credits, so an abandoned bill wins before Paid.
 */
const BILL_STATUS = sql`case
  when wo.status = 'open' then 'open'
  when sv.id is not null then 'voided'
  when wo.status = 'abandoned' then 'cancelled'
  when ud.id is not null and ss.id is null and wo.status = 'placed' then 'left_without_paying'
  when wo.status = 'placed' and ss.id is null then 'waiting_for_payment'
  when tc.id is not null then 'deferred_payment'
  when wo.status = 'settled' or ss.id is not null then 'paid'
  else 'cancelled' end`;

const CORRECTIONS = sql`cast(coalesce((select sum(c.total) from sales c where ${correctivesOf(sql`c`, sql`s.id`)}), 0) as text)`;
const CREDITED = sql`exists (select 1 from sales c where ${correctivesOf(sql`c`, sql`r.sale_id`)})`;

/** The statuses that only an `open` or `placed` bill can have (BILL_STATUS above). */
const LIVE_FILTERS: readonly OrderStatusFilter[] = [
  "open",
  "waiting_for_payment",
  "left_without_paying",
  "unpaid",
];

/**
 * Filtering the bill half by its stored status lets the status index serve unfinished reads;
 * the derived status still decides which rows are returned.
 */
function billScope(filter: OrderListFilter): SQL {
  if (filter.scope !== "all") {
    const { from, to, timeZone, dayCutover, cutoverChanges } = filter.scope.today;
    const today = validatedRangeWindow({
      fromBusinessDay: from,
      toBusinessDay: to,
      timeZone,
      dayCutover,
      cutoverChanges,
    })(sql`wo.opened_at`);
    return sql` and (wo.status in ('open', 'placed') or ${today})`;
  }
  return LIVE_FILTERS.includes(filter.status) ? sql` and wo.status in ('open', 'placed')` : sql``;
}

// Money columns are cast to text: `rawCentsToDecimal` refuses the number an uncast integer arrives as.
function rowsSql(filter: OrderListFilter): SQL {
  return sql`
  select 'bill' as kind, wo.id as id, wo.opened_at as at, wo.order_number as order_number, wo.label as label,
         wo.party_id as party_id, p.name as party_name, coalesce(dd.label, wo.delivery_table_label) as delivery_label,
         s.id as sale_id, sr.code as series_code, s.invoice_number as invoice_number,
         s.counterparty_tax_id as counterparty_tax_id,
         cast(s.total as text) as sale_total,
         cast((select coalesce(sum(l.line_total), 0) from working_order_lines l where l.working_order_id = wo.id) as text) as lines_total,
         ${CORRECTIONS} as corrections, null as operator_id, null as operator_name,
         ${BILL_STATUS} as status, ud.recorded_at as departed_at, p.table_names as party_table_names, wo.bill_name, wo.delivery_table_id
  from working_orders wo
  left join parties p on p.id = wo.party_id
  left join dining_tables dd on dd.id = wo.delivery_table_id
  left join sales s on s.working_order_id = wo.id
  left join invoice_series sr on sr.id = s.series_id
  left join sale_settlements ss on ss.sale_id = s.id
  left join sale_voids sv on sv.sale_id = s.id
  left join unpaid_departures ud on ud.working_order_id = wo.id
  left join deferred_closures tc on tc.working_order_id = wo.id
  where ${LISTED_BILL}${billScope(filter)}
  union all
  select 'sale', s.id, s.issued_at, null, null, null, null, null, s.id, sr.code, s.invoice_number,
         s.counterparty_tax_id,
         cast(s.total as text), '0', ${CORRECTIONS}, s.operator_id, op.display_name,
         case when sv.id is not null then 'voided' when ss.id is not null then 'paid' else 'waiting_for_payment' end,
         null, null, null, null
  from sales s
  join invoice_series sr on sr.id = s.series_id
  left join sale_settlements ss on ss.sale_id = s.id
  left join sale_voids sv on sv.sale_id = s.id
  left join persons op on op.id = s.operator_id
  where s.working_order_id is null and s.corrects_sale_id is null
    and not exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = s.id)`;
}

interface RawRow extends Record<string, unknown> {
  kind: "bill" | "sale";
  id: string;
  at: string;
  order_number: number | null;
  label: string | null;
  party_id: string | null;
  party_name: string | null;
  delivery_label: string | null;
  bill_name: string | null;
  delivery_table_id: string | null;
  sale_id: string | null;
  series_code: string | null;
  invoice_number: number | null;
  counterparty_tax_id: string | null;
  sale_total: string | null;
  lines_total: string;
  corrections: string;
  operator_id: string | null;
  operator_name: string | null;
  status: OrderStatus;
  departed_at: string | null;
  /** A closed party's kept table names, as JSON text; null for an open party. */
  party_table_names: string | null;
  credited: number;
  search_rank?: number;
}

/** A series code and an invoice number, as in `A/12`. */
export const INVOICE_SEARCH = /^([^/\s]+)\s*\/\s*(\d{1,9})$/;
const BARE_NUMBER = /^\d{1,9}$/;
export { FILTER_TEXT_MAX };

/** Untrimmed, because a trailing space finishes the last word; blank and length are judged trimmed. */
export function optionalSearch(raw: string | undefined, field = "q"): string | undefined {
  const typed = raw?.trim().length ?? 0;
  if (typed > FILTER_TEXT_MAX) throw new AppError("management.request_invalid", { field });
  return typed === 0 ? undefined : raw;
}

/** As `optionalSearch`, refusing a missing or blank search. */
export function requiredSearch(raw: string | undefined): string {
  const search = optionalSearch(raw);
  if (search === undefined) throw new AppError("management.request_invalid", { field: "q" });
  return search;
}

/** `A/12` or a bare number: searched as that number exactly, not as words. */
export function isNumberSearch(search: string): boolean {
  const trimmed = search.trim();
  return INVOICE_SEARCH.test(trimmed) || BARE_NUMBER.test(trimmed);
}

/** The text a word search hands the matcher, untrimmed; undefined when the list is not searched by words. */
function wordSearch(filter: OrderListFilter): string | undefined {
  const { search } = filter;
  return search === undefined || search.trim() === "" || isNumberSearch(search)
    ? undefined
    : search;
}

/**
 * `A/12` names a series and a number. A bare number names that number in every series AND the bill
 * with that order number: the ticket shows the order number, and a bill sent under
 * ticket_then_pay has no invoice number yet. The number may be the bill's own invoice, a corrective
 * of it, or a corrective of its replacement.
 */
function numberClause(search: string): SQL {
  const trimmed = search.trim();
  const invoice = INVOICE_SEARCH.exec(trimmed);
  const bare = BARE_NUMBER.test(trimmed) ? Number(trimmed) : undefined;
  const number = invoice !== null ? Number(invoice[2]) : bare!;
  const code = invoice !== null ? sql` and xs.code = ${invoice[1]} collate nocase` : sql``;
  const byInvoice = sql`exists (select 1 from sales x join invoice_series xs on xs.id = x.series_id
    where (x.id = r.sale_id or x.corrects_sale_id = r.sale_id
      or x.corrects_sale_id in (select y.id from sales y where y.corrects_sale_id = r.sale_id and y.replaces_original = 1))
      and x.invoice_number = ${number}${code})`;
  return bare === undefined
    ? byInvoice
    : sql`(${byInvoice} or (r.kind = 'bill' and r.order_number = ${bare}))`;
}

/** A bill credits its lines' staff; a billless sale credits the person who rang it. */
function staffClause(staffId: string): SQL {
  return sql`((r.kind = 'bill' and exists (select 1 from working_order_lines l
                 where l.working_order_id = r.id and l.credited_to = ${staffId}))
           or (r.kind = 'sale' and r.operator_id = ${staffId}))`;
}

function tableClause(table: string): SQL {
  return sql`case when ${LIVE_ORDER_PLACE} then exists (select 1 from json_each(${liveSearchTableNames})
    where value = ${table} collate nocase) else (r.delivery_label = ${table} collate nocase
    or exists (select 1 from party_tables pt join dining_tables dt on dt.id = pt.table_id
               where pt.party_id = r.party_id and dt.label = ${table} collate nocase)
    or exists (select 1 from json_each(r.party_table_names) n where n.value = ${table} collate nocase)) end`;
}

function filterClauses(filter: OrderListFilter): SQL[] {
  const clauses: SQL[] = [];
  if (filter.only !== undefined) clauses.push(sql`r.id = ${filter.only}`);
  // An invoice with no bill can be waiting for payment, but is outside a staff session's scope.
  if (filter.scope !== "all") {
    const { from, to, timeZone, dayCutover, cutoverChanges } = filter.scope.today;
    const today = validatedRangeWindow({
      fromBusinessDay: from,
      toBusinessDay: to,
      timeZone,
      dayCutover,
      cutoverChanges,
    })(sql`r.at`);
    clauses.push(
      sql`r.kind = 'bill' and (r.status in ('open', 'waiting_for_payment', 'left_without_paying') or ${today})`,
    );
  }
  if (filter.status === "unpaid")
    clauses.push(sql`r.status in ('waiting_for_payment', 'left_without_paying')`);
  else if (filter.status !== "all") clauses.push(sql`r.status = ${filter.status}`);
  if (filter.dates !== "any") {
    const { from, to, timeZone, dayCutover, cutoverChanges } = filter.dates;
    clauses.push(
      validatedRangeWindow({
        fromBusinessDay: from,
        toBusinessDay: to,
        timeZone,
        dayCutover,
        cutoverChanges,
      })(sql`r.at`),
    );
  }
  if (filter.credited) clauses.push(CREDITED);
  if (filter.staffId !== undefined) clauses.push(staffClause(filter.staffId));
  if (filter.table !== undefined) clauses.push(tableClause(filter.table));
  if (filter.search !== undefined && isNumberSearch(filter.search))
    clauses.push(numberClause(filter.search));
  if (filter.collectable === true) {
    clauses.push(sql`r.kind = 'bill'
      and (case when r.sale_id is not null
                then cast(r.sale_total as integer) + cast(r.corrections as integer)
                else cast(r.lines_total as integer) end) > 0
      and not exists (select 1 from bill_payments bp
                      where bp.working_order_id = r.id and bp.state in ('pending', 'received'))`);
  }
  if (filter.orderIn !== undefined)
    clauses.push(sql`(r.kind = 'bill' and (${filter.orderIn(sql`r.id`)}))`);
  return clauses;
}

function cursorClause(after: OrderCursor, ranked: boolean): SQL {
  const { at, id } = after;
  const newer = sql`(r.at < ${at} or (r.at = ${at} and r.id < ${id}))`;
  if (!ranked) return newer;
  const { rank } = after;
  // Bound as a number: SQLite sorts every number below every text.
  if (typeof rank !== "number")
    throw new AppError("management.request_invalid", { field: "after" });
  return sql`(r.search_rank > ${rank} or (r.search_rank = ${rank} and ${newer}))`;
}

function whereOf(clauses: SQL[]): SQL {
  return clauses.length === 0 ? sql`1` : sql.join(clauses, sql` and `);
}

/**
 * One page of rows: closest match first when searched by words, then newest first by `at`, then
 * by id. At most seven queries whatever the page holds: the page, then the invoices' amounts due,
 * payments before an invoice (two), corrective numbers, tables and staff, each for the whole page
 * and each skipped when the page has nothing to ask.
 */
export function ordersPageSql(filter: OrderListFilter): SQL {
  const clauses = filterClauses(filter);
  const words = wordSearch(filter);
  if (words === undefined) {
    if (filter.after !== undefined) clauses.push(cursorClause(filter.after, false));
    return sql`
    with r as (${rowsSql(filter)})
    select r.*, ${CREDITED} as credited
    from r where ${whereOf(clauses)}
    order by r.at desc, r.id desc
    limit ${filter.limit + 1}`;
  }
  // The other filters run before the matcher, so it ranks only the rows they keep; `ranked` is
  // materialized so each kept row is ranked once.
  const rankedClauses = [sql`r.search_rank is not null`];
  if (filter.after !== undefined) rankedClauses.push(cursorClause(filter.after, true));
  return sql`
    with base as (${rowsSql(filter)}),
    ranked as materialized (
      select r.*, ${ordersWordRank(words)} as search_rank
      from base r where ${whereOf(clauses)}
    )
    select r.*, ${CREDITED} as credited
    from ranked r where ${whereOf(rankedClauses)}
    order by r.search_rank, r.at desc, r.id desc
    limit ${filter.limit + 1}`;
}

export async function listOrders(tx: Transaction, filter: OrderListFilter): Promise<OrderPage> {
  const { rows: read } = await tx.execute<RawRow>(ordersPageSql(filter));
  const raw = read.slice(0, filter.limit);
  const last = raw[filter.limit - 1];
  const next =
    read.length > filter.limit
      ? {
          ...(wordSearch(filter) === undefined ? {} : { rank: Math.trunc(last!.search_rank!) }),
          at: last!.at,
          id: last!.id,
        }
      : null;

  return { rows: await hydrateOrderRows(tx, raw), next };
}

export function ordersTableSql(
  filter: OrderListFilter,
  request: OrderTableRequest,
  count = false,
): SQL {
  const words = wordSearch(filter);
  const matches =
    words === undefined
      ? sql`with r as (${rowsSql(filter)}), matched as (select r.* from r where ${whereOf(filterClauses(filter))})`
      : sql`with base as (${rowsSql(filter)}), ranked as materialized (
        select r.*, ${ordersWordRank(words)} as search_rank
        from base r where ${whereOf(filterClauses(filter))}
      ), matched as (select r.* from ranked r where r.search_rank is not null)`;
  if (count) return sql`${matches} select count(*) as total from matched`;
  const direction = request.sortDirection === "ascending" ? sql`asc` : sql`desc`;
  const sorts = {
    "": sql``,
    opened: sql`r.at ${direction},`,
    invoice: sql`r.invoice_number is null, r.series_code collate nocase ${direction}, r.invoice_number ${direction},`,
    total: sql`cast(coalesce(r.sale_total, r.lines_total) as integer) ${direction},`,
  };
  return sql`${matches} select r.*, ${CREDITED} as credited from matched r
    order by ${words === undefined ? sql`` : sql`r.search_rank,`}
      ${sorts[request.sortKey]} r.at desc, r.id desc
    limit ${DEFAULT_ORDER_PAGE_SIZE} offset ${request.page * DEFAULT_ORDER_PAGE_SIZE}`;
}

export async function listOrdersTablePage(
  tx: Transaction,
  filter: OrderListFilter,
  request: OrderTableRequest,
): Promise<{ rows: OrderRow[]; total: number; page: number; pageSize: number }> {
  const { rows: counts } = await tx.execute<{ total: number }>(
    ordersTableSql(filter, request, true),
  );
  const total = counts[0]!.total;
  const page = Math.min(request.page, Math.max(0, Math.ceil(total / DEFAULT_ORDER_PAGE_SIZE) - 1));
  const { rows: raw } = await tx.execute<RawRow>(ordersTableSql(filter, { ...request, page }));
  return { rows: await hydrateOrderRows(tx, raw), total, page, pageSize: DEFAULT_ORDER_PAGE_SIZE };
}

async function hydrateOrderRows(tx: Transaction, raw: RawRow[]): Promise<OrderRow[]> {
  const bills = raw.filter((row) => row.kind === "bill");
  const owing = bills.filter((row) => OWING.includes(row.status));
  // Awaited in turn: they share one transaction (CLAUDE.md §3).
  const issued = await readIssuedSales(
    tx,
    owing.filter((row) => row.sale_id !== null).map((row) => row.id),
  );
  const uninvoiced = owing.filter((row) => row.sale_id === null).map((row) => row.id);
  const { received } =
    uninvoiced.length === 0
      ? { received: new Map<string, Decimal>() }
      : await readPaymentsByBill(tx, uninvoiced);
  const correctives = await readCorrectiveNumbers(
    tx,
    raw.flatMap((row) => row.sale_id ?? []),
  );
  const live = (row: RawRow) => row.status === "open" || row.status === "waiting_for_payment";
  const places = await readOrderListPlaces(
    tx,
    bills.flatMap((row) =>
      live(row) || (row.party_id !== null && row.party_table_names === null)
        ? [{ id: row.id, live: live(row) }]
        : [],
    ),
  );
  const staff = await readStaff(
    tx,
    bills.map((row) => row.id),
  );

  const rows = raw.map((row): OrderRow => {
    const total = rawCentsToDecimal(row.sale_id === null ? row.lines_total : row.sale_total!);
    const net = addDecimal(total, rawCentsToDecimal(row.corrections));
    let owed: Decimal | null = null;
    if (OWING.includes(row.status)) {
      owed =
        row.kind === "sale"
          ? net
          : row.sale_id !== null
            ? issued.get(row.id)!.amountDue
            : outstandingOf(total, received.get(row.id));
    }
    const currentPlace = row.kind === "bill" && live(row);
    return {
      kind: row.kind,
      id: row.id,
      at: row.at,
      orderNumber: row.order_number,
      label: currentPlace ? row.bill_name : row.label,
      partyId: row.party_id,
      partyName: currentPlace ? places.get(row.id)!.partyName : row.party_name,
      tables: currentPlace
        ? places.get(row.id)!.names
        : row.party_table_names !== null
          ? (JSON.parse(row.party_table_names) as string[])
          : (places.get(row.id)?.names ??
            (row.delivery_label === null ? [] : [row.delivery_label])),
      counter:
        row.party_id === null &&
        row.kind === "bill" &&
        (currentPlace ? row.delivery_table_id === null : row.delivery_label === null),
      saleId: row.sale_id,
      invoiceNumber:
        row.sale_id === null ? null : formatInvoiceNumber(row.series_code!, row.invoice_number!),
      invoiceType: row.sale_id === null ? null : row.counterparty_tax_id === null ? "F2" : "F1",
      correctives: row.sale_id === null ? [] : (correctives.get(row.sale_id) ?? []),
      status: row.status,
      credited:
        row.credited === 1 ? (compareDecimal(net, ZERO) === 0 ? "in_full" : "in_part") : null,
      total,
      stillOwed: owed !== null && compareDecimal(owed, ZERO) > 0 ? owed : null,
      staff:
        row.kind === "sale"
          ? row.operator_id === null
            ? []
            : [{ id: row.operator_id, name: row.operator_name }]
          : (staff.get(row.id) ?? []),
      departedAt: row.departed_at,
    };
  });
  return rows;
}

/**
 * The formatted numbers of each sale's correctives (`correctivesOf`: never its replacement, and
 * its replacement's own), oldest first, keyed by the sale.
 */
export async function readCorrectiveNumbers(
  tx: Transaction,
  saleIds: readonly string[],
): Promise<Map<string, string[]>> {
  const correctives = new Map<string, string[]>();
  if (saleIds.length === 0) return correctives;
  const { rows } = await tx.execute<{ of: string; code: string; number: number }>(sql`
    select s.id as of, sr.code as code, c.invoice_number as number
    from sales s
    join sales c on ${correctivesOf(sql`c`, sql`s.id`)}
    join invoice_series sr on sr.id = c.series_id
    where s.id in (${sql.join(
      saleIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    order by c.issued_at, c.rowid`);
  for (const row of rows)
    correctives.set(row.of, [
      ...(correctives.get(row.of) ?? []),
      formatInvoiceNumber(row.code, row.number),
    ]);
  return correctives;
}

/**
 * The names of every table each party holds or held, once each, in the order the party joined
 * them; a party with no `party_tables` row has no entry. A closing party stores this list
 * (`closePartyTables`), which the order list then reads in its place.
 */
export async function readPartyTables(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, string[]>> {
  const tables = new Map<string, string[]>();
  if (partyIds.length === 0) return tables;
  const rows = await tx
    .select({ partyId: partyTables.partyId, label: diningTables.label })
    .from(partyTables)
    .innerJoin(diningTables, eq(diningTables.id, partyTables.tableId))
    .where(inArray(partyTables.partyId, [...partyIds]))
    .orderBy(partyTables.joinedAt, sql`${partyTables}.rowid`);
  for (const row of rows) {
    const held = tables.get(row.partyId) ?? [];
    if (!held.includes(row.label)) tables.set(row.partyId, [...held, row.label]);
  }
  return tables;
}

type Person = { id: string; name: string | null };

/** A missing person row does not erase credit for their work. */
async function readStaff(
  tx: Transaction,
  billIds: readonly string[],
): Promise<Map<string, Person[]>> {
  const staff = new Map<string, Person[]>();
  if (billIds.length === 0) return staff;
  const rows = await tx
    .selectDistinct({
      bill: workingOrderLines.workingOrderId,
      id: workingOrderLines.creditedTo,
      name: persons.displayName,
    })
    .from(workingOrderLines)
    .leftJoin(persons, eq(persons.id, workingOrderLines.creditedTo))
    .where(
      and(
        inArray(workingOrderLines.workingOrderId, [...billIds]),
        isNotNull(workingOrderLines.creditedTo),
      ),
    )
    .orderBy(persons.displayName, workingOrderLines.creditedTo);
  for (const row of rows)
    staff.set(row.bill, [...(staff.get(row.bill) ?? []), { id: row.id!, name: row.name }]);
  return staff;
}

/**
 * Staff credited on a bill or a billless sale remain available in the filter even if their
 * account has since been removed.
 */
export async function listOrderStaff(tx: Transaction): Promise<Person[]> {
  const { rows } = await tx.execute<{ id: string; name: string | null }>(sql`
    select x.id as id, p.display_name as name
    from (select credited_to as id from working_order_lines where credited_to is not null
          union
          select operator_id from sales
          where working_order_id is null and corrects_sale_id is null and operator_id is not null) x
    left join persons p on p.id = x.id
    order by p.display_name is null, p.display_name, x.id`);
  return rows;
}
