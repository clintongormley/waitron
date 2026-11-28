import type { WorkedBill } from "@waitron/adjustments";
import { centsToDecimal, type PendingDiscountView } from "@waitron/shared";
import { targetOf, type HeldBill } from "./bill-discounts-read.js";

/** `bill`'s pending discounts as `worked` works them out for its total and owed figure, in order. */
export function discountViewsOf(bill: HeldBill, worked: WorkedBill): PendingDiscountView[] {
  return worked.discounts.map((one): PendingDiscountView => {
    const held = bill.held.get(one.id)!;
    return {
      id: one.id,
      target: targetOf(held),
      action: held.action,
      percentBp: held.percentBp,
      amount: held.amount === null ? null : centsToDecimal(held.amount),
      takes: centsToDecimal(one.takes),
      holds: one.holds,
      origin: held.origin,
      reasonName: held.reasonName,
    };
  });
}
