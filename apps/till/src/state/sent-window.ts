import {
  type Decimal,
  MONEY_SCALE,
  addDecimal,
  decimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
  sumDecimals,
} from "@waitron/shared";
import type { CurrentOrderRow } from "../api/kitchen-api.js";
import type { SentSlice } from "./sent-panel.js";

export interface SentWindowShare {
  quantity: Decimal;
  served: Decimal;
  /** What the row charges for these portions. */
  amount: Decimal;
  /** A whole line's `value`, for the part of each line these portions take. */
  of: (value: Decimal) => Decimal;
  /** {@link amount} less these portions' part of each extra, so the window's lines add up to it. */
  dish: (extras: readonly Decimal[]) => Decimal;
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
  // Each line is divided once, so a whole line reads exactly what it costs.
  const lines = new Map<CurrentOrderRow, Decimal>();
  for (const slice of slices)
    lines.set(slice.row, addDecimal(lines.get(slice.row) ?? decimal("0"), decimal(slice.quantity)));
  const of = (value: Decimal) =>
    sumDecimals(
      [...lines].map(([row, quantity]) =>
        divideDecimal(multiplyDecimal(value, quantity), decimal(row.quantity), MONEY_SCALE),
      ),
    );
  const amount = sumDecimals(slices.map((slice) => decimal(slice.amount)));
  return {
    quantity: total(slices),
    served: total(slices.filter((slice) => slice.kind === "served")),
    amount,
    of,
    dish: (extras) => subtractDecimal(amount, sumDecimals(extras.map(of))),
  };
}
