import { and, asc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { formatInvoiceNumber } from "@waitron/core";
import {
  billPaymentRefunds,
  billPayments,
  diningTables,
  invoiceSeries,
  parties,
  partyTables,
  saleLines,
  sales,
  tenders,
  unpaidDepartures,
  workingOrderLines,
  saleSubstitutions,
  receiptReprints,
  printJobs,
  printers,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { validatedRangeWindow } from "@waitron/reporting";
import {
  AppError,
  addDecimal,
  centsToDecimal,
  compareDecimal,
  rawCentsToDecimal,
  thousandthsToDecimal,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { outstandingOf, readPaymentsByBill } from "./bill-payments.js";
import { readIssuedSales } from "./sale-due.js";
import "./errors.js";

export const ORDER_STATUSES = [
  "open",
  "voided",
  "left_without_paying",
  "waiting_for_payment",
  "paid",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_FILTERS = ["all", ...ORDER_STATUSES, "unpaid"] as const;
export type OrderStatusFilter = (typeof ORDER_STATUS_FILTERS)[number];
export const DEFAULT_ORDER_PAGE_SIZE = 50;
export const MAX_ORDER_PAGE_SIZE = 200;
export interface OrderCursor {
  at: string;
  id: string;
}
export interface OrderListFilter {
  status: OrderStatusFilter;
  dates: "any" | { from: string; to: string; timeZone: string; dayCutover: string };
  credited: boolean;
  staffId?: string;
  table?: string;
  search?: string;
  limit: number;
  after?: OrderCursor;
  only?: string;
  collectable?: boolean;
  scope: "all" | { today: { from: string; to: string; timeZone: string; dayCutover: string } };
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
  creditNotes: string[];
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
  when wo.status = 'settled' or ss.id is not null then 'paid'
  else 'cancelled' end`;

const CORRECTIONS = sql`cast(coalesce((select sum(c.total) from sales c where c.corrects_sale_id = s.id), 0) as text)`;

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
    const { from, to, timeZone, dayCutover } = filter.scope.today;
    const today = validatedRangeWindow({
      fromBusinessDay: from,
      toBusinessDay: to,
      timeZone,
      dayCutover,
    })(sql`wo.opened_at`);
    return sql` and (wo.status in ('open', 'placed') or ${today})`;
  }
  return LIVE_FILTERS.includes(filter.status) ? sql` and wo.status in ('open', 'placed')` : sql``;
}

// Money columns are cast to text: `rawCentsToDecimal` refuses the number an uncast integer arrives as.
function rowsSql(filter: OrderListFilter): SQL {
  return sql`
  select 'bill' as kind, wo.id as id, wo.opened_at as at, wo.order_number as order_number, wo.label as label,
         wo.party_id as party_id, p.name as party_name, dd.label as delivery_label,
         s.id as sale_id, sr.code as series_code, s.invoice_number as invoice_number,
         cast(s.total as text) as sale_total,
         cast((select coalesce(sum(l.line_total), 0) from working_order_lines l where l.working_order_id = wo.id) as text) as lines_total,
         ${CORRECTIONS} as corrections, null as operator_id, null as operator_name,
         ${BILL_STATUS} as status, ud.recorded_at as departed_at
  from working_orders wo
  left join parties p on p.id = wo.party_id
  left join dining_tables dd on dd.id = wo.delivery_table_id
  left join sales s on s.working_order_id = wo.id
  left join invoice_series sr on sr.id = s.series_id
  left join sale_settlements ss on ss.sale_id = s.id
  left join sale_voids sv on sv.sale_id = s.id
  left join unpaid_departures ud on ud.working_order_id = wo.id
  where ${LISTED_BILL}${billScope(filter)}
  union all
  select 'sale', s.id, s.issued_at, null, null, null, null, null, s.id, sr.code, s.invoice_number,
         cast(s.total as text), '0', ${CORRECTIONS}, s.operator_id, op.display_name,
         case when sv.id is not null then 'voided' when ss.id is not null then 'paid' else 'waiting_for_payment' end,
         null
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
  sale_id: string | null;
  series_code: string | null;
  invoice_number: number | null;
  sale_total: string | null;
  lines_total: string;
  corrections: string;
  operator_id: string | null;
  operator_name: string | null;
  status: OrderStatus;
  departed_at: string | null;
  credited: number;
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * `A/12` names a series and a number. A bare number names that number in every series AND the bill
 * with that order number: the ticket shows the order number, and a bill sent under
 * ticket_then_pay has no invoice number yet.
 */
function searchClause(search: string): SQL {
  const invoice = /^([^/\s]+)\s*\/\s*(\d{1,9})$/.exec(search);
  const bare = /^\d{1,9}$/.test(search) ? Number(search) : undefined;
  if (invoice !== null || bare !== undefined) {
    const number = invoice !== null ? Number(invoice[2]) : bare!;
    const code = invoice !== null ? sql` and xs.code = ${invoice[1]} collate nocase` : sql``;
    const byInvoice = sql`exists (select 1 from sales x join invoice_series xs on xs.id = x.series_id
      where (x.id = r.sale_id or x.corrects_sale_id = r.sale_id) and x.invoice_number = ${number}${code})`;
    return bare === undefined
      ? byInvoice
      : sql`(${byInvoice} or (r.kind = 'bill' and r.order_number = ${bare}))`;
  }
  // LIKE folds ASCII letter case only; a non-ASCII letter matches in its own case.
  const pattern = likePattern(search);
  return sql`(r.party_name like ${pattern} escape '\\'
    or r.delivery_label like ${pattern} escape '\\'
    or exists (select 1 from party_tables pt join dining_tables dt on dt.id = pt.table_id
               where pt.party_id = r.party_id and dt.label like ${pattern} escape '\\'))`;
}

/** A bill credits its lines' staff; a billless sale credits the person who rang it. */
function staffClause(staffId: string): SQL {
  return sql`((r.kind = 'bill' and exists (select 1 from working_order_lines l
                 where l.working_order_id = r.id and l.credited_to = ${staffId}))
           or (r.kind = 'sale' and r.operator_id = ${staffId}))`;
}

function tableClause(table: string): SQL {
  return sql`(r.delivery_label = ${table} collate nocase
    or exists (select 1 from party_tables pt join dining_tables dt on dt.id = pt.table_id
               where pt.party_id = r.party_id and dt.label = ${table} collate nocase))`;
}

function filterClauses(filter: OrderListFilter): SQL[] {
  const clauses: SQL[] = [];
  if (filter.only !== undefined) clauses.push(sql`r.id = ${filter.only}`);
  // An invoice with no bill can be waiting for payment, but is outside a staff session's scope.
  if (filter.scope !== "all") {
    const { from, to, timeZone, dayCutover } = filter.scope.today;
    const today = validatedRangeWindow({
      fromBusinessDay: from,
      toBusinessDay: to,
      timeZone,
      dayCutover,
    })(sql`r.at`);
    clauses.push(
      sql`r.kind = 'bill' and (r.status in ('open', 'waiting_for_payment', 'left_without_paying') or ${today})`,
    );
  }
  if (filter.status === "unpaid")
    clauses.push(sql`r.status in ('waiting_for_payment', 'left_without_paying')`);
  else if (filter.status !== "all") clauses.push(sql`r.status = ${filter.status}`);
  if (filter.dates !== "any") {
    const { from, to, timeZone, dayCutover } = filter.dates;
    clauses.push(
      validatedRangeWindow({ fromBusinessDay: from, toBusinessDay: to, timeZone, dayCutover })(
        sql`r.at`,
      ),
    );
  }
  if (filter.credited)
    clauses.push(sql`exists (select 1 from sales c where c.corrects_sale_id = r.sale_id)`);
  if (filter.staffId !== undefined) clauses.push(staffClause(filter.staffId));
  if (filter.table !== undefined) clauses.push(tableClause(filter.table));
  if (filter.search !== undefined) clauses.push(searchClause(filter.search));
  if (filter.collectable === true) {
    clauses.push(sql`r.kind = 'bill'
      and (case when r.sale_id is not null
                then cast(r.sale_total as integer) + cast(r.corrections as integer)
                else cast(r.lines_total as integer) end) > 0
      and not exists (select 1 from bill_payments bp
                      where bp.working_order_id = r.id and bp.state in ('pending', 'received'))`);
  }
  if (filter.after !== undefined) {
    const { at, id } = filter.after;
    clauses.push(sql`(r.at < ${at} or (r.at = ${at} and r.id < ${id}))`);
  }
  return clauses;
}

/**
 * One page of rows, newest first by `at` then id. At most seven queries whatever the page holds:
 * the page, then the invoices' amounts due, payments before an invoice (two), credit-note numbers,
 * tables and staff, each for the whole page and each skipped when the page has nothing to ask.
 */
export function ordersPageSql(filter: OrderListFilter): SQL {
  const clauses = filterClauses(filter);
  const where = clauses.length === 0 ? sql`1` : sql.join(clauses, sql` and `);
  return sql`
    with r as (${rowsSql(filter)})
    select r.*, exists (select 1 from sales c where c.corrects_sale_id = r.sale_id) as credited
    from r where ${where}
    order by r.at desc, r.id desc
    limit ${filter.limit + 1}`;
}

export async function listOrders(tx: Transaction, filter: OrderListFilter): Promise<OrderPage> {
  const { rows: read } = await tx.execute<RawRow>(ordersPageSql(filter));
  const raw = read.slice(0, filter.limit);
  const last = raw[filter.limit - 1];
  const next = read.length > filter.limit ? { at: last!.at, id: last!.id } : null;

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
  const notes = await readCreditNotes(
    tx,
    raw.flatMap((row) => row.sale_id ?? []),
  );
  const tables = await readPartyTables(tx, [
    ...new Set(bills.flatMap((row) => row.party_id ?? [])),
  ]);
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
    return {
      kind: row.kind,
      id: row.id,
      at: row.at,
      orderNumber: row.order_number,
      label: row.label,
      partyId: row.party_id,
      partyName: row.party_name,
      tables:
        row.party_id !== null
          ? (tables.get(row.party_id) ?? [])
          : row.delivery_label !== null
            ? [row.delivery_label]
            : [],
      counter: row.party_id === null && row.delivery_label === null && row.kind === "bill",
      saleId: row.sale_id,
      invoiceNumber:
        row.sale_id === null ? null : formatInvoiceNumber(row.series_code!, row.invoice_number!),
      creditNotes: row.sale_id === null ? [] : (notes.get(row.sale_id) ?? []),
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
  return { rows, next };
}

async function readCreditNotes(
  tx: Transaction,
  saleIds: readonly string[],
): Promise<Map<string, string[]>> {
  const notes = new Map<string, string[]>();
  if (saleIds.length === 0) return notes;
  const rows = await tx
    .select({ of: sales.correctsSaleId, code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(inArray(sales.correctsSaleId, [...saleIds]))
    .orderBy(asc(sales.issuedAt), sql`${sales}.rowid`);
  for (const row of rows)
    notes.set(row.of!, [...(notes.get(row.of!) ?? []), formatInvoiceNumber(row.code, row.number)]);
  return notes;
}

/** Every table each party ever held, once each, in the order they joined it. */
async function readPartyTables(
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
    .orderBy(partyTables.joinedAt, partyTables.id);
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

export interface OrderLine {
  lineNo: number;
  name: string;
  variantName: string | null;
  quantity: Decimal;
  total: Decimal;
  listUnitPrice: Decimal | null;
  creditedTo: string | null;
}
export interface OrderInvoice {
  kind: "invoice" | "credit_note" | "substitution";
  number: string;
  issuedAt: string;
  total: Decimal;
  rungBy: string | null;
}
export interface OrderTender {
  method: string;
  amount: Decimal;
  tip: Decimal;
}
export interface OrderBillPayment {
  method: string;
  state: string;
  applied: Decimal;
  tip: Decimal;
  createdAt: string;
  refunds: { applied: Decimal; tip: Decimal; state: string; reason: string; createdAt: string }[];
}
export interface OrderParty {
  name: string | null;
  guestCount: number | null;
  openedAt: string;
  closedAt: string | null;
  openedBy: string | null;
  closedBy: string | null;
  tables: string[];
}
export interface OrderDeparture {
  recordedAt: string;
  reason: string;
  recordedBy: string | null;
  authorizedBy: string | null;
  amount: Decimal;
}
export interface OrderReprint {
  requestedAt: string;
  personId: string;
  personName: string | null;
  printerName: string;
}
export interface OrderDetail {
  row: OrderRow;
  lines: OrderLine[];
  invoices: OrderInvoice[];
  tenders: OrderTender[];
  payments: OrderBillPayment[];
  party: OrderParty | null;
  departure: OrderDeparture | null;
  reprints: OrderReprint[];
}

export async function readOrderDetail(
  tx: Transaction,
  id: string,
  scope: OrderListFilter["scope"],
): Promise<OrderDetail> {
  const { rows } = await listOrders(tx, {
    status: "all",
    dates: "any",
    credited: false,
    limit: 1,
    only: id,
    scope,
  });
  const row = rows[0];
  if (row === undefined) throw new AppError("working_order.not_found", { workingOrderId: id });
  return {
    row,
    lines: row.kind === "bill" ? await readBillLines(tx, id) : await readSaleLines(tx, id),
    invoices: row.saleId === null ? [] : await readInvoices(tx, row.saleId),
    tenders: row.saleId === null ? [] : await readTenders(tx, row.saleId),
    payments: row.kind === "bill" ? await readBillPayments(tx, id) : [],
    party: row.partyId === null ? null : await readParty(tx, row.partyId, row.tables),
    departure: row.kind === "bill" ? await readDeparture(tx, id) : null,
    reprints: row.saleId === null ? [] : await readReprints(tx, row.saleId),
  };
}

async function readBillLines(tx: Transaction, billId: string): Promise<OrderLine[]> {
  const rows = await tx
    .select({
      lineNo: workingOrderLines.lineNo,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      quantity: workingOrderLines.quantity,
      total: workingOrderLines.lineTotal,
      listUnitPrice: workingOrderLines.listUnitPriceGross,
      creditedTo: workingOrderLines.creditedTo,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
  return rows.map((line) => ({
    ...line,
    quantity: thousandthsToDecimal(line.quantity),
    total: centsToDecimal(line.total),
    listUnitPrice: line.listUnitPrice === null ? null : centsToDecimal(line.listUnitPrice),
  }));
}

async function readSaleLines(tx: Transaction, saleId: string): Promise<OrderLine[]> {
  const rows = await tx
    .select({
      lineNo: saleLines.lineNo,
      name: saleLines.name,
      variantName: saleLines.variantName,
      quantity: saleLines.quantity,
      total: saleLines.lineTotal,
      gross: saleLines.lineGross,
    })
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
  return rows.map((line) => ({
    lineNo: line.lineNo,
    name: line.name,
    variantName: line.variantName,
    quantity: thousandthsToDecimal(line.quantity),
    total: centsToDecimal(line.gross ?? line.total),
    listUnitPrice: null,
    creditedTo: null,
  }));
}

async function readInvoices(tx: Transaction, saleId: string): Promise<OrderInvoice[]> {
  const base = await tx
    .select({
      id: sales.id,
      number: sales.invoiceNumber,
      code: invoiceSeries.code,
      issuedAt: sales.issuedAt,
      total: sales.total,
      rungBy: persons.displayName,
    })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .leftJoin(persons, eq(persons.id, sales.operatorId))
    .where(eq(sales.id, saleId));
  const corrections = await tx
    .select({
      id: sales.id,
      number: sales.invoiceNumber,
      code: invoiceSeries.code,
      issuedAt: sales.issuedAt,
      total: sales.total,
      rungBy: persons.displayName,
    })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .leftJoin(persons, eq(persons.id, sales.operatorId))
    .where(eq(sales.correctsSaleId, saleId))
    .orderBy(sales.issuedAt, sales.id);
  const substitutes = await tx
    .select({
      id: sales.id,
      number: sales.invoiceNumber,
      code: invoiceSeries.code,
      issuedAt: sales.issuedAt,
      total: sales.total,
      rungBy: persons.displayName,
    })
    .from(saleSubstitutions)
    .innerJoin(sales, eq(sales.id, saleSubstitutions.substitutionSaleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .leftJoin(persons, eq(persons.id, sales.operatorId))
    .where(eq(saleSubstitutions.substitutedSaleId, saleId))
    .orderBy(sales.issuedAt, sales.id);
  return [
    ...base.map((invoice): OrderInvoice => ({
      kind: "invoice",
      number: formatInvoiceNumber(invoice.code, invoice.number),
      issuedAt: invoice.issuedAt,
      total: centsToDecimal(invoice.total),
      rungBy: invoice.rungBy,
    })),
    ...corrections.map((invoice): OrderInvoice => ({
      kind: "credit_note",
      number: formatInvoiceNumber(invoice.code, invoice.number),
      issuedAt: invoice.issuedAt,
      total: centsToDecimal(invoice.total),
      rungBy: invoice.rungBy,
    })),
    ...substitutes.map((invoice): OrderInvoice => ({
      kind: "substitution",
      number: formatInvoiceNumber(invoice.code, invoice.number),
      issuedAt: invoice.issuedAt,
      total: centsToDecimal(invoice.total),
      rungBy: invoice.rungBy,
    })),
  ];
}

async function readTenders(tx: Transaction, saleId: string): Promise<OrderTender[]> {
  const rows = await tx
    .select({ method: tenders.method, amount: tenders.amount, tip: tenders.tipAmount })
    .from(tenders)
    .where(eq(tenders.saleId, saleId))
    .orderBy(tenders.id);
  return rows.map((tender) => ({
    method: tender.method,
    amount: centsToDecimal(tender.amount),
    tip: centsToDecimal(tender.tip),
  }));
}

async function readBillPayments(tx: Transaction, billId: string): Promise<OrderBillPayment[]> {
  const payments = await tx
    .select({
      id: billPayments.id,
      method: billPayments.method,
      state: billPayments.state,
      applied: billPayments.applied,
      tip: billPayments.tip,
      createdAt: billPayments.createdAt,
    })
    .from(billPayments)
    .where(eq(billPayments.workingOrderId, billId))
    .orderBy(billPayments.createdAt, billPayments.id);
  if (payments.length === 0) return [];
  const refunds = await tx
    .select({
      billPaymentId: billPaymentRefunds.billPaymentId,
      applied: billPaymentRefunds.appliedAmount,
      tip: billPaymentRefunds.tipAmount,
      state: billPaymentRefunds.state,
      reason: billPaymentRefunds.reason,
      createdAt: billPaymentRefunds.createdAt,
    })
    .from(billPaymentRefunds)
    .where(
      inArray(
        billPaymentRefunds.billPaymentId,
        payments.map((payment) => payment.id),
      ),
    )
    .orderBy(billPaymentRefunds.createdAt, billPaymentRefunds.id);
  return payments.map((payment) => ({
    method: payment.method,
    state: payment.state,
    applied: centsToDecimal(payment.applied),
    tip: centsToDecimal(payment.tip),
    createdAt: payment.createdAt,
    refunds: refunds
      .filter((refund) => refund.billPaymentId === payment.id)
      .map((refund) => ({
        applied: centsToDecimal(refund.applied),
        tip: centsToDecimal(refund.tip),
        state: refund.state,
        reason: refund.reason,
        createdAt: refund.createdAt,
      })),
  }));
}

async function readParty(
  tx: Transaction,
  partyId: string,
  tables: string[],
): Promise<OrderParty | null> {
  const [party] = await tx
    .select({
      name: parties.name,
      guestCount: parties.guestCount,
      openedAt: parties.openedAt,
      closedAt: parties.closedAt,
      openedBy: parties.openedBy,
      closedBy: parties.closedBy,
    })
    .from(parties)
    .where(eq(parties.id, partyId));
  if (party === undefined) return null;
  const ids = [party.openedBy, party.closedBy].filter((id): id is string => id !== null);
  const names =
    ids.length === 0
      ? []
      : await tx
          .select({ id: persons.id, name: persons.displayName })
          .from(persons)
          .where(inArray(persons.id, ids));
  const nameOf = (id: string | null) => names.find((person) => person.id === id)?.name ?? null;
  return {
    name: party.name,
    guestCount: party.guestCount,
    openedAt: party.openedAt,
    closedAt: party.closedAt,
    openedBy: nameOf(party.openedBy),
    closedBy: nameOf(party.closedBy),
    tables,
  };
}

async function readDeparture(tx: Transaction, billId: string): Promise<OrderDeparture | null> {
  const [departure] = await tx
    .select({
      recordedAt: unpaidDepartures.recordedAt,
      reason: unpaidDepartures.reason,
      recordedBy: unpaidDepartures.recordedBy,
      authorizedBy: unpaidDepartures.authorizedBy,
      amount: unpaidDepartures.amount,
    })
    .from(unpaidDepartures)
    .where(eq(unpaidDepartures.workingOrderId, billId));
  if (departure === undefined) return null;
  const names = await tx
    .select({ id: persons.id, name: persons.displayName })
    .from(persons)
    .where(inArray(persons.id, [departure.recordedBy, departure.authorizedBy]));
  const nameOf = (id: string) => names.find((person) => person.id === id)?.name ?? null;
  return {
    recordedAt: departure.recordedAt,
    reason: departure.reason,
    recordedBy: nameOf(departure.recordedBy),
    authorizedBy: nameOf(departure.authorizedBy),
    amount: centsToDecimal(departure.amount),
  };
}

async function readReprints(tx: Transaction, saleId: string): Promise<OrderReprint[]> {
  const rows = await tx
    .select({
      requestedAt: receiptReprints.requestedAt,
      personId: receiptReprints.personId,
      personName: persons.displayName,
      printerName: printers.name,
    })
    .from(receiptReprints)
    .innerJoin(printJobs, eq(printJobs.id, receiptReprints.printJobId))
    .innerJoin(printers, eq(printers.id, printJobs.printerId))
    .leftJoin(persons, eq(persons.id, receiptReprints.personId))
    .where(eq(receiptReprints.saleId, saleId))
    .orderBy(receiptReprints.requestedAt, receiptReprints.id);
  return rows;
}
