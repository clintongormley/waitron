import "./errors.js";
import { eq } from "drizzle-orm";
import { formatInvoiceNumber } from "@waitron/core";
import { invoiceSeries, sales, type Transaction } from "@waitron/db";
import { centsToDecimal } from "@waitron/shared";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import {
  readInvoiceDeliveries,
  readOriginalWay,
  type InvoiceDeliveryAttempt,
} from "./invoice-delivery-status.js";
import { canEmailInvoice } from "./invoice-email-contact.js";
import type { InvoiceCorrectionDeps } from "./invoice-corrections.js";
import { optionalDocument } from "./optional-document.js";
import {
  deviceMayPrintReceipts,
  enqueueOriginalReceipt,
  resolveInvoicePrinter,
} from "./receipt-print.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import type { DeviceRequestConfig } from "./trading-context.js";

/**
 * Sends the corrective full invoice `correctiveSaleId` of `correction` (request key
 * `corrective:<id>`) the way the invoice it corrects went ({@link readOriginalWay}), which is the
 * replacement when the invoice given back on was replaced, under the person who opened the
 * correction: by email to the same address when this box can email the invoice now; on `cfg`'s
 * device's own A4 printer when that invoice went on A4 and that device has one; otherwise on that
 * device's receipt printer when its profile may print receipts. A failure to send leaves the
 * filing as it is.
 */
export async function sendFiledCorrective(
  tx: Transaction,
  deps: Pick<InvoiceCorrectionDeps, "backend" | "invoiceEmailAvailable">,
  cfg: DeviceRequestConfig,
  correction: { id: string; requestedBy: string },
  correctiveSaleId: string,
): Promise<void> {
  await optionalDocument(tx, "sendFiledCorrective", correctiveSaleId, async () => {
    const requestKey = `corrective:${correction.id}`;
    const personId = correction.requestedBy;
    const [corrective] = await tx
      .select({ correctsSaleId: sales.correctsSaleId })
      .from(sales)
      .where(eq(sales.id, correctiveSaleId));
    const way = await readOriginalWay(tx, corrective!.correctsSaleId!);
    if (
      way?.medium === "email" &&
      way.recipient !== null &&
      (await canEmailInvoice(
        tx,
        { kind: "sale", saleId: correctiveSaleId },
        (await deps.invoiceEmailAvailable?.(tx)) === true,
      ))
    ) {
      await reserveInvoiceDelivery(tx, correctiveSaleId, {
        requestKey,
        personId,
        medium: "email",
        recipient: way.recipient,
      });
      return;
    }
    if (way?.medium === "a4") {
      const printer = await resolveInvoicePrinter(tx, cfg.origin);
      if (printer?.kind === "a4") {
        await reserveInvoiceDelivery(tx, correctiveSaleId, {
          requestKey,
          personId,
          medium: "a4",
          pagePrinterId: printer.id,
        });
        return;
      }
    }
    if (!(await deviceMayPrintReceipts(tx, cfg.origin.deviceId))) return;
    await enqueueOriginalReceipt(
      tx,
      cfg,
      await readTransactionReceipt(deps.backend, tx, cfg, correctiveSaleId),
      correctiveSaleId,
      { personId, requestKey },
    );
  });
}

/** A filed corrective full invoice as a give-back's answer shows it. */
export interface SentCorrective {
  saleId: string;
  invoiceNumber: string;
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
    invoiceNumber: formatInvoiceNumber(sale.code, sale.number),
    customer: sale.customer,
    amount: centsToDecimal(-sale.total),
    delivery: status?.current ?? null,
  };
}
