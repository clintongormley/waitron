import type { BillBalance, BillEditExpected } from "../api/client.js";

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
