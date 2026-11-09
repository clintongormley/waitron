import type { TransferClosureResult } from "@waitron/db";
import type { InvoiceRecipient } from "./invoice-selection.js";
import type { BillEditExpected } from "./order-drafts.js";

/** No `personId`: the actor who stages a delivery is the server's to record, never the request's. */
export type TransferDeliveryIntent =
  | { medium: "receipt" }
  | { medium: "a4"; pagePrinterId: string }
  | { medium: "email"; recipient: string };

/** Close one bill, final in Waitron, as to be paid by bank transfer. */
export interface CloseByTransferRequest {
  /** The bill. */
  id: string;
  operationId: string;
  expectedRevision: number;
  expectedEdit: BillEditExpected | null;
  expectedTotal: string;
  invoiceType: "F1" | "F2";
  recipient: InvoiceRecipient | null;
  receiptLanguage: string;
  delivery: TransferDeliveryIntent | null;
  partyFinish: null | {
    partyId: string;
    expectedPartyRevision: number;
    expectedEdits: BillEditExpected[];
  };
}

export type CloseByTransferResult = TransferClosureResult;
