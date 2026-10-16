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
