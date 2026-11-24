import type { BillEditExpected, BillPaymentResult, OutsideCardDetails } from "./client.js";

/** A dish chosen to pay for, by line id; with no `quantity` the whole line. */
export interface ItemPick {
  lineId: string;
  quantity?: string;
}

/** What a preview of Pay for items is asked → `POST /api/working-orders/:id/item-payments/preview`. */
export interface ItemPaymentAsk {
  picks: ItemPick[];
  method: "cash" | "card";
  /** Cash only: the money handed over. */
  tendered?: string;
  /** Cash: the part of the change left as a tip. Card: what is charged above what is due. */
  addedTip?: string;
}

/** The chosen items' price as the server reads it, allocated as a whole payment of a bill of that
 * total. */
export interface ItemPaymentPreview {
  total: string;
  applied: string;
  tip: string;
  change: string | null;
}

/** A payment for the chosen items on a bill of their own → `POST /api/working-orders/:id/item-payments`.
 * `expectedEdits` and the party's revision are the source bill's; the server's retry fingerprint
 * reads them, so a resend carries the same. `externalRef` and `OutsideCardDetails` are a hand-keyed
 * card's only. */
export interface ItemPaymentRequest extends ItemPaymentAsk, OutsideCardDetails {
  submissionId: string;
  expectedEdits: BillEditExpected[];
  expectedPartyRevision?: number;
  partyId?: string;
  applied: string;
  tip: string;
  externalRef?: string;
  entry?: "reader";
  readerId?: string;
  /** The practice simulator only. */
  simulationOutcome?: "captured" | "declined" | "attempting";
}

/** The new bill and its payment; `payment.balance` is the new bill's. */
export interface ItemPaymentResult {
  billId: string;
  payment: BillPaymentResult;
}
