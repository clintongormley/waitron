import { AppError } from "./errors.js";
import {
  MONEY_SCALE,
  addDecimal,
  compareDecimal,
  decimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
  type Decimal,
} from "./money.js";

const CENT = decimal("0.01");

const invalidCount = (): AppError =>
  new AppError("management.request_invalid", { field: "shareOf" });

/** `available / n`, rounded UP to the cent, so the shares of a bill sum to it exactly (plan D16). */
export function equalShare(available: Decimal, n: number): Decimal {
  if (!Number.isInteger(n) || n < 1) throw invalidCount();
  const divisor = decimal(String(n));
  const nearest = divideDecimal(available, divisor, MONEY_SCALE);
  return compareDecimal(multiplyDecimal(nearest, divisor), available) < 0
    ? addDecimal(nearest, CENT)
    : nearest;
}

/** Each of `n` guests' `equalShare` of what the guests before them left. Refuses more guests than
 * there are cents in `left`, where some would pay nothing. */
export function equalShares(left: Decimal, n: number): Decimal[] {
  if (!Number.isInteger(n) || n < 1) throw invalidCount();
  if (compareDecimal(multiplyDecimal(CENT, decimal(String(n))), left) > 0) throw invalidCount();
  const shares: Decimal[] = [];
  let remaining = left;
  for (let guest = n; guest >= 1; guest -= 1) {
    const share = equalShare(remaining, guest);
    shares.push(share);
    remaining = subtractDecimal(remaining, share);
  }
  return shares;
}
