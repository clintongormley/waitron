import { decimal } from "@waitron/shared";
import { money } from "./bill-allocation.js";
import { parseBillEditExpected } from "./bill-editing.js";
import type { BillPaymentRequest, CounterPaymentBasket } from "./bill-payment-types.js";
import { fingerprint } from "./parties.js";

/** A payment request as its retry fingerprint reads it: every amount at the money scale, an absent
 * added tip as none, so a resend that spells the same request another way is the same request.
 * Receipt language and guest count are excluded from the match. */
export function retryShapeOf(req: BillPaymentRequest): Record<string, unknown> {
  const scaled = (value: string | undefined) =>
    value === undefined ? undefined : money(decimal(value));
  return {
    ...req,
    expectedEdit: req.expectedEdit == null ? null : parseBillEditExpected(req.expectedEdit),
    guestCount: undefined,
    receiptLanguage: undefined,
    printCardSlip: undefined,
    amount: scaled(req.amount),
    tendered: scaled(req.tendered),
    addedTip: scaled(req.addedTip ?? "0"),
    applied: scaled(req.applied),
    tip: scaled(req.tip),
    // Absent and false are one request; only a payer's own receipt changes the fingerprint.
    ownReceipt: req.ownReceipt === true ? true : undefined,
  };
}

export function billPaymentFingerprint(req: BillPaymentRequest, basket?: CounterPaymentBasket) {
  return fingerprint({
    ...retryShapeOf(req),
    basket:
      basket === undefined
        ? undefined
        : { ...basket, lateSend: undefined, closedZoneId: undefined },
  });
}
