import type { BillEditExpected, InvoiceDeliveryChoice, PartyBill } from "./client.js";

/** Close one bill, final in Waitron, as a deferred payment. */
export interface CloseDeferredRequest {
  submissionId: string;
  expectedRevision: number;
  expectedEdit: BillEditExpected | null;
  expectedTotal: string;
  invoiceType: "F1" | "F2";
  recipient: PartyBill["recipient"];
  receiptLanguage: string;
  delivery: InvoiceDeliveryChoice | null;
  partyFinish: null | {
    partyId: string;
    expectedPartyRevision: number;
    expectedEdits: BillEditExpected[];
  };
}

export type DeferredClosurePartyBlocker =
  "other_bills" | "service" | "revision" | "editor" | "scope" | "authority";

/** What a deferred close answered; a replay and the recovery read answer the same. */
export interface CloseDeferredResult {
  submissionId: string;
  workingOrderId: string;
  saleId: string;
  invoiceNumber: string;
  classification: "deferred_payment";
  closedAt: string;
  businessDay: string;
  total: string;
  currency: "EUR";
  party: {
    state: "not_applicable" | "closed" | "open";
    blockers: DeferredClosurePartyBlocker[];
  };
}
