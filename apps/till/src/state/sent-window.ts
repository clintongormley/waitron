import {
  type Decimal,
  MONEY_SCALE,
  decimal,
  divideDecimal,
  multiplyDecimal,
  sumDecimals,
} from "@waitron/shared";
import type { SentSlice } from "./sent-panel.js";

export interface SentWindowShare {
  quantity: Decimal;
  served: Decimal;
  /** What the row charges for these portions. */
  amount: Decimal;
  /** A whole line's `value`, for the part of each line these portions take. */
  of: (value: Decimal) => Decimal;
}

/** The portions a sent dish's window speaks for: the ones it opens on and the served ones its row
 * joins to them, each slice once, as the row adds them up (`toRow` in `sent-sections.ts`). */
export function sentWindowShare(
  own: readonly SentSlice[],
  served: readonly SentSlice[] = [],
): SentWindowShare {
  const slices = [...new Set([...own, ...served])];
  const total = (some: readonly SentSlice[]) =>
    sumDecimals(some.map((slice) => decimal(slice.quantity)));
  return {
    quantity: total(slices),
    served: total(slices.filter((slice) => slice.kind === "served")),
    amount: sumDecimals(slices.map((slice) => decimal(slice.amount))),
    of: (value) =>
      sumDecimals(
        slices.map((slice) =>
          divideDecimal(
            multiplyDecimal(value, decimal(slice.quantity)),
            decimal(slice.row.quantity),
            MONEY_SCALE,
          ),
        ),
      ),
  };
}
