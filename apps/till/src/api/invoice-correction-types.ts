import type { TenderRefundView } from "./tender-refund-types.js";

export interface CorrectionSplitLine {
  rate: string;
  base: string;
  tax: string;
}

export interface InvoiceCorrectionRequest {
  submissionId: string;
  /** The money back, VAT included. */
  gross: string;
  lineIds?: string[];
  reasonId: string;
  note?: string | null;
  /** The split the preview answered, which the till showed. */
  expectedSplit: CorrectionSplitLine[];
  override?: { personId: string; pin: string };
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
    | { refusal: string; closable: boolean }
    | null;
}

/** A correction under way, as Find bill lists it. */
export type OpenInvoiceCorrection = Omit<InvoiceCorrectionView, "fileNow">;

export interface InvoiceCorrectionOpened {
  correction: InvoiceCorrectionView;
  replayed: boolean;
}

export interface InvoiceCorrectionCashGiven {
  correction: InvoiceCorrectionView;
  refunds: TenderRefundView[];
  replayed: boolean;
}

/** A line of the invoice with what earlier corrections left of it, `left`. */
export interface InvoiceCorrectionLine {
  id: string;
  descriptions: Record<string, string>;
  rate: string;
  gross: string;
  left: string;
}

export interface InvoiceCorrectionLines {
  lines: InvoiceCorrectionLine[];
  /** The money still refundable over every payment on the invoice. */
  moneyRefundable: string;
}

export interface InvoiceCorrectionPreviewRequest {
  gross: string;
  lineIds?: string[];
}

export interface InvoiceCorrectionPreview {
  gross: string;
  vatBreakdown: CorrectionSplitLine[];
  moneyRefundable: string;
}
