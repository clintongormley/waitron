import type { TransferClosureResult } from "@waitron/db";
import type { InvoiceRecipient } from "./invoice-selection.js";
import type { BillEditExpected } from "./order-drafts.js";
import type { BillInvoiceDelivery } from "./parties.js";

/** Close one bill, final in Waitron, as a deferred payment. */
export interface CloseByTransferRequest {
  /** The bill. */
  id: string;
  submissionId: string;
  expectedRevision: number;
  expectedEdit: BillEditExpected | null;
  expectedTotal: string;
  invoiceType: "F1" | "F2";
  recipient: InvoiceRecipient | null;
  receiptLanguage: string;
  delivery: BillInvoiceDelivery | null;
  partyFinish: null | {
    partyId: string;
    expectedPartyRevision: number;
    expectedEdits: BillEditExpected[];
  };
}

export type CloseByTransferResult = TransferClosureResult;
