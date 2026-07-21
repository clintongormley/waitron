import { MONEY_SCALE, divideDecimal, multiplyDecimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";

/**
 * `ratePercent`% of `amount`, exact and rounded half away from zero to `scale` places (money
 * scale by default). `ratePercent` is a PERCENTAGE literal as this system stores it ("21.00"
 * meaning 21%), so the division by 100 is folded in: amount * rate / 100.
 *
 * Exact throughout via `@waitron/shared`'s BigInt decimal ops — this file no longer keeps its own
 * copy of that package's codec now that `divideDecimal` exists there.
 */
export function percentOf(amount: Decimal, ratePercent: Decimal, scale = MONEY_SCALE): Decimal {
  return divideDecimal(multiplyDecimal(amount, ratePercent), "100" as Decimal, scale);
}
