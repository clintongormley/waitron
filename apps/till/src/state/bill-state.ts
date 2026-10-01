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

/** The bills a party's screen lists: abandoned ones are left out, as nobody pays them. */
export function shownBills(bills: readonly PartyBill[]): PartyBill[] {
  return bills.filter((bill) => bill.status !== "abandoned");
}

/** A bill's name by its place in {@link shownBills}, under the party's display name. */
export function billName(partyName: string, index: number): string {
  return t("table.bill_of")
    .replace("{party}", () => partyName)
    .replace("{n}", String(index + 1));
}
