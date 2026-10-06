import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
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
import { AppError, centsToDecimal } from "@waitron/shared";
import type { Logger } from "./logger.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import "./errors.js";

export interface InvoiceLookupRow {
  workingOrderId: string;
  invoiceNumber: string;
  issuedAt: string;
  customerName: string;
  total: string;
}

async function lookUpInvoices(tx: Transaction, q: string): Promise<InvoiceLookupRow[]> {
  const invoice = /^([^/\s]+)\s*\/\s*(\d{1,9})$/.exec(q);
  const pattern = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const search = invoice
    ? and(eq(invoiceSeries.code, invoice[1]!), eq(sales.invoiceNumber, Number(invoice[2])))
    : sql`${sales.counterpartyLegalName} like ${pattern} escape ${"\\"}`;
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
      and(
        eq(invoiceSeries.purpose, "full"),
        isNotNull(sales.counterpartyTaxId),
        isNotNull(sales.counterpartyLegalName),
        isNull(sales.correctsSaleId),
        isNull(saleSubstitutions.substitutionSaleId),
        search,
      ),
    )
    .orderBy(desc(sales.issuedAt), sql`"sales".rowid desc`)
    .limit(20);
  return rows.map((row) => ({
    workingOrderId: row.workingOrderId,
    invoiceNumber: formatInvoiceNumber(row.seriesCode, row.invoiceNumber),
    issuedAt: row.issuedAt,
    customerName: row.customerName!,
    total: centsToDecimal(row.total),
  }));
}

export function mountInvoiceLookupApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  app.get("/api/invoices/lookup", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const q = c.req.query("q")?.trim() ?? "";
      if (q === "" || q.length > 100)
        throw new AppError("management.request_invalid", { field: "q" });
      return c.json({ invoices: await withTransaction(deps.db, (tx) => lookUpInvoices(tx, q)) });
    }),
  );
}
