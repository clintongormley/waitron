import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import { invoiceDeliveries, type Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import {
  expireInvoiceDeliveryClaims,
  reserveInvoiceDelivery,
  type InvoiceDelivery,
} from "./invoice-delivery.js";
import {
  readInvoiceDeliveries,
  rowAttempt,
  type InvoiceDeliveryAttempt,
} from "./invoice-delivery-status.js";
import { canEmailInvoice, saleLocation } from "./invoice-email-contact.js";
import { resendInvoicePrintJob } from "./invoice-print.js";
import { readInvoicePrinter } from "./page-printers.js";
import { enqueueOriginalReceipt, readOriginalReceiptPrint } from "./receipt-print.js";
import type { OriginConfig } from "./till-config.js";
import { readSettledTicket } from "./till-sale.js";

type Request = { requestKey: string; personId: string };

/** The row an earlier request with this key made; one `sameRequest` does not accept was another. */
async function replayed(
  tx: Transaction,
  saleId: string,
  requestKey: string,
  sameRequest: (row: InvoiceDelivery) => boolean,
) {
  const [row] = await tx
    .select()
    .from(invoiceDeliveries)
    .where(and(eq(invoiceDeliveries.saleId, saleId), eq(invoiceDeliveries.requestKey, requestKey)));
  if (row !== undefined && !sameRequest(row)) {
    throw new AppError("submission.id_reused", { submissionId: requestKey });
  }
  return row;
}

const isA4 = (row: InvoiceDelivery) => row.medium === "a4";
const isReceipt = (row: InvoiceDelivery) => row.medium === "receipt";

/** Prints a full invoice on its location's invoice printer, as the delivery status offers it. */
export async function requestA4Delivery(
  tx: Transaction,
  saleId: string,
  request: Request,
): Promise<InvoiceDeliveryAttempt> {
  await expireInvoiceDeliveryClaims(tx);
  const replay = await replayed(tx, saleId, request.requestKey, isA4);
  if (replay !== undefined) return rowAttempt(replay);
  const status = await readInvoiceDeliveries(tx, saleId, { emailAvailable: false });
  if (status === null) throw new AppError("invoice_delivery.full_invoice_required", {});
  const offer = status.actions.printOnA4;
  if (offer === null) {
    throw new AppError(
      (await readInvoicePrinter(tx, await saleLocation(tx, saleId))) === null
        ? "invoice_delivery.printer_invalid"
        : "invoice_delivery.active",
      {},
    );
  }
  const row = await reserveInvoiceDelivery(tx, saleId, {
    ...request,
    medium: "a4",
    pagePrinterId: offer.printer.id,
  });
  return rowAttempt(row);
}

/** Emails a full invoice to `recipient`, as the delivery status offers it. */
export async function requestEmailDelivery(
  tx: Transaction,
  saleId: string,
  request: Request & { recipient: string; transport: boolean },
): Promise<InvoiceDeliveryAttempt> {
  await expireInvoiceDeliveryClaims(tx);
  const replay = await replayed(
    tx,
    saleId,
    request.requestKey,
    (row) => row.medium === "email" && !row.madeByRetry && row.recipient === request.recipient,
  );
  if (replay !== undefined) return rowAttempt(replay);
  const status = await readInvoiceDeliveries(tx, saleId, { emailAvailable: true });
  if (status === null) throw new AppError("invoice_delivery.full_invoice_required", {});
  if (!(await canEmailInvoice(tx, saleId, request.transport))) {
    throw new AppError("invoice_delivery.email_unavailable", {});
  }
  const row = await reserveInvoiceDelivery(tx, saleId, {
    requestKey: request.requestKey,
    personId: request.personId,
    medium: "email",
    recipient: request.recipient,
  });
  return rowAttempt(row);
}

/**
 * Emails the invoice again, to the address of the sale's current email attempt once it has failed
 * or may not have arrived, while no original has reached the customer.
 */
export async function retryEmailDelivery(
  tx: Transaction,
  saleId: string,
  deliveryId: string,
  request: Request & { transport: boolean },
): Promise<InvoiceDeliveryAttempt> {
  await expireInvoiceDeliveryClaims(tx);
  const [ended] = await tx
    .select({ generation: invoiceDeliveries.generation, recipient: invoiceDeliveries.recipient })
    .from(invoiceDeliveries)
    .where(and(eq(invoiceDeliveries.id, deliveryId), eq(invoiceDeliveries.saleId, saleId)));
  const replay = await replayed(
    tx,
    saleId,
    request.requestKey,
    (row) => row.madeByRetry && ended !== undefined && row.generation === ended.generation + 1,
  );
  if (replay !== undefined) return rowAttempt(replay);
  const status = await readInvoiceDeliveries(tx, saleId, { emailAvailable: true });
  if (status === null) throw new AppError("invoice_delivery.full_invoice_required", {});
  if (ended === undefined) throw new AppError("invoice_delivery.not_found", {});
  if (status.current?.id !== deliveryId || status.actions.retryOriginal?.medium !== "email") {
    throw new AppError("invoice_delivery.active", {});
  }
  if (!(await canEmailInvoice(tx, saleId, request.transport))) {
    throw new AppError("invoice_delivery.email_unavailable", {});
  }
  const row = await reserveInvoiceDelivery(tx, saleId, {
    requestKey: request.requestKey,
    personId: request.personId,
    medium: "email",
    recipient: ended.recipient!,
    madeByRetry: true,
  });
  return rowAttempt(row);
}

/**
 * Replaces an A4 or email original nothing has claimed with a receipt original, in the caller's one
 * transaction: the attempt ends `switched` before the receipt is reserved, because a reservation is
 * refused while another attempt is active.
 */
export async function switchToReceipt(
  tx: Transaction,
  deps: { backend: FiscalBackend; cfg: OriginConfig },
  sale: { id: string; workingOrderId: string },
  deliveryId: string,
  request: Request,
): Promise<InvoiceDeliveryAttempt> {
  await expireInvoiceDeliveryClaims(tx);
  const replay = await replayed(tx, sale.id, request.requestKey, isReceipt);
  if (replay !== undefined) return rowAttempt(replay);
  const status = await readInvoiceDeliveries(tx, sale.id, { emailAvailable: false });
  if (status === null) throw new AppError("invoice_delivery.full_invoice_required", {});
  const attempt = status.history.find((candidate) => candidate.id === deliveryId);
  if (attempt === undefined) throw new AppError("invoice_delivery.not_found", {});
  const receipt = await readOriginalReceiptPrint(tx, sale.id);
  if (status.actions.receiptInstead?.deliveryId !== deliveryId) {
    if (
      attempt.status === "queued" &&
      (attempt.medium === "a4" || attempt.medium === "email") &&
      attempt.designation === "original" &&
      receipt.status !== "not_queued"
    ) {
      throw new AppError("print_job.not_resendable", { id: receipt.jobId });
    }
    throw new AppError("invoice_delivery.active", {});
  }
  const switched = await tx
    .update(invoiceDeliveries)
    .set({ status: "failed", failureCode: "switched" })
    .where(
      and(
        eq(invoiceDeliveries.id, deliveryId),
        eq(invoiceDeliveries.status, "queued"),
        isNull(invoiceDeliveries.claimedAt),
      ),
    )
    .returning({ id: invoiceDeliveries.id });
  if (switched.length === 0) throw new AppError("invoice_delivery.active", {});
  if (receipt.status === "not_queued") {
    const ticket = await readSettledTicket(deps.backend, tx, deps.cfg, sale.workingOrderId);
    await enqueueOriginalReceipt(
      tx,
      deps.cfg,
      ticket,
      sale.id,
      undefined,
      request.personId,
      request.requestKey,
    );
  } else {
    await resendInvoicePrintJob(tx, receipt.jobId, request.personId, undefined, request.requestKey);
  }
  // `enqueueOriginalReceipt` queues nothing when the till resolves no receipt printer.
  const made = await replayed(tx, sale.id, request.requestKey, isReceipt);
  if (made === undefined) throw new AppError("invoice_delivery.receipt_unavailable", {});
  return rowAttempt(made);
}
