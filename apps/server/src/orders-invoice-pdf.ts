import "./errors.js";
import { eq } from "drizzle-orm";
import { invoicePdfDownloads, invoiceSeries, sales, type Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { textGrid, type EscSetting } from "@waitron/printing";
import { AppError, deviceOrigin } from "@waitron/shared";
import { readInvoiceDocument, readReceiptEmailDocument } from "./invoice-document.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { previewPrintJob } from "./print-job-preview.js";
import { DEFAULT_PRINTER } from "./receipt-preview-api.js";
import { layOutSaleReceipt, resolveReceiptPrinter } from "./receipt-print.js";
import { renderTicketPdf } from "./ticket-pdf.js";
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
  const fileName = await recordDownload(tx, sale, personId);
  return { document: { ...document, duplicate: true }, fileName };
}

export type SaleCopy = { fileName: string } & (
  | { kind: "invoice"; document: ReceiptDocumentInput }
  | { kind: "ticket"; bytes: Uint8Array; printer: EscSetting }
);

/**
 * Any issued sale as a duplicate in its original format, with the download recorded: a sale naming
 * no customer (an F2 or R5) as its selling device's receipt printer lays it out now, any other on
 * A4. An unknown id is `invoice_delivery.not_found`.
 */
export async function readSaleCopy(
  tx: Transaction,
  deps: { backend: FiscalBackend; tradingContext: TradingContext },
  saleId: string,
  personId: string,
): Promise<SaleCopy> {
  const [sale] = await tx
    .select({
      id: sales.id,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
      taxId: sales.counterpartyTaxId,
      deviceId: sales.deviceId,
    })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.id, saleId));
  if (sale === undefined) throw new AppError("invoice_delivery.not_found", {});
  if (sale.taxId === null) {
    const printer =
      (sale.deviceId === null
        ? undefined
        : await resolveReceiptPrinter(tx, deviceOrigin(sale.deviceId))) ?? DEFAULT_PRINTER;
    const bytes = await layOutSaleReceipt(
      deps.backend,
      tx,
      deps.tradingContext,
      saleId,
      true,
      printer,
    );
    // Past the decoder's limits the ticket cannot be drawn whole, so it falls back to A4.
    const { widthDots } = textGrid(printer.paperWidth, printer.resolution);
    if (!previewPrintJob(bytes, { widthDots }).truncated) {
      return { kind: "ticket", bytes, printer, fileName: await recordDownload(tx, sale, personId) };
    }
  }
  const document = await readReceiptEmailDocument(deps.backend, tx, deps.tradingContext, saleId);
  const fileName = await recordDownload(tx, sale, personId);
  return { kind: "invoice", document: { ...document, duplicate: true }, fileName };
}

export function renderSaleCopy(copy: SaleCopy): Promise<Buffer> {
  return copy.kind === "ticket"
    ? renderTicketPdf(copy.bytes, copy.printer)
    : renderInvoicePdf(copy.document);
}

async function recordDownload(
  tx: Transaction,
  sale: { id: string; code: string; number: number },
  personId: string,
): Promise<string> {
  await tx.insert(invoicePdfDownloads).values({ saleId: sale.id, personId });
  return invoicePdfFileName(sale.code, sale.number);
}
