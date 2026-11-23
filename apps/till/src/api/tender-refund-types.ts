import type { TillSaleResult } from "./client.js";
import type { TenderMethod } from "./find-bill-types.js";

export interface TenderRefundRequest {
  submissionId: string;
  tenderId: string;
  appliedAmount: string;
  tipAmount: string;
  reason: string;
  manualConfirmed?: boolean;
  cancellationIds?: string[];
  /** Makes this refund a card leg of that open invoice correction. */
  invoiceCorrectionId?: string;
  override?: { personId: string; pin: string };
}

export interface RefundableTender {
  tenderId: string;
  method: TenderMethod;
  last4: string | null;
  appliedRemaining: string;
  tipRemaining: string;
  pendingRefundId: string | null;
  manual: boolean;
  /** On a hand-keyed card payment, the payment money Refund a payment may give back now without a
   * corrective; absent on other payments and on a part payment. */
  plainRefundLimit?: string;
}

export interface TenderRefundView {
  refusalReason?: "provider_balance_unavailable";
  id: string;
  saleId: string;
  tenderId: string;
  state: "pending" | "completed" | "failed";
  appliedAmount: string;
  tipAmount: string;
  createdAt: string;
  completedAt: string | null;
}

type RefundAcknowledgmentParent =
  | { parent: "sale"; refund: TenderRefundView; invoiceNumber: string }
  | {
      parent: "bill";
      refund: Omit<TenderRefundView, "saleId" | "tenderId"> & { paymentId: string };
      workingOrderId: string;
      paymentReference: string;
    };

export type TenderRefundAcknowledgment = RefundAcknowledgmentParent & {
  printQueued: boolean;
  issuer: NonNullable<TillSaleResult["issuer"]>;
  customerName: string | null;
  method: TenderMethod;
  last4: string | null;
};
