import type { Dining } from "@waitron/shared";
import type { AttendanceRecorder } from "./attendance-capture.js";
import type { BillPaymentView, BillBalance } from "./bill-balance.js";
import type { DiskFullState } from "./disk-full-state.js";
import type { LateSendConfirmation } from "./late-send.js";
import type { BillEditExpected } from "./order-drafts.js";
import type { OutsideCardDetails } from "./outside-card.js";
import type { TillSaleResult } from "./till-sale.js";
import type { TillSaleDeps } from "./working-order-context.js";
import type { UpdateHeldOrderRequest } from "./working-order-edit-state.js";

export type BillPaymentDeps = TillSaleDeps & {
  attendance?: AttendanceRecorder;
  /**
   * Unset in suites that test no full-disk stop; unset, nothing is refused for a full disk. A live
   * boot supplies it.
   */
  disk?: DiskFullState;
};
/** What a payment request asks for, before the operator has seen an allocation. */
export interface BillPaymentAsk {
  expectedEdit: BillEditExpected | null;
  dining?: Dining;
  kind: "contribution" | "share";
  /** `contribution` only. */
  amount?: string;
  /** `share` only: how many people are still to pay. */
  shareOf?: number;
  method: "cash" | "card";
  /** Cash only: the money handed over. */
  tendered?: string;
  /** What the payer adds as a tip on top of what the allocation's own rule makes one. */
  addedTip?: string;
}

export interface CounterPaymentBasket {
  lines: UpdateHeldOrderRequest["lines"];
  revision?: number;
  label?: string;
  zoneId?: string;
  closedZoneId?: string;
  kitchenNote?: string | null;
  invoiceType?: unknown;
  recipient?: unknown;
}
export type CounterPayment = CounterPaymentBasket & { lateSend?: LateSendConfirmation };
/** A payment request as taken: the ask, the allocation the operator saw, and its retry key. */
export interface BillPaymentRequest extends BillPaymentAsk, OutsideCardDetails {
  submissionId: string;
  printCardSlip?: boolean;
  /** A card only: `manual` is a card charged on a terminal the POS does not drive, `reader` one
   * the provider drives. */
  entry?: "manual" | "reader";
  /** A hand-keyed card's terminal operation number. */
  externalRef?: string;
  /** A reader card only, passed to the provider's `collect`. */
  simulationOutcome?: "captured" | "declined" | "attempting";
  applied: string;
  tip: string;
  receiptLanguage?: string;
  /** What the receipt prints if this payment completes the bill; absent stores the default then. */
  guestCount?: number | null;
  /** The payer wants their own receipt for this amount: a part payment that leaves something owed
   * then issues its own advance ticket ({@link issueAdvanceIfOwed}). */
  ownReceipt?: boolean;
}

export interface BillPaymentResult {
  failureReason?: string;
  slipPrintFailed?: true;
  /** The payment's state; a reader card's own answer is `declined`, `timeout` (still pending),
   * `network_unavailable` (failed, nothing charged). A retry whose own sign-in is open on an active
   * till (the first sign-in or a later one) answers the state it finds, except that Pay for items
   * answers `declined` for a failed card its provider recorded as failed or refunded. */
  outcome: "received" | "pending" | "failed" | "declined" | "timeout" | "network_unavailable";
  payment: BillPaymentView;
  balance: BillBalance;
  /** Present when the bill is invoiced: by this payment, or, on a replay, since. */
  invoice?: TillSaleResult;
}
export type SettledBill = { outcome: "settled"; balance: BillBalance; invoice: TillSaleResult };
