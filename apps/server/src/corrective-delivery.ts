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
  type OriginalWay,
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

/** How the invoice `correctiveSaleId` corrects went; for a replacement that never went out, how
 * the invoice it replaced went. */
async function readCorrectedWay(
  tx: Transaction,
  correctiveSaleId: string,
): Promise<OriginalWay | null> {
  const correctionLinkOf = async (saleId: string) =>
    (
      await tx
        .select({ corrects: sales.correctsSaleId, replaces: sales.replacesOriginal })
        .from(sales)
        .where(eq(sales.id, saleId))
    )[0]!;
  const targetId = (await correctionLinkOf(correctiveSaleId)).corrects!;
  const target = await correctionLinkOf(targetId);
  // A replacement is never itself replaced (packages/core/src/record-replacement.ts), so one
  // step back reaches the invoice it replaced.
  return (
    (await readOriginalWay(tx, targetId)) ??
    (target.replaces ? await readOriginalWay(tx, target.corrects!) : null)
  );
}

/**
 * Sends the corrective full invoice `correctiveSaleId` (request key `corrective:<correction id>`),
 * under the person who opened the correction, the way the invoice it corrects went; for a
 * replacement that never went out, the way the invoice it replaced went. By email to the same
 * address when this box can email the invoice now; on `cfg`'s device's own A4 printer when that
 * way was A4 and the device has one; otherwise on the device's receipt printer when its profile
 * may print receipts. A failure to send leaves the filing as it is.
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
    const way = await readCorrectedWay(tx, correctiveSaleId);
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
  customerName: string | null;
  /** The money it takes off the invoice, as a positive amount. */
  amount: string;
  /** How it is being sent, in the till's delivery-status shape; null when nothing was sent. */
  delivery: InvoiceDeliveryAttempt | null;
  /** The invoice it corrects went on A4, and it is being printed on the receipt printer instead. */
  printedOnReceiptNotA4: boolean;
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
      customerName: sales.counterpartyLegalName,
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
  const delivery = status?.current ?? null;
  return {
    saleId: correctiveSaleId,
    invoiceNumber: formatInvoiceNumber(sale.code, sale.number),
    customerName: sale.customerName,
    amount: centsToDecimal(-sale.total),
    delivery,
    printedOnReceiptNotA4:
      delivery?.medium === "receipt" &&
      (await readCorrectedWay(tx, correctiveSaleId))?.medium === "a4",
  };
}
