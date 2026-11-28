import type { WorkedBill } from "@waitron/adjustments";
import { centsToDecimal, type PendingDiscountView } from "@waitron/shared";
import { givenTogether, targetOf, type HeldBill } from "./bill-discounts-read.js";

/** `bill`'s pending discounts as `worked` works them out for its total and owed figure, one per
 * discount given (its rows sharing `given_together`), in the order each is first worked out. */
export function discountViewsOf(bill: HeldBill, worked: WorkedBill): PendingDiscountView[] {
  return givenTogether(bill, worked.discounts).map((group): PendingDiscountView => {
    const first = bill.held.get(group[0]!.id)!;
    const rows = group.map(({ id }) => bill.held.get(id)!);
    const sum = (cents: number[]) => centsToDecimal(cents.reduce((all, one) => all + one, 0));
    return {
      id: first.id,
      target: targetOf(first),
      action: first.action,
      percentBp: first.percentBp,
      amount: first.amount === null ? null : sum(rows.map(({ amount }) => amount ?? 0)),
      takes: sum(group.map(({ takes }) => takes)),
      holds: group.find(({ holds }) => holds !== "yes")?.holds ?? "yes",
      origin: first.origin,
      reasonName: first.reasonName,
    };
  });
}
