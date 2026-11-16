import { sql, type SQL } from "drizzle-orm";
import { formatInvoiceNumber } from "@waitron/core";
import type { Transaction } from "@waitron/db";
import { validatedRangeWindow } from "@waitron/reporting";
import { rawCentsToDecimal, type Decimal } from "@waitron/shared";
import { INVOICE_SEARCH } from "./orders-list.js";

export const TAX_OFFICE_KINDS = ["F1", "F2", "F3", "R4", "R5"] as const;
export type TaxOfficeKind = (typeof TAX_OFFICE_KINDS)[number];
export const TAX_OFFICE_PAGE_SIZE = 50;

export interface TaxOfficeCursor {
  at: string;
  id: string;
}

export interface TaxOfficeFilter {
  /** Venue calendar days, both inclusive. */
  issued: { from: string; to: string; timeZone: string };
  search?: string;
  /** Basis points. */
  rate?: number;
  /** Whole cents, matched against the total, any breakdown base or any breakdown VAT amount. */
  amount?: number;
  /** Calendar days, each inclusive; a sale's operation day is its supply day, else its issue day. */
  operation?: { from?: string; to?: string };
  kind?: TaxOfficeKind;
  after?: TaxOfficeCursor;
  limit: number;
}

export interface TaxOfficeInvoice {
  id: string;
  number: string;
  kind: TaxOfficeKind;
  issuedAt: string;
  issueDate: string;
  /** Null when it is the issue date. */
  operationDate: string | null;
  customerName: string | null;
  customerTaxId: string | null;
  vat: { rate: string; base: string; tax: string }[];
  total: Decimal;
  /** The corrected invoice of a corrective, or the tickets an F3 replaces. */
  corrects: string[];
  cancelledAt: string | null;
}

export interface TaxOfficePage {
  rows: TaxOfficeInvoice[];
  next: TaxOfficeCursor | null;
}

const BARE_NUMBER = /^\d{1,9}$/;

// The issue date as filed: the issue instant moved by the offset filed with it.
const ISSUE_DATE = sql`date(s.issued_at, printf('%+d minutes', s.issued_offset_minutes))`;

// As the filing types each record: a corrective is R4 when it names a customer (only a replacement
// of a full invoice does), else R5; a full invoice replacing tickets is F3; otherwise F1 when it
// names a customer, else F2. `tax-office-list.kinds.e2e.test.ts` pins one filed sale of each kind.
const KIND = sql`case
  when s.corrects_sale_id is not null
    then case when s.counterparty_tax_id is not null then 'R4' else 'R5' end
  when exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = s.id) then 'F3'
  when s.counterparty_tax_id is not null then 'F1'
  else 'F2' end`;

// The JSON breakdown holds decimal text; scaled and rounded, it compares exactly with whole units.
const scaled = (field: string) =>
  sql`cast(round(json_extract(b.value, ${`$.${field}`}) * 100) as integer)`;

function searchClause(search: string): SQL {
  const trimmed = search.trim();
  const invoice = INVOICE_SEARCH.exec(trimmed);
  if (invoice !== null)
    return sql`(sr.code = ${invoice[1]} collate nocase and s.invoice_number = ${Number(invoice[2])})`;
  const taxId = sql`upper(substr(s.counterparty_tax_id, 1, ${trimmed.length})) = upper(${trimmed})`;
  if (BARE_NUMBER.test(trimmed)) return sql`(s.invoice_number = ${Number(trimmed)} or ${taxId})`;
  return sql`(waitron_search_rank(${search}, s.counterparty_legal_name) is not null or ${taxId})`;
}

function filterClauses(filter: TaxOfficeFilter): SQL[] {
  const { from, to, timeZone } = filter.issued;
  const clauses = [
    validatedRangeWindow({
      fromBusinessDay: from,
      toBusinessDay: to,
      timeZone,
      dayCutover: "00:00",
      cutoverChanges: [],
    })(sql`s.issued_at`),
  ];
  if (filter.search !== undefined) clauses.push(searchClause(filter.search));
  if (filter.rate !== undefined)
    clauses.push(sql`exists (select 1 from json_each(s.vat_breakdown) b
      where ${scaled("rate")} = ${filter.rate})`);
  if (filter.amount !== undefined)
    clauses.push(sql`(s.total = ${filter.amount} or exists (select 1 from json_each(s.vat_breakdown) b
      where ${scaled("base")} = ${filter.amount} or ${scaled("tax")} = ${filter.amount}))`);
  const operationDate = sql`coalesce(s.supply_day, ${ISSUE_DATE})`;
  if (filter.operation?.from !== undefined)
    clauses.push(sql`${operationDate} >= ${filter.operation.from}`);
  if (filter.operation?.to !== undefined)
    clauses.push(sql`${operationDate} <= ${filter.operation.to}`);
  if (filter.kind !== undefined) clauses.push(sql`(${KIND}) = ${filter.kind}`);
  if (filter.after !== undefined) {
    const { at, id } = filter.after;
    clauses.push(sql`(s.issued_at < ${at} or (s.issued_at = ${at} and s.id < ${id}))`);
  }
  return clauses;
}

/** One page, newest first, then by id, so sales issued at the same instant keep one order. */
export function taxOfficeInvoicesSql(filter: TaxOfficeFilter): SQL {
  return sql`
    select s.id as id, sr.code as series_code, s.invoice_number as invoice_number,
      s.issued_at as issued_at, ${ISSUE_DATE} as issue_date, s.supply_day as supply_day,
      s.counterparty_legal_name as customer_name, s.counterparty_tax_id as customer_tax_id,
      s.vat_breakdown as vat_breakdown, cast(s.total as text) as total, ${KIND} as kind,
      cs.code as corrected_series, c.invoice_number as corrected_number,
      (select json_group_array(json_array(t.code, t.invoice_number))
         from (select xs.code as code, x.invoice_number as invoice_number
               from sale_substitutions sub
               join sales x on x.id = sub.substituted_sale_id
               join invoice_series xs on xs.id = x.series_id
               where sub.substitution_sale_id = s.id
               order by xs.code, x.invoice_number) t) as substituted,
      sv.voided_at as cancelled_at
    from sales s
    join invoice_series sr on sr.id = s.series_id
    left join sale_voids sv on sv.sale_id = s.id
    left join sales c on c.id = s.corrects_sale_id
    left join invoice_series cs on cs.id = c.series_id
    where ${sql.join(filterClauses(filter), sql` and `)}
    order by s.issued_at desc, s.id desc
    limit ${filter.limit + 1}`;
}

interface RawRow extends Record<string, unknown> {
  id: string;
  series_code: string;
  invoice_number: number;
  issued_at: string;
  issue_date: string;
  supply_day: string | null;
  customer_name: string | null;
  customer_tax_id: string | null;
  vat_breakdown: string;
  total: string;
  kind: TaxOfficeKind;
  corrected_series: string | null;
  corrected_number: number | null;
  substituted: string;
  cancelled_at: string | null;
}

function toInvoice(row: RawRow): TaxOfficeInvoice {
  const operationDate = row.supply_day ?? row.issue_date;
  const substituted = JSON.parse(row.substituted) as [string, number][];
  return {
    id: row.id,
    number: formatInvoiceNumber(row.series_code, row.invoice_number),
    kind: row.kind,
    issuedAt: row.issued_at,
    issueDate: row.issue_date,
    operationDate: operationDate === row.issue_date ? null : operationDate,
    customerName: row.customer_name,
    customerTaxId: row.customer_tax_id,
    vat: (JSON.parse(row.vat_breakdown) as TaxOfficeInvoice["vat"]).map(({ rate, base, tax }) => ({
      rate,
      base,
      tax,
    })),
    total: rawCentsToDecimal(row.total),
    corrects:
      row.corrected_series !== null && row.corrected_number !== null
        ? [formatInvoiceNumber(row.corrected_series, row.corrected_number)]
        : substituted.map(([code, number]) => formatInvoiceNumber(code, number)),
    cancelledAt: row.cancelled_at,
  };
}

export async function listTaxOfficeInvoices(
  tx: Transaction,
  filter: TaxOfficeFilter,
): Promise<TaxOfficePage> {
  const { rows: read } = await tx.execute<RawRow>(taxOfficeInvoicesSql(filter));
  const rows = read.slice(0, filter.limit).map(toInvoice);
  const last = rows.at(-1);
  return {
    rows,
    next:
      read.length > filter.limit && last !== undefined ? { at: last.issuedAt, id: last.id } : null,
  };
}
