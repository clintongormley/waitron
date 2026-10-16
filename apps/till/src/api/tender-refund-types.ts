import type { TenderMethod } from "./find-bill-types.js";

export interface TenderRefundRequest {
  submissionId: string;
  tenderId: string;
  appliedAmount: string;
  tipAmount: string;
  reason: string;
  cashConfirmed?: boolean;
  manualConfirmed?: boolean;
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
