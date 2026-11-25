import type { TillApi } from "../api/client.js";
import {
  a4HoldCodes,
  type InvoiceDeliveryAttempt,
  type InvoiceDeliveryStatus,
} from "../api/invoice-delivery-api.js";
import type { TillSaleResult } from "../api/payments-api.js";
import type { StringKey } from "../i18n/strings.js";
import { fill, t } from "../i18n/t.js";
import { officePrinterHoldText } from "../i18n/staff-notices.js";

export const DELIVERY_REREAD_MS = 5_000;

export function invoiceDeliveryRefusalOf(error: unknown) {
  const { code, field } = (error ?? {}) as { code?: unknown; field?: unknown };
  return typeof code !== "string" ? {} : typeof field === "string" ? { code, field } : { code };
}

export type TicketDeliveryTarget = { id: string; transaction: boolean };

export function ticketDeliveryTarget(
  historical:
    { kind: "invoice"; saleId: string; workingOrderId: string | null } | { kind: "refund" } | null,
  result: TillSaleResult | undefined,
  orderId: string | undefined,
): TicketDeliveryTarget | undefined {
  if (
    historical?.kind === "invoice" &&
    historical.workingOrderId === null &&
    result?.invoiceType === "F1"
  )
    return { id: historical.saleId, transaction: true };
  return orderId === undefined ? undefined : { id: orderId, transaction: false };
}

export function readTicketReceiptPrint(api: TillApi, { id, transaction }: TicketDeliveryTarget) {
  return transaction ? api.getTransactionReceiptPrint(id) : api.getReceiptPrintStatus(id);
}

export function readTicketInvoiceDelivery(
  api: TillApi,
  { id, transaction }: TicketDeliveryTarget,
  fullInvoice: boolean,
) {
  if (transaction) return api.getTransactionDeliveries(id);
  return fullInvoice ? api.getInvoiceDeliveries(id) : api.getReceiptEmailDeliveries(id);
}

export function invoicePrintDestination(
  status: InvoiceDeliveryStatus | null | undefined,
  preferSavedA4: boolean,
) {
  return (
    (preferSavedA4 ? status?.actions.retryA4 : undefined) ?? status?.actions.print?.printers[0]
  );
}

export function shouldRereadDelivery(
  delivery: InvoiceDeliveryStatus | null | undefined,
  billFullInvoice: boolean,
  live: boolean | undefined,
  stale: boolean,
): boolean {
  const status = delivery?.current?.status;
  return (
    status === "queued" ||
    status === "sending" ||
    (billFullInvoice &&
      (status === "unknown" || stale || (!live && delivery?.originalCompleted !== true)))
  );
}

/** A receipt attempt is worded by the original's print status. */
export function deliveryWords(
  attempt: InvoiceDeliveryAttempt,
  mayHaveArrived: boolean,
  autoRefresh = false,
): string | undefined {
  if (attempt.medium === "receipt") return undefined;
  const hold = attempt.printerHold;
  if (
    attempt.printerName !== undefined &&
    hold !== null &&
    (attempt.status === "queued" || attempt.status === "sending")
  )
    return officePrinterHoldText(attempt.printerName, hold);
  switch (attempt.status) {
    case "queued":
      return t(
        attempt.medium === "a4" ? "invoice.delivery_waiting_office" : "invoice.delivery_sending",
      );
    case "sending":
      if (hold === null) return t("invoice.delivery_sending");
      // A code this till has no words for must not leave `{reason}` on screen.
      return (a4HoldCodes as readonly string[]).includes(hold)
        ? t("invoice.delivery_held").replace("{reason}", () =>
            t(`invoice.delivery_hold_${hold}` as StringKey),
          )
        : t("invoice.delivery_held_no_reason");
    case "sent":
      return t(
        attempt.medium === "a4" ? "invoice.delivery_sent_a4" : "invoice.delivery_sent_email",
      );
    case "failed":
      return t(mayHaveArrived ? "invoice.delivery_unknown" : "invoice.delivery_failed");
    case "unknown":
      if (hold !== null) return t("invoice.delivery_unknown_held");
      if (!autoRefresh || attempt.medium !== "a4") return t("invoice.delivery_unknown");
      return attempt.failureCode === "timeout" && attempt.printerName !== undefined
        ? fill(t("invoice.a4_stopped_answering"), { printer: attempt.printerName })
        : t("invoice.a4_check_paper");
  }
}
