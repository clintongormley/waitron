import type { ReceiptQrText } from "@waitron/fiscal";
import type { CardDetails } from "@waitron/payments";
import type { ReceiptElement, ReceiptPresentation } from "@waitron/shared";
import type { ReceiptIssuerFacts } from "./receipt-issuer.js";
import type { ReceiptAdjustment, TillSaleLine } from "./receipt-lines.js";

export interface OutsideCardDetails {
  externalProvider?: "connected_account" | "other";
  externalMachine?: string;
}

/**
 * One payment of a bill paid in parts, as the ticket lists it. `change` is what
 * the bill payment handed back when it was taken, never derived from the tender, whose amount a
 * refund lowers.
 */
export type BillTenderLine = (
  | { method: "cash"; amount: string; tip: string; tendered: string; change: string }
  | ({
      method: "card";
      amount: string;
      tip: string;
      reference: string | null;
      card?: CardDetails;
    } & OutsideCardDetails)
) & { refunds: BillTenderRefund[] };

/** Money given back from a bill payment: a `completed` refund, oldest first. */
export interface BillTenderRefund {
  amount: string;
  tip: string;
}

export type TenderBlock =
  | { method: "unpaid" }
  | { method: "deferred" }
  | { method: "cash"; change: string }
  | {
      method: "card";
      charged: string;
      tip: string;
      reference: string | null;
      externalProvider?: "connected_account" | "other";
      externalMachine?: string;
      card?: CardDetails;
    };

export interface TillSaleResult extends ReceiptPresentation, ReceiptIssuerFacts {
  /** `venueAddressLine` of the venue read for `venueAddress`. */
  venueAddressLine: string;
  /** The payer asked for a payment slip and none could be queued. */
  slipPrintFailed?: true;
  receiptPreview?: readonly ReceiptElement[];
  simulatedCardPayment: boolean;
  receiptHeader?: { tradingName: string; printTradingName: boolean };
  /** The language the sale was filed in (`sales.locale`). */
  locale: string;
  /** The language the receipt looks the goods' names up by (`sales.invoice_locales[0]`). Absent
   * reads as `locale`. */
  namesLocale?: string;
  orderLabel: string | null;
  orderNumber: number;
  /** The order was taken away; absent when it was eaten here. */
  takeAway?: true;
  /** `NumSerieFactura`-shaped "A/1", read back from the sale row + its series after filing. */
  invoiceNumber: string;
  /** The fiscal record's issuance instant, ISO-8601. */
  issuedAt: string;
  /** Taxable base + VAT, the authoritative figure the fiscal record carries. */
  total: string;
  vatBreakdown: { rate: string; base: string; tax: string }[];
  /** The FILED line list (goods identification, art. 7.1.e). */
  lines: TillSaleLine[];
  /** The sale's FIRST tender by settle time, read back from the committed tender and payment rows;
   * `payments` lists them all when the bill was paid in parts. */
  tender: TenderBlock;
  /** Every bill payment the sale was paid with, or, while it is unpaid, received so far. */
  payments?: BillTenderLine[];
  /** What an issued, unsettled sale still owes, tips aside; absent when nothing is. */
  owed?: string;
  /** Discounts on the whole bill, printed after the goods; absent when there are none. */
  billAdjustments?: ReceiptAdjustment[];
  /** Where a customer can verify the record, or "" when the regime offers none. */
  qr: string;
  /** The fiscal backend's words around the QR; present only beside a non-empty `qr`. */
  qrText?: ReceiptQrText;
}
