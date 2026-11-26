import { DraftsApi } from "./drafts-api.js";
import type { TillSaleResult, TransactionReceipt } from "./payments-api.js";
import type { TillRequest, ReadOptions } from "./till-request.js";

export type OriginalReceiptPrint =
  | { status: "not_queued" }
  | {
      status: "queued" | "printing" | "failed" | "done";
      jobId: string;
      printerId?: string;
      printerName?: string;
      canRetry: boolean;
      /** Only on a failed original: its printer was deleted, so it will never print there. */
      failureCode?: "printer.deleted";
      /**
       * Only on a retryable full invoice's original that a print request sent to a printer that is
       * not this till's invoice printer: the till may not send it there again.
       */
      printerWithdrawn?: true;
      handover?: { personId: string; confirmedAt: string };
    };
/**
 * What an office printer can be holding an A4 for (`a4HoldCodes`, `packages/db`, pinned to this
 * copy by `scripts/a4-hold-code-copies.test.ts`). The server may send a code this list lacks.
 */
export const a4HoldCodes = [
  "paper_jam",
  "cover_open",
  "paper_out",
  "tray_missing",
  "ink_or_toner_out",
  "output_full",
  "paused",
  "stopped",
] as const;

export type A4HoldCode = (typeof a4HoldCodes)[number];

export type InvoiceDeliveryMedium = "email" | "a4" | "receipt";
/** How one bill's full invoice can be delivered (`/api/invoice-delivery-options`,
 * `apps/server/src/till-working-order-routes.ts`). */
export interface InvoiceDeliveryOptions {
  /** The device's invoice printer when it is an A4 printer, else null. */
  invoicePrinter: { id: string; name: string } | null;
  /** The box has mail set up, and the bill's department receipt, or the default department's, has
   * a contact email. */
  emailAvailable: boolean;
  /** The box has mail set up but neither of those receipts has a contact email; false when mail is
   * not set up. */
  emailNeedsReceiptContact: boolean;
}
/** How a full invoice is delivered, staged with the invoice choice; a bill's read returns it too. */
export type InvoiceDeliveryChoice =
  | { medium: "receipt" }
  | { medium: "a4"; pagePrinterId: string }
  | { medium: "email"; recipient: string };
/** One attempt to deliver a full invoice (`readInvoiceDeliveries`, `apps/server/src/invoice-delivery-status.ts`). */
export interface InvoiceDeliveryAttempt {
  id: string | null;
  medium: InvoiceDeliveryMedium;
  designation: "original" | "duplicate";
  status: "queued" | "sending" | "sent" | "failed" | "unknown";
  failureCode: string | null;
  requestedAt: string;
  at: string | null;
  personId: string | null;
  printerHold: string | null;
  printerName?: string;
  invoiceRecipientEmail?: string;
  lateSuccess: boolean;
}
/** A printer the status offers to print the full invoice on (`OfferedPrinter`, `apps/server/src/invoice-delivery-status.ts`). */
export interface InvoiceOfferedPrinter {
  id: string;
  name: string;
  kind: "a4" | "receipt";
}

export interface InvoiceDeliveryStatus {
  current: InvoiceDeliveryAttempt | null;
  originalCompleted: boolean;
  /** The printer of the original that was sent, else of the newest original attempt; null for an email or none. */
  originalPrinterId: string | null;
  actions: {
    retryOriginal: { medium: InvoiceDeliveryMedium } | null;
    retryA4?: InvoiceOfferedPrinter;
    print: {
      printers: InvoiceOfferedPrinter[];
      designation: "original" | "duplicate";
    } | null;
    receiptInstead: { deliveryId: string } | null;
    email: { designation: "original" | "duplicate" } | null;
  };
  history: InvoiceDeliveryAttempt[];
}

export class InvoiceDeliveryApi extends DraftsApi {
  readonly #request: TillRequest;
  constructor(request: TillRequest) {
    super(request);
    this.#request = request;
  }
  /**
   * Reprint a FILED sale's customer receipt → `POST /api/sales/:id/reprint`, by the till's own
   * working-order id. Paper only: it files NOTHING and ignores automatic receipt selection. An
   * id naming no filed sale is a 200 no-op; a till with no active receipt printer is refused with
   * `receipt.no_printer` (409). The copy's fixed words
   * and formatting are in `language`, one of `TillInfo.receiptLanguages` or the sale's own,
   * or without one in the language the sale was filed in.
   */
  async reprint(workingOrderId: string, language?: string): Promise<void> {
    await this.#request<void>(
      `/api/sales/${workingOrderId}/reprint`,
      "POST",
      language === undefined ? {} : { language },
    );
  }
  getFiledTicket(
    workingOrderId: string,
    { receiptPreview = false }: { receiptPreview?: boolean } = {},
  ): Promise<TillSaleResult> {
    const query = receiptPreview ? "?receiptPreview=1" : "";
    return this.#request<TillSaleResult>(`/api/sales/${workingOrderId}${query}`, "GET");
  }
  getReceiptPrintStatus(workingOrderId: string): Promise<OriginalReceiptPrint> {
    return this.#request<OriginalReceiptPrint>(`/api/sales/${workingOrderId}/receipt`, "GET");
  }
  confirmReceiptHandover(workingOrderId: string): Promise<OriginalReceiptPrint> {
    return this.#request<OriginalReceiptPrint>(
      `/api/sales/${workingOrderId}/receipt/handover`,
      "POST",
      {},
    );
  }
  retryReceipt(workingOrderId: string): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      `/api/sales/${workingOrderId}/receipt/retry`,
      "POST",
      {},
    );
  }
  /** Null for a simplified invoice. */
  getInvoiceDeliveries(workingOrderId: string): Promise<InvoiceDeliveryStatus | null> {
    return this.#request<InvoiceDeliveryStatus | null>(
      `/api/sales/${workingOrderId}/deliveries`,
      "GET",
    );
  }
  getReceiptEmailDeliveries(workingOrderId: string): Promise<InvoiceDeliveryStatus | null> {
    return this.#request<InvoiceDeliveryStatus | null>(
      `/api/sales/${workingOrderId}/deliveries?medium=email`,
      "GET",
    );
  }
  /** Prints the full invoice on `printerId`, which must be the device's invoice printer. */
  requestPrintDelivery(
    workingOrderId: string,
    printerId: string,
    requestKey: string,
  ): Promise<InvoiceDeliveryAttempt> {
    return this.#request<InvoiceDeliveryAttempt>(
      `/api/sales/${workingOrderId}/deliveries`,
      "POST",
      { medium: "print", printerId, requestKey },
    );
  }
  requestEmailDelivery(
    workingOrderId: string,
    recipient: string,
    requestKey: string,
  ): Promise<InvoiceDeliveryAttempt> {
    return this.#request<InvoiceDeliveryAttempt>(
      `/api/sales/${workingOrderId}/deliveries`,
      "POST",
      { medium: "email", recipient, requestKey },
    );
  }
  /** Sends an ended email original again, to the address it was sent to. */
  retryEmailDelivery(
    workingOrderId: string,
    deliveryId: string,
    requestKey: string,
  ): Promise<InvoiceDeliveryAttempt> {
    return this.#request<InvoiceDeliveryAttempt>(
      `/api/sales/${workingOrderId}/deliveries/${deliveryId}/retry`,
      "POST",
      { requestKey },
    );
  }
  /** A waiting A4 or email original goes to the receipt printer instead. */
  switchA4ToReceipt(
    workingOrderId: string,
    deliveryId: string,
    requestKey: string,
  ): Promise<InvoiceDeliveryAttempt> {
    return this.#request<InvoiceDeliveryAttempt>(
      `/api/sales/${workingOrderId}/deliveries/${deliveryId}/to-receipt`,
      "POST",
      { requestKey },
    );
  }
  /** Print the ORIGINAL receipt offered at invoice issuance. */
  async printReceipt(workingOrderId: string, options: { ifOwed?: true } = {}): Promise<void> {
    await this.#request<void>(`/api/sales/${workingOrderId}/receipt`, "POST", options);
  }
  getTransactionDeliveries(saleId: string): Promise<InvoiceDeliveryStatus> {
    return this.#request(`/api/transactions/${encodeURIComponent(saleId)}/deliveries`, "GET");
  }
  getTransactionReceiptPrint(saleId: string): Promise<OriginalReceiptPrint> {
    return this.#request(`/api/transactions/${encodeURIComponent(saleId)}/receipt-print`, "GET");
  }
  printTransactionInvoice(
    saleId: string,
    printerId: string,
    requestKey: string,
  ): Promise<InvoiceDeliveryAttempt> {
    return this.#request(`/api/transactions/${encodeURIComponent(saleId)}/deliveries`, "POST", {
      medium: "print",
      printerId,
      requestKey,
    });
  }
  transactionReceiptInstead(
    saleId: string,
    deliveryId: string,
    requestKey: string,
  ): Promise<InvoiceDeliveryAttempt> {
    return this.#request(
      `/api/transactions/${encodeURIComponent(saleId)}/deliveries/${encodeURIComponent(deliveryId)}/to-receipt`,
      "POST",
      { requestKey },
    );
  }
  retryTransactionReceipt(saleId: string): Promise<{ jobId: string }> {
    return this.#request(
      `/api/transactions/${encodeURIComponent(saleId)}/receipt-print/retry`,
      "POST",
      {},
    );
  }
  confirmTransactionReceiptHandover(saleId: string): Promise<OriginalReceiptPrint> {
    return this.#request(
      `/api/transactions/${encodeURIComponent(saleId)}/receipt-print/handover`,
      "POST",
      {},
    );
  }
  getTransactionReceipt(saleId: string, options: ReadOptions = {}): Promise<TransactionReceipt> {
    return this.#request(
      `/api/transactions/${encodeURIComponent(saleId)}/receipt`,
      "GET",
      undefined,
      options.signal,
    );
  }
  async reprintTransaction(saleId: string, language?: string): Promise<void> {
    await this.#request(
      `/api/transactions/${encodeURIComponent(saleId)}/reprint`,
      "POST",
      language === undefined ? {} : { language },
    );
  }
}
