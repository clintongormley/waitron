import type { PartyBill } from "../api/client.js";

/** A bill still to pay: open, or placed and not yet collected. */
export function owing(bill: Pick<PartyBill, "status">): boolean {
  return bill.status === "open" || bill.status === "placed";
}

/**
 * An open bill holding a payment, which the single payment refuses (`bill.payments_received`), so
 * the rest is taken as a bill payment. A held-list row has no `status`: the list holds open orders
 * only.
 */
export function paidInPart(bill: { status?: PartyBill["status"]; hasPayments: boolean }): boolean {
  return bill.hasPayments && (bill.status === undefined || bill.status === "open");
}
