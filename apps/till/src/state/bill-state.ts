import type { PartyBill } from "../api/client.js";
import { fill, t } from "../i18n/t.js";

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

/**
 * The bill to show of `bills`, the party's bills as last read: `kept`, the bill on screen, while it
 * is still shown; else the lowest-numbered bill still owing; else the lowest-numbered shown bill;
 * none when no bill is shown. Abandoned bills are never chosen.
 */
export function billToShow(
  kept: string | undefined,
  bills: readonly PartyBill[],
): string | undefined {
  const shown = shownBills(bills);
  return (shown.find((bill) => bill.workingOrderId === kept) ?? shown.find(owing) ?? shown[0])
    ?.workingOrderId;
}

/** "Bill 2", or "Bill" for a bill stored with no number. */
export function billNumberLabel(bill: Pick<PartyBill, "billNumber">): string {
  return bill.billNumber === null
    ? t("floor.unsent_bill_unnumbered")
    : fill(t("floor.unsent_bill"), { n: String(bill.billNumber) });
}

/** A bill's short label, as the floor names a bill: "Bill 2", or "Bill 2 · Clint" when it has a
 * name; "Bill" for a bill stored with no number. */
export function billLabel(bill: Pick<PartyBill, "billNumber" | "billName">): string {
  const label = billNumberLabel(bill);
  return bill.billName === null ? label : `${label} · ${bill.billName}`;
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
  return fill(t(key), {
    party: partyName,
    n: String(bill.billNumber),
    name: bill.billName ?? "",
  });
}
