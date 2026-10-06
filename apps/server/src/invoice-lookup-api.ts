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
import { orderFilter, type OrderFilter } from "./zone-access.js";
import "./errors.js";

export interface InvoiceLookupRow {
  workingOrderId: string;
  invoiceNumber: string;
  issuedAt: string;
  customerName: string;
  total: string;
}

const INVOICE_LOOKUP_LIMIT = 20;

/** With `visible`, a page is read again past the invoices it hides until twenty show or none are left. */
async function lookUpInvoices(
  tx: Transaction,
  q: string,
  visible?: OrderFilter,
): Promise<InvoiceLookupRow[]> {
  const invoice = /^([^/\s]+)\s*\/\s*(\d{1,9})$/.exec(q);
  const pattern = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const search = invoice
    ? and(eq(invoiceSeries.code, invoice[1]!), eq(sales.invoiceNumber, Number(invoice[2])))
    : sql`${sales.counterpartyLegalName} like ${pattern} escape ${"\\"}`;
  const page = (offset: number) =>
    tx
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
      .limit(INVOICE_LOOKUP_LIMIT)
      .offset(offset);
  const rows: Awaited<ReturnType<typeof page>> = [];
  for (let offset = 0; ; offset += INVOICE_LOOKUP_LIMIT) {
    const read = await page(offset);
    const shown =
      visible === undefined ? undefined : await visible(read.map((row) => row.workingOrderId));
    rows.push(...read.filter((row) => shown === undefined || shown.has(row.workingOrderId)));
    if (
      visible === undefined ||
      rows.length >= INVOICE_LOOKUP_LIMIT ||
      read.length < INVOICE_LOOKUP_LIMIT
    )
      break;
  }
  return rows.slice(0, INVOICE_LOOKUP_LIMIT).map((row) => ({
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
      const session = await requireSession(deps, c);
      const q = c.req.query("q")?.trim() ?? "";
      if (q === "" || q.length > 100)
        throw new AppError("management.request_invalid", { field: "q" });
      const invoices = await withTransaction(deps.db, async (tx) =>
        lookUpInvoices(tx, q, await orderFilter(tx, deps.cfg, session.device.deviceProfileId)),
      );
      return c.json({ invoices });
    }),
  );
}
