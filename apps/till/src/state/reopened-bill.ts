import type { BillBalance, BillEditExpected, PartyBill } from "../api/client.js";
import { fill, t } from "../i18n/t.js";
import { billLabel } from "./bill-state.js";

/** The table's bill a Pay for items answer carries, when it is not the bill the Pay window paid
 * from: on a printed bill the server reopens it, and the answer names the reopened bill. */
export function reopenedBill(
  paidFrom: string,
  sourceBalance: BillBalance | undefined,
): BillBalance | undefined {
  return sourceBalance === undefined || sourceBalance.workingOrderId === paidFrom
    ? undefined
    : sourceBalance;
}

/** The Pay window `open` moved to the bill `balance` names. That bill has no receipt, and the edit
 * state of the bill it came from would be refused there, so the next preview reads its own. */
export function movedToBill<
  T extends {
    billId: string;
    printed?: boolean;
    balance: BillBalance | null;
    expectedEdit: BillEditExpected | null;
  },
>(open: T, balance: BillBalance): T {
  return { ...open, billId: balance.workingOrderId, printed: false, balance, expectedEdit: null };
}

/** The screen's notice on `to`, the bill Pay for items reopened printed bill `from` as, naming the
 * corrective the bills read lists on `from`; null while `to` is not listed. */
export function creditedNotice(
  bills: readonly PartyBill[],
  reopen: { from: string; to: string },
): string | null {
  const shown = bills.find((bill) => bill.workingOrderId === reopen.to);
  if (shown === undefined) return null;
  const number = bills.find((bill) => bill.workingOrderId === reopen.from)?.correctives?.at(-1);
  return fill(t(number === undefined ? "table.bill_credited_unnumbered" : "table.bill_credited"), {
    number: number ?? "",
    shown: billLabel(shown),
  });
}
