import {
  MONEY_SCALE,
  type Decimal,
  addDecimal,
  grossOf,
  sumDecimals,
  toScale,
} from "@waitron/shared";
import type { OrderLine, SelectedLineOption } from "./working-order.js";

/**
 * Gross line total = `unitPrice × quantity`, rounded to money scale, in `@waitron/shared` Decimals
 * (never a float). Callers format it for display with their own locale
 * (`formatMoney(lineGross(line), locale)`).
 *
 * Delegates to `@waitron/shared`'s `grossOf` — the ONE per-line gross primitive, which MIRRORS
 * `@waitron/catalogue`'s `priceBasket` per-line gross expression
 * (`toScale(multiplyDecimal(decimal(unitPrice), decimal(quantity)), MONEY_SCALE)`), the SAME arithmetic
 * the server prices and files with. Routing the basket preview (`till-basket`), the printed ticket
 * (`till-ticket-view`) and the tab drawer (`till-table-order-screen`) through that one primitive is what
 * keeps a rung-up row, the receipt line and the filed total from ever rounding differently.
 *
 * ORDERING MODIFIERS (Task 9): when the line carries selected `options`, each modifier adds
 * `priceDelta × quantity` — the option is priced at the DISH quantity (a modifier is per dish, never
 * counted independently). This is DISPLAY-ONLY: the server re-prices from the option ids
 * authoritatively. It mirrors `@waitron/catalogue`'s `priceBasketWithOptions`, which prices the parent
 * dish and every child option as SEPARATE rows through the same `grossOf` arithmetic and sums the
 * rounded per-row grosses — so this ROUNDS EACH component then sums (never one rounding of the summed
 * per-unit price), keeping the preview equal to the server's per-line total to the céntimo. A line with
 * no `options` returns the bare dish gross, byte-identical to before.
 */
export function lineGross(line: OrderLine): Decimal {
  const dish = dishGross(line);
  const options = line.options ?? [];
  if (options.length === 0) {
    return dish;
  }
  const optionsGross = sumDecimals(
    options.map((option) => grossOf(option.priceDelta, line.quantity)),
  );
  return toScale(addDecimal(dish, optionsGross), MONEY_SCALE);
}

/**
 * The DISH's own gross line total — `unitPrice × quantity`, WITHOUT any option delta. Used by the
 * basket (Task 8) to show the dish row at its own price while each option renders on its own indented
 * row at {@link optionGross}; the two split what {@link lineGross} sums. Same `grossOf` primitive, so
 * the dish row and the grand total never round differently.
 */
export function dishGross(line: OrderLine): Decimal {
  return grossOf(line.product.unitPrice, line.quantity);
}

/**
 * One selected option's gross contribution on a line — its `priceDelta × the dish quantity` (a
 * modifier is priced per dish, never counted independently), "0.00" for a free option. The basket
 * renders this indented beneath the dish (Task 8); it mirrors the child sale_line's filed gross.
 */
export function optionGross(line: OrderLine, option: SelectedLineOption): Decimal {
  return grossOf(option.priceDelta, line.quantity);
}

/** How much of a line: `"N kg"` for a weight product, the bare count for an `each` product. */
export function quantityLabel(line: OrderLine): string {
  return line.product.pricingUnit === "weight" ? `${line.quantity} kg` : line.quantity;
}
