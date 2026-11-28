import "./errors.js";
import { and, desc, eq } from "drizzle-orm";
import { formatInvoiceNumber } from "@waitron/core";
import { invoiceDeliveries, invoiceSeries, printJobs, sales, type Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { centsToDecimal } from "@waitron/shared";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import { readInvoiceDeliveries, type InvoiceDeliveryAttempt } from "./invoice-delivery-status.js";
import { optionalDocument } from "./optional-document.js";
import { deviceMayPrintReceipts, enqueueOriginalReceipt } from "./receipt-print.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import type { DeviceRequestConfig } from "./trading-context.js";

/** How the original went out: its sent delivery, else a printed receipt original, else its newest
 * delivery; null when nothing of it was ever sent or tried but on untracked paper. */
async function originalWay(tx: Transaction, originalSaleId: string) {
  const rows = await tx
    .select({
      medium: invoiceDeliveries.medium,
      status: invoiceDeliveries.status,
      recipient: invoiceDeliveries.recipient,
      printerId: invoiceDeliveries.printerId,
    })
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.saleId, originalSaleId))
    .orderBy(desc(invoiceDeliveries.generation));
  const sent = rows.find((row) => row.status === "sent");
  if (sent !== undefined) return sent;
  const [printed] = await tx
    .select({ id: printJobs.id })
    .from(printJobs)
    .where(
      and(
        eq(printJobs.saleId, originalSaleId),
        eq(printJobs.kind, "document"),
        eq(printJobs.receiptCopy, false),
        eq(printJobs.status, "done"),
      ),
    )
    .limit(1);
  return printed === undefined ? (rows[0] ?? null) : null;
}

/**
 * Sends the corrective full invoice `correctiveSaleId` of `correction` once (request key
 * `corrective:<id>`), the way its original went, under the person who opened the correction: by
 * email to the same address, on the same A4 printer (recorded failed when it is switched off), else
 * on the receipt printer of `cfg`'s device when its profile may print receipts. A failure to send
 * leaves the filing as it is.
 */
export async function sendFiledCorrective(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: DeviceRequestConfig,
  correction: { id: string; originalSaleId: string; requestedBy: string },
  correctiveSaleId: string,
): Promise<void> {
  await optionalDocument(tx, "sendFiledCorrective", correctiveSaleId, async () => {
    const requestKey = `corrective:${correction.id}`;
    const personId = correction.requestedBy;
    const way = await originalWay(tx, correction.originalSaleId);
    if (way?.medium === "email" && way.recipient !== null) {
      await reserveInvoiceDelivery(tx, correctiveSaleId, {
        requestKey,
        personId,
        medium: "email",
        recipient: way.recipient,
      });
      return;
    }
    if (way?.medium === "a4" && way.printerId !== null) {
      await reserveInvoiceDelivery(
        tx,
        correctiveSaleId,
        { requestKey, personId, medium: "a4", pagePrinterId: way.printerId },
        { allowInactivePagePrinter: true },
      );
      return;
    }
    if (!(await deviceMayPrintReceipts(tx, cfg.origin.deviceId))) return;
    await enqueueOriginalReceipt(
      tx,
      cfg,
      await readTransactionReceipt(backend, tx, cfg, correctiveSaleId),
      correctiveSaleId,
      { personId, requestKey },
    );
  });
}

/** A filed corrective full invoice as a give-back's answer shows it. */
export interface SentCorrective {
  saleId: string;
  number: string;
  customer: string | null;
  /** The money it takes off the invoice, as a positive amount. */
  amount: string;
  /** How it is being sent, in the till's delivery-status shape; null when nothing was sent. */
  delivery: InvoiceDeliveryAttempt | null;
}

/** The corrective `correctiveSaleId` when it is a full invoice's, else null. The recipient's
 * email is shown only to a device that may print receipts, as the till's delivery read does. */
export async function readSentCorrective(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  correctiveSaleId: string,
): Promise<SentCorrective | null> {
  const [sale] = await tx
    .select({
      customerTaxId: sales.counterpartyTaxId,
      customer: sales.counterpartyLegalName,
      total: sales.total,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
    })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.id, correctiveSaleId));
  if (sale === undefined || sale.customerTaxId === null) return null;
  const status = await readInvoiceDeliveries(tx, correctiveSaleId, {
    emailAvailable: false,
    includeInvoiceRecipientEmail: await deviceMayPrintReceipts(tx, cfg.origin.deviceId),
  });
  return {
    saleId: correctiveSaleId,
    number: formatInvoiceNumber(sale.code, sale.number),
    customer: sale.customer,
    amount: centsToDecimal(-sale.total),
    delivery: status?.current ?? null,
  };
}
