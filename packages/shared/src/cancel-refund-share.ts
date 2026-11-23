import {
  addDecimal,
  decimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
  sumDecimals,
  type Decimal,
} from "./money.js";

/**
 * The money a cancel of `quantity` may refund from a filed line of `value`, after `cancelledBefore`
 * were cancelled: the difference of two rounded shares, so successive cancels sum to the filed gross.
 */
export function cancelRefundShare(
  value: { quantity: string; gross: string },
  cancelledBefore: string,
  quantity: string,
): Decimal {
  const share = (portions: Decimal) =>
    divideDecimal(multiplyDecimal(decimal(value.gross), portions), decimal(value.quantity), 2);
  const before = decimal(cancelledBefore);
  return subtractDecimal(share(addDecimal(before, decimal(quantity))), share(before));
}

/**
 * The money a cancel of `quantity` portions of a till row may refund, given what each portion the
 * row can still give up refunds, in the order it gives them up; none when `quantity` is not a whole
 * number of those portions.
 */
export function rowCancelRefund(refunds: readonly string[], quantity: string): Decimal | undefined {
  const count = Number(quantity);
  if (!Number.isInteger(count) || count < 1 || count > refunds.length) return undefined;
  return sumDecimals(refunds.slice(0, count).map(decimal));
}
