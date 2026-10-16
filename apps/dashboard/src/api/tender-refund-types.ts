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

export interface StuckTenderRefundRow extends TenderRefundView {
  invoiceNumber: string;
  reason: string;
  provider: string | null;
  providerPaymentRef: string | null;
}
