import type { PartyBill } from "../api/client.js";
import { t } from "../i18n/t.js";

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

/**
 * The bills a party's screen lists: abandoned ones are left out, as nobody pays them. The rest go
 * by the number each holds at its table, then id; a bill stored with no number, a fault in Waitron,
 * goes last.
 */
export function shownBills(bills: readonly PartyBill[]): PartyBill[] {
  return bills
    .filter((bill) => bill.status !== "abandoned")
    .sort(
      (a, b) =>
        (a.billNumber ?? Infinity) - (b.billNumber ?? Infinity) ||
        a.workingOrderId.localeCompare(b.workingOrderId),
    );
}

/** A bill's name under the party's display name: its stored number, and its own name if it has one. */
export function billName(
  partyName: string,
  bill: Pick<PartyBill, "billNumber" | "billName">,
): string {
  const key =
    bill.billNumber === null
      ? bill.billName === null
        ? "table.bill_of_unnumbered"
        : "table.bill_of_unnumbered_named"
      : bill.billName === null
        ? "table.bill_of"
        : "table.bill_of_named";
  return t(key)
    .replace("{party}", () => partyName)
    .replace("{n}", String(bill.billNumber))
    .replace("{name}", () => bill.billName ?? "");
}
