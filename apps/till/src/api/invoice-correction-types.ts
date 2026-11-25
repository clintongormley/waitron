import type { TenderRefundView } from "./tender-refund-types.js";

export interface CorrectionSplitLine {
  rate: string;
  base: string;
  tax: string;
}

export interface InvoiceCorrectionCashRequest {
  submissionId: string;
  amount: string;
  override?: { personId: string; pin: string };
}

export interface InvoiceCorrectionFileRequest {
  expectedSplit: CorrectionSplitLine[];
  override?: { personId: string; pin: string };
}

export interface InvoiceCorrectionView {
  id: string;
  saleId: string;
  state: "open" | "filed" | "discarded" | "closed";
  gross: string;
  moneyBack: string;
  pending: string;
  left: string;
  reason: string;
  openedAt: string;
  correctiveSaleId: string | null;
  legs: TenderRefundView[];
  fileNow:
    | { gross: string; vatBreakdown: CorrectionSplitLine[] }
    | { refusal: string; reason?: string; closable: boolean }
    | null;
}

/** A correction under way, as Find bill lists it, with the number of the invoice it corrects. */
export type OpenInvoiceCorrection = Omit<InvoiceCorrectionView, "fileNow"> & {
  invoiceNumber: string;
};

export interface InvoiceCorrectionCashGiven {
  correction: InvoiceCorrectionView;
  refunds: TenderRefundView[];
  replayed: boolean;
}
