import type { TillSaleResult } from "./till-sale.js";
import type { TenderMethod } from "./find-bill-types.js";
import type { Override } from "@waitron/identity";

export interface TenderRefundRequest {
  submissionId: string;
  tenderId: string;
  appliedAmount: string;
  tipAmount: string;
  reason: string;
  cashConfirmed?: boolean;
  manualConfirmed?: boolean;
  override?: Override;
}

export interface RefundableTender {
  tenderId: string;
  method: TenderMethod;
  last4: string | null;
  appliedRemaining: string;
  tipRemaining: string;
  pendingRefundId: string | null;
  manual: boolean;
}

export interface TenderRefundView {
  id: string;
  saleId: string;
  tenderId: string;
  state: "pending" | "completed" | "failed";
  appliedAmount: string;
  tipAmount: string;
  createdAt: string;
  completedAt: string | null;
}

export interface TenderRefundAcknowledgment {
  refund: TenderRefundView;
  invoiceNumber: string;
  issuer: NonNullable<TillSaleResult["issuer"]>;
  customerName: string | null;
  method: TenderMethod;
  last4: string | null;
}
