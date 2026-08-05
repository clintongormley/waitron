import { MONEY_SCALE, type Decimal, decimal, multiplyDecimal, toScale } from "@waitron/shared";
import type { OrderLine } from "./working-order.js";

/**
 * Gross line total = `unitPrice × quantity`, rounded to money scale, in `@waitron/shared` Decimals
 * (never a float). Callers format it for display with their own locale
 * (`formatMoney(lineGross(line), locale)`).
 *
 * This MIRRORS `@waitron/catalogue`'s `priceBasket` per-line gross expression
 * (`toScale(multiplyDecimal(decimal(unitPrice), decimal(quantity)), MONEY_SCALE)`), which is the SAME
 * arithmetic the server prices and files with. Sharing this one helper between the basket preview
 * (`till-basket`) and the printed ticket (`till-ticket-view`) is what keeps a rung-up row, the
 * receipt line and the filed total from ever rounding differently.
 */
export function lineGross(line: OrderLine): Decimal {
  return toScale(
    multiplyDecimal(decimal(line.product.unitPrice), decimal(line.quantity)),
    MONEY_SCALE,
  );
}

/** How much of a line: `"N kg"` for a weight product, the bare count for an `each` product. */
export function quantityLabel(line: OrderLine): string {
  return line.product.pricingUnit === "weight" ? `${line.quantity} kg` : line.quantity;
}
