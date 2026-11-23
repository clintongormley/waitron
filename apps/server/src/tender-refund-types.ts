import type { TillSaleResult } from "./till-sale.js";
import type { TenderMethod } from "./find-bill-types.js";
import type { Override } from "@waitron/identity";

export interface TenderRefundRequest {
  submissionId: string;
  tenderId: string;
  appliedAmount: string;
  tipAmount: string;
  reason: string;
  manualConfirmed?: boolean;
  /** The cancels this refund pays back, in the order their dishes are shown. */
  cancellationIds?: string[];
  override?: Override;
  /** The correction this refund gives money back for; `requestId` groups the refunds one request
   * makes. */
  invoiceCorrection?: { id: string; requestId: string; cashRoute?: true };
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
   * corrective; absent on other payments and on a part payment with no correction open. */
  plainRefundLimit?: string;
  /** On a hand-keyed card payment, set while the sale has an open correction, which refuses every
   * refund outside it. */
  correctionOpen?: true;
}

export interface TenderRefundView {
  refusalReason?: import("@waitron/payments").RefundRefusalReason;
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
