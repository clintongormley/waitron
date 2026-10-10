import { and, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { Hono } from "hono";
import { formatInvoiceNumber } from "@waitron/core";
import {
  invoiceSeries,
  sales,
  saleSubstitutions,
  workingOrders,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { AppError, centsToDecimal, rawCentsToDecimal } from "@waitron/shared";
import type { Logger } from "./logger.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import { orderZoneCondition, type OrderZoneCondition } from "./zone-access.js";
import "./errors.js";

export interface InvoiceLookupRow {
  workingOrderId: string;
  invoiceNumber: string;
  issuedAt: string;
  customerName: string;
  total: string;
}

const INVOICE_LOOKUP_LIMIT = 20;

type RankedInvoiceRow = {
  working_order_id: string;
  series_code: string;
  invoice_number: number;
  issued_at: string;
  customer_name: string;
  total: string;
};

export async function lookUpInvoices(
  tx: Transaction,
  q: string,
  inZones?: OrderZoneCondition,
): Promise<InvoiceLookupRow[]> {
  const filedFull = (search?: SQL) =>
    and(
      eq(invoiceSeries.purpose, "full"),
      isNotNull(sales.counterpartyTaxId),
      isNotNull(sales.counterpartyLegalName),
      isNull(sales.correctsSaleId),
      isNull(saleSubstitutions.substitutionSaleId),
      search,
      inZones?.(sql`${workingOrders.id}`),
    );
  const invoice = /^([^/\s]+)\s*\/\s*(\d{1,9})$/.exec(q.trim());
  if (invoice) {
    const rows = await tx
      .select({
        workingOrderId: workingOrders.id,
        seriesCode: invoiceSeries.code,
        invoiceNumber: sales.invoiceNumber,
        issuedAt: sales.issuedAt,
        customerName: sales.counterpartyLegalName,
        total: sales.total,
      })
      .from(workingOrders)
      .innerJoin(sales, eq(sales.workingOrderId, workingOrders.id))
      .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
      .leftJoin(saleSubstitutions, eq(saleSubstitutions.substitutionSaleId, sales.id))
      .where(
        filedFull(
          and(eq(invoiceSeries.code, invoice[1]!), eq(sales.invoiceNumber, Number(invoice[2]))),
        ),
      )
      .orderBy(desc(sales.issuedAt), sql`"sales".rowid desc`)
      .limit(INVOICE_LOOKUP_LIMIT);
    return rows.map((row) => ({
      workingOrderId: row.workingOrderId,
      invoiceNumber: formatInvoiceNumber(row.seriesCode, row.invoiceNumber),
      issuedAt: row.issuedAt,
      customerName: row.customerName!,
      total: centsToDecimal(row.total),
    }));
  }
  // Materialized so the matcher runs once per row rather than once in the filter and again in the
  // sort. Drizzle wraps the embedded select in its own parentheses.
  const ranked = tx
    .select({
      workingOrderId: sql`${workingOrders.id}`.as("working_order_id"),
      seriesCode: sql`${invoiceSeries.code}`.as("series_code"),
      invoiceNumber: sql`${sales.invoiceNumber}`.as("invoice_number"),
      issuedAt: sql`${sales.issuedAt}`.as("issued_at"),
      customerName: sql`${sales.counterpartyLegalName}`.as("customer_name"),
      total: sql`cast(${sales.total} as text)`.as("total"),
      saleRowid: sql`"sales".rowid`.as("sale_rowid"),
      searchRank: sql`waitron_search_rank(${q}, ${sales.counterpartyLegalName})`.as("search_rank"),
    })
    .from(workingOrders)
    .innerJoin(sales, eq(sales.workingOrderId, workingOrders.id))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .leftJoin(saleSubstitutions, eq(saleSubstitutions.substitutionSaleId, sales.id))
    .where(filedFull());
  const { rows } = await tx.execute<RankedInvoiceRow>(sql`
    with r as materialized ${ranked}
    select working_order_id, series_code, invoice_number, issued_at, customer_name, total
    from r where search_rank is not null
    order by search_rank, issued_at desc, sale_rowid desc
    limit ${INVOICE_LOOKUP_LIMIT}`);
  return rows.map((row) => ({
    workingOrderId: row.working_order_id,
    invoiceNumber: formatInvoiceNumber(row.series_code, row.invoice_number),
    issuedAt: row.issued_at,
    customerName: row.customer_name,
    total: rawCentsToDecimal(row.total),
  }));
}

export function mountInvoiceLookupApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  app.get("/api/invoices/lookup", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const q = c.req.query("q") ?? "";
      const typed = q.trim().length;
      if (typed === 0 || typed > 100)
        throw new AppError("management.request_invalid", { field: "q" });
      const invoices = await withTransaction(deps.db, async (tx) =>
        lookUpInvoices(
          tx,
          q,
          await orderZoneCondition(tx, deps.cfg, session.device.deviceProfileId),
        ),
      );
      return c.json({ invoices });
    }),
  );
}
