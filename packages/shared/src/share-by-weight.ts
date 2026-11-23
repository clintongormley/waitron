import {
  addDecimal,
  compareDecimal,
  decimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
  sumDecimals,
  toScale,
  type Decimal,
} from "./money.js";

const ZERO = decimal("0.00");
const CENT = decimal("0.01");

/**
 * `total` shared in proportion to `weights`: each share rounded down to the cent, then the cents
 * left over one at a time to the largest remainders, a tie to the earlier weight. With `total` in
 * whole cents and no weight below zero, the shares sum to `total`. Weights adding up to zero refuse
 * `shared.invalid_decimal` unless `total` is zero.
 */
export function shareByWeight(total: Decimal, weights: readonly Decimal[]): Decimal[] {
  if (compareDecimal(total, ZERO) === 0) return weights.map(() => ZERO);
  const sum = sumDecimals(weights);
  const shares = weights.map((weight, index) => {
    const numerator = multiplyDecimal(total, weight);
    let amount = divideDecimal(numerator, sum, 2);
    if (compareDecimal(multiplyDecimal(amount, sum), numerator) > 0)
      amount = subtractDecimal(amount, CENT);
    return { index, amount, remainder: subtractDecimal(numerator, multiplyDecimal(amount, sum)) };
  });
  let left = subtractDecimal(total, sumDecimals(shares.map((share) => share.amount)));
  for (const share of [...shares].sort(
    (a, b) => compareDecimal(b.remainder, a.remainder) || a.index - b.index,
  )) {
    if (compareDecimal(left, ZERO) <= 0) break;
    share.amount = addDecimal(share.amount, CENT);
    left = subtractDecimal(left, CENT);
  }
  return shares.map((share) => toScale(share.amount, 2));
}
