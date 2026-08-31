import {
  MONEY_SCALE,
  type Decimal,
  addDecimal,
  decimal,
  grossOf,
  multiplyDecimal,
  sumDecimals,
  toScale,
} from "@waitron/shared";
import type { Doneness } from "../api/client.js";
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
 * `priceDelta × (dishQuantity × optionQuantity)` — the option is priced at the DISH quantity TIMES its
 * own per-option quantity (per-option quantity: an "extra shot ×2" is taken twice per dish). The two
 * integer counts are combined through `multiplyDecimal(decimal(...))` — the SAME BigInt-decimal
 * arithmetic `grossOf` uses, never a float — before the single `grossOf` multiply and rounding, so a
 * line whose options omit `quantity` (combined count `dishQuantity × 1`) is byte-identical to before.
 * This is DISPLAY-ONLY: the server re-prices from the option ids and re-validates the count
 * authoritatively. It mirrors `@waitron/catalogue`'s `priceBasketWithOptions`, which prices the parent
 * dish and every child option as SEPARATE rows through the same `grossOf` arithmetic (child qty =
 * dishQty × optionQty) and sums the rounded per-row grosses — so this ROUNDS EACH component then sums
 * (never one rounding of the summed per-unit price), keeping the preview equal to the server's per-line
 * total to the céntimo. A line with no `options` returns the bare dish gross, byte-identical to before.
 */
export function lineGross(line: OrderLine): Decimal {
  const dish = dishGross(line);
  const options = line.options ?? [];
  if (options.length === 0) {
    return dish;
  }
  const optionsGross = sumDecimals(options.map((option) => optionGross(line, option)));
  return toScale(addDecimal(dish, optionsGross), MONEY_SCALE);
}

/**
 * The combined count a single option is priced at: the DISH quantity times this option's own
 * per-option quantity (absent = 1). Built with `multiplyDecimal(decimal(...))` — the exact
 * BigInt-decimal multiply, no float — so it composes with `grossOf` the same way the server's
 * `priceBasketWithOptions` computes a child row's `dishQty × optionQty`. An omitted `quantity`
 * multiplies by "1", leaving the count (and therefore the price) byte-identical to the dish quantity.
 */
function combinedOptionQuantity(line: OrderLine, option: SelectedLineOption): Decimal {
  return multiplyDecimal(decimal(line.quantity), decimal(String(option.quantity ?? 1)));
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
 * One selected option's gross contribution on a line — its `priceDelta × (dishQuantity ×
 * optionQuantity)` (per-option quantity: the modifier is priced per dish AND per its own count, so an
 * "extra shot ×2" on 3 dishes prices six times), "0.00" for a free option. The two integer counts are
 * combined via {@link combinedOptionQuantity} (exact decimal multiply, no float) before the single
 * `grossOf`; an option that omits `quantity` prices at the bare dish quantity, byte-identical to
 * before. The basket renders this indented beneath the dish (Task 8); it mirrors the child sale_line's
 * filed gross.
 */
export function optionGross(line: OrderLine, option: SelectedLineOption): Decimal {
  return grossOf(option.priceDelta, combinedOptionQuantity(line, option));
}

/** How much of a line: `"N kg"` for a weight product, the bare count for an `each` product. */
export function quantityLabel(line: OrderLine): string {
  return line.product.pricingUnit === "weight" ? `${line.quantity} kg` : line.quantity;
}

/**
 * Maps a client-side selected option to the wire shape every send builder posts
 * (`SaleLine.options`, `RoundLine.options`). The wire carries the bare `optionGroupItemId`, plus the
 * per-option quantity ONLY when it exceeds 1 (per-option quantity, feature A): the server prices and
 * re-validates the count. Omitted at 1/absent so a plain modifier's wire stays byte-identical to
 * before — the ONE mapping shared by `till-app`'s `#currentSaleLines` and
 * `till-table-order-screen`'s round builder.
 */
export function toWireOption(option: SelectedLineOption): {
  optionGroupItemId: string;
  quantity?: number;
} {
  const wireOption: { optionGroupItemId: string; quantity?: number } = {
    optionGroupItemId: option.optionGroupItemId,
  };
  if (option.quantity !== undefined && option.quantity > 1) {
    wireOption.quantity = option.quantity;
  }
  return wireOption;
}

/**
 * Maps a line's per-line customisation (order-line customisation) to the `note`/`doneness` fields every
 * send builder spreads onto its wire line (`SaleLine`, `RoundLine`). Each key is present ONLY when the
 * line carries it — the same omission pattern as {@link toWireOption} — so a plain line's wire is
 * byte-identical to before (an empty object spreads nothing). The ONE mapping shared by `till-app`'s
 * `#currentSaleLines`, `till-table-order-screen`'s round builder, and the modifier picker's confirm
 * (`product-grid`). The server trims/validates both; they never reach a sale or a huella.
 *
 * The parameter is the MINIMAL `{ note?; doneness? }` shape, not the full `OrderLine` — both `OrderLine`
 * and the picker's `ModifierConfirmDetail` satisfy it structurally, so every caller passes its own line
 * object directly without hand-copying the two fields first.
 */
export function toWireLineExtras(line: { note?: string; doneness?: Doneness }): {
  note?: string;
  doneness?: Doneness;
} {
  const extras: { note?: string; doneness?: Doneness } = {};
  if (line.note !== undefined) {
    extras.note = line.note;
  }
  if (line.doneness !== undefined) {
    extras.doneness = line.doneness;
  }
  return extras;
}
