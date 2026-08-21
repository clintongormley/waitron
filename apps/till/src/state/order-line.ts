import { type Decimal, grossOf } from "@waitron/shared";
import type { OrderLine } from "./working-order.js";

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
 */
export function lineGross(line: OrderLine): Decimal {
  return grossOf(line.product.unitPrice, line.quantity);
}

/** How much of a line: `"N kg"` for a weight product, the bare count for an `each` product. */
export function quantityLabel(line: OrderLine): string {
  return line.product.pricingUnit === "weight" ? `${line.quantity} kg` : line.quantity;
}
