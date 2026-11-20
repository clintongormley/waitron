import "./errors.js";
import { eq } from "drizzle-orm";
import { invoicePdfDownloads, invoiceSeries, sales, type Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import type { EscSetting } from "@waitron/printing";
import { AppError, deviceOrigin } from "@waitron/shared";
import { readInvoiceDocument, readReceiptEmailDocument } from "./invoice-document.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { DEFAULT_PRINTER, layOutSaleReceipt, resolveReceiptPrinter } from "./receipt-print.js";
import { renderTicketPdf, ticketDrawing, type TicketDrawing } from "./ticket-pdf.js";
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
  await recordDownload(tx, sale.id, personId);
  return {
    document: { ...document, duplicate: true },
    fileName: invoicePdfFileName(sale.code, sale.number),
  };
}

/** The receipt printer a device's tickets are laid out for, or `undefined` for none. */
export type ReceiptPrinterOf = (
  tx: Transaction,
  deviceId: string,
) => Promise<EscSetting | undefined>;

const readReceiptPrinter: ReceiptPrinterOf = (tx, deviceId) =>
  resolveReceiptPrinter(tx, deviceOrigin(deviceId));

/** `readReceiptPrinter` answering each device from its first answer: for one download, where a
 * month's tickets come from a handful of devices. */
export function rememberedReceiptPrinters(): ReceiptPrinterOf {
  const known = new Map<string, EscSetting | undefined>();
  return async (tx, deviceId) => {
    if (known.has(deviceId)) return known.get(deviceId);
    const printer = await readReceiptPrinter(tx, deviceId);
    known.set(deviceId, printer);
    return printer;
  };
}

export type SaleCopy = { code: string; number: number } & (
  { kind: "invoice"; document: ReceiptDocumentInput } | { kind: "ticket"; drawing: TicketDrawing }
);

/** `copyOfSale` with the download recorded. */
export async function readSaleCopy(
  tx: Transaction,
  deps: { backend: FiscalBackend; tradingContext: TradingContext },
  saleId: string,
  personId: string,
): Promise<SaleCopy> {
  const copy = await copyOfSale(tx, deps, saleId);
  await recordDownload(tx, saleId, personId);
  return copy;
}

/**
 * Any issued sale as a duplicate in its original format: a sale naming no customer (an F2 or R5)
 * as the receipt printer `receiptPrinterOf` gives for its selling device lays it out (else
 * `DEFAULT_PRINTER`), or on A4 when
 * that ticket cannot be drawn whole on one page (past the decoder's limits, or taller than a PDF
 * page may be); any other on A4. An unknown id is `invoice_delivery.not_found`.
 */
export async function copyOfSale(
  tx: Transaction,
  deps: { backend: FiscalBackend; tradingContext: TradingContext },
  saleId: string,
  receiptPrinterOf: ReceiptPrinterOf = readReceiptPrinter,
): Promise<SaleCopy> {
  const [sale] = await tx
    .select({
      id: sales.id,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
      taxId: sales.counterpartyTaxId,
      deviceId: sales.deviceId,
      issuedAt: sales.issuedAt,
    })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.id, saleId));
  if (sale === undefined) throw new AppError("invoice_delivery.not_found", {});
  const named = { code: sale.code, number: sale.number };
  if (sale.taxId === null) {
    const printer =
      (sale.deviceId === null ? undefined : await receiptPrinterOf(tx, sale.deviceId)) ??
      DEFAULT_PRINTER;
    const bytes = await layOutSaleReceipt(
      deps.backend,
      tx,
      deps.tradingContext,
      saleId,
      true,
      printer,
      null,
    );
    const drawing = ticketDrawing(bytes, printer, new Date(sale.issuedAt));
    if (drawing !== undefined) return { kind: "ticket", drawing, ...named };
  }
  const document = await readReceiptEmailDocument(deps.backend, tx, deps.tradingContext, saleId);
  return { kind: "invoice", document: { ...document, duplicate: true }, ...named };
}

export function renderSaleCopy(copy: SaleCopy): Promise<Buffer> {
  return copy.kind === "ticket" ? renderTicketPdf(copy.drawing) : renderInvoicePdf(copy.document);
}

async function recordDownload(tx: Transaction, saleId: string, personId: string): Promise<void> {
  await tx.insert(invoicePdfDownloads).values({ saleId, personId });
}
