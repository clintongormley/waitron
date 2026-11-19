import { MONEY_SCALE, compareDecimal, decimal, subtractDecimal, toScale } from "@waitron/shared";
import type { PartyBill } from "../api/client.js";
import { fill, t } from "../i18n/t.js";

/** Open or placed; unlike `stillToPay`, counts an open bill with nothing outstanding. */
export function owing(bill: Pick<PartyBill, "status">): boolean {
  return bill.status === "open" || bill.status === "placed";
}

/** As the server's `needsPaper`: only a full invoice going to A4 or by email prints no receipt. */
function needsReceiptPaper(bill: Pick<PartyBill, "invoiceType" | "invoiceDelivery">): boolean {
  const medium = bill.invoiceDelivery?.medium;
  return bill.invoiceType !== "F1" || (medium !== "a4" && medium !== "email");
}

/**
 * Print the bill is offered for a bill with no ticket that still owes and was not left unpaid, with
 * no whole payment awaiting its answer, to a person who may take payment, on a device that may print
 * what the bill needs, and with dishes on it; the server's other refusals are said when it is
 * pressed. `dishes` is the count of the bill's sent dishes when the till has read them; for a bill it
 * has not read, the bills read's total stands in, so an open bill off screen at 0.00 is not offered,
 * given away or empty.
 */
export function printBillOffered(
  bill: Pick<
    PartyBill,
    "status" | "invoiceNumber" | "leftUnpaid" | "total" | "invoiceType" | "invoiceDelivery"
  >,
  seen: {
    dishes: number | undefined;
    paymentUnanswered: boolean;
    printsReceipts: boolean;
    takesPayment: boolean;
  },
): boolean {
  if (!seen.takesPayment || seen.paymentUnanswered) return false;
  if (!seen.printsReceipts && needsReceiptPaper(bill)) return false;
  if (bill.invoiceNumber !== undefined || bill.leftUnpaid === true || !owing(bill)) return false;
  return seen.dishes === undefined
    ? bill.status === "placed" || compareDecimal(decimal(bill.total), decimal("0")) !== 0
    : seen.dishes > 0;
}

/**
 * A bill the table cannot finish without paying, as near the server's `billOwes` as the wire allows:
 * the bills read sends no line count, so an open bill whose lines total zero reads as not owing, and
 * the server's refusal of Finish table handles it.
 */
export function stillToPay(
  bill: Pick<PartyBill, "status" | "outstanding" | "leftUnpaid">,
): boolean {
  return (
    !bill.leftUnpaid &&
    (bill.status === "placed" ||
      (bill.status === "open" && compareDecimal(decimal(bill.outstanding), decimal("0")) !== 0))
  );
}

/**
 * What a bill still owes: for a bill whose ticket is issued, its amount due (credit notes counted)
 * less what it has received (`total − outstanding`); else its outstanding.
 */
export function stillOwed(bill: Pick<PartyBill, "total" | "outstanding" | "amountDue">): string {
  if (bill.amountDue === undefined) return bill.outstanding;
  const received = subtractDecimal(decimal(bill.total), decimal(bill.outstanding));
  return toScale(subtractDecimal(decimal(bill.amountDue), received), MONEY_SCALE);
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
  return (
    shown.find((bill) => bill.workingOrderId === kept) ??
    shown.find((bill) => !bill.leftUnpaid && owing(bill)) ??
    shown[0]
  )?.workingOrderId;
}

/** "Bill 2", or "Bill" for a bill stored with no number. */
export function billNumberLabel(bill: Pick<PartyBill, "billNumber">): string {
  return bill.billNumber === null
    ? t("floor.unsent_bill_unnumbered")
    : fill(t("floor.unsent_bill"), { n: String(bill.billNumber) });
}

/** A bill's short label: "Bill 2", or "Bill 2 · Clint" when it has a name; "Bill" for a bill stored
 * with no number. */
export function billLabel(bill: Pick<PartyBill, "billNumber" | "billName">): string {
  const label = billNumberLabel(bill);
  return bill.billName === null ? label : `${label} · ${bill.billName}`;
}

/** A bill's label as a menu that writes it lowercase inside a sentence reads it: Spanish's
 * "la cuenta 2". */
export function billLabelInText(label: string): string {
  return label.charAt(0).toLocaleLowerCase() + label.slice(1);
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
