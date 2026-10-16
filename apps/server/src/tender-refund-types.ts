import type { TenderMethod } from "./find-bill-types.js";

export interface RefundableTender {
  tenderId: string;
  method: TenderMethod;
  last4: string | null;
  appliedRemaining: string;
  tipRemaining: string;
  pendingRefundId: string | null;
  manual: boolean;
}
