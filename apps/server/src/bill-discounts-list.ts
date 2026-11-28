import type { Transaction } from "@waitron/db";
import { centsToDecimal, type PendingDiscountView } from "@waitron/shared";
import { gatherHeldBills, workOutHeldBill } from "./bill-discounts-read.js";

/**
 * Each of `billIds`' pending discounts, in the order they are worked out, with what each takes off
 * now as `workOutHeldBill` works it out for the bill's total and owed figure; a bill holding none
 * lists none.
 */
export async function readPendingDiscountViews(
  tx: Transaction,
  billIds: readonly string[],
): Promise<Map<string, PendingDiscountView[]>> {
  const bills = await gatherHeldBills(tx, billIds);
  const views = new Map<string, PendingDiscountView[]>();
  for (const billId of billIds) {
    const bill = bills.get(billId);
    if (bill === undefined) {
      views.set(billId, []);
      continue;
    }
    const given = new Map(bill.input.discounts.map((one) => [one.id, one]));
    views.set(
      billId,
      workOutHeldBill(bill).discounts.map((worked): PendingDiscountView => {
        const held = bill.held.get(worked.id)!;
        return {
          id: worked.id,
          target: given.get(worked.id)!.target,
          action: held.action,
          percentBp: held.percentBp,
          amount: held.amount === null ? null : centsToDecimal(held.amount),
          takes: centsToDecimal(worked.takes),
          holds: worked.holds,
          origin: held.origin,
          reasonName: held.reasonName,
        };
      }),
    );
  }
  return views;
}

/** `billId`'s pending discounts alone. */
export async function readBillPendingDiscounts(
  tx: Transaction,
  billId: string,
): Promise<PendingDiscountView[]> {
  return (await readPendingDiscountViews(tx, [billId])).get(billId)!;
}
