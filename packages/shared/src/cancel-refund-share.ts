import {
  addDecimal,
  decimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
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
