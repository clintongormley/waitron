import "./errors.js";
import { eq } from "drizzle-orm";
import { invoicePdfDownloads, invoiceSeries, sales, type Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import { readInvoiceDocument, readReceiptEmailDocument } from "./invoice-document.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import type { TradingContext } from "./trading-context.js";

/** A series code may hold `/`; anything outside this set is replaced so the name stays one path
 * segment and needs no escaping inside a quoted header value. */
export function invoicePdfFileName(code: string, number: number): string {
  return `${code.replace(/[^A-Za-z0-9_.-]/g, "_")}-${number}.pdf`;
}

/** The bill's full invoice as a duplicate, with the download recorded; writes no delivery row. */
export async function readInvoiceForDownload(
  tx: Transaction,
  deps: { backend: FiscalBackend; tradingContext: TradingContext },
  billId: string,
  personId: string,
): Promise<{ document: ReceiptDocumentInput; fileName: string }> {
  const [sale] = await tx
    .select({ id: sales.id, code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.workingOrderId, billId));
  if (sale === undefined) throw new AppError("working_order.not_found", { workingOrderId: billId });
  const document = await readInvoiceDocument(deps.backend, tx, deps.tradingContext, sale.id);
  return recordDownload(tx, sale, document, personId);
}

/** Any issued sale, simplified tickets and correctives included, as a duplicate, with the
 * download recorded; an unknown id is `invoice_delivery.not_found`. */
export async function readSaleForDownload(
  tx: Transaction,
  deps: { backend: FiscalBackend; tradingContext: TradingContext },
  saleId: string,
  personId: string,
): Promise<{ document: ReceiptDocumentInput; fileName: string }> {
  const document = await readReceiptEmailDocument(deps.backend, tx, deps.tradingContext, saleId);
  const [sale] = await tx
    .select({ id: sales.id, code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.id, saleId));
  return recordDownload(tx, sale!, document, personId);
}

async function recordDownload(
  tx: Transaction,
  sale: { id: string; code: string; number: number },
  document: ReceiptDocumentInput,
  personId: string,
): Promise<{ document: ReceiptDocumentInput; fileName: string }> {
  await tx.insert(invoicePdfDownloads).values({ saleId: sale.id, personId });
  return {
    document: { ...document, duplicate: true },
    fileName: invoicePdfFileName(sale.code, sale.number),
  };
}
