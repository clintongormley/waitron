import {
  MONEY_SCALE,
  type Decimal,
  type ExtraSelection,
  addDecimal,
  decimal,
  grossOf,
  multiplyDecimal,
  sumDecimals,
  toScale,
} from "@waitron/shared";
import type { SaleLine, TillProduct } from "../api/client.js";
import type { OrderLine, SelectedExtra } from "./working-order.js";
import { unitName } from "../widgets/product-name.js";

/**
 * Gross line total = the dish plus every extras pick, in `@waitron/shared` Decimals (never a float).
 * Callers format it for display with their own locale (`formatMoney(lineGross(line), locale)`).
 *
 * The dish delegates to `@waitron/shared`'s `grossOf` — the ONE per-line gross primitive, which
 * MIRRORS `@waitron/catalogue`'s `priceBasket` per-line gross expression
 * (`toScale(multiplyDecimal(decimal(unitPrice), decimal(quantity)), MONEY_SCALE)`), the SAME
 * arithmetic the server prices and files with. Routing the basket preview (`till-basket`), the
 * printed ticket (`till-ticket-view`) and the tab drawer (`till-table-order-screen`) through that one
 * primitive is what keeps a rung-up row, the receipt line and the filed total from ever rounding
 * differently.
 *
 * Each extras pick adds `price × (dishQuantity × pickQuantity)` — a pick is taken per dish AND by its
 * own count, so "extra bacon ×2" on three burgers is billed six times. The two integer counts are
 * combined through `multiplyDecimal(decimal(...))` — the SAME BigInt-decimal arithmetic `grossOf`
 * uses, never a float — before the single `grossOf` multiply and rounding. This is DISPLAY-ONLY: the
 * server re-resolves each pick's price from the offer and re-validates its count. It mirrors
 * `@waitron/catalogue`'s `priceBasketWithOptions`, which prices the parent dish and every child as
 * SEPARATE rows through the same `grossOf` arithmetic (child qty = dishQty × pickQty) and sums the
 * rounded per-row grosses — so this ROUNDS EACH component then sums (never one rounding of the summed
 * per-unit price), keeping the preview equal to the server's per-line total to the céntimo.
 *
 * An OPTIONS answer contributes nothing: it is a kitchen instruction with no price of its own (spec
 * §2). A line with no extras returns the bare dish gross.
 */
export function lineGross(line: OrderLine): Decimal {
  const dish = dishGross(line);
  const extras = line.extras ?? [];
  if (extras.length === 0) {
    return dish;
  }
  const extrasGross = sumDecimals(extras.map((extra) => extraGross(line, extra)));
  return toScale(addDecimal(dish, extrasGross), MONEY_SCALE);
}

/**
 * The combined count one pick is priced at: the DISH quantity times how many of that product the
 * dish takes. Built with `multiplyDecimal(decimal(...))` — the exact BigInt-decimal multiply, no
 * float — so it composes with `grossOf` the same way the server's `priceBasketWithOptions` computes a
 * child row's `dishQty × pickQty`.
 */
function combinedPickQuantity(line: OrderLine, extra: SelectedExtra): Decimal {
  return multiplyDecimal(decimal(line.quantity), decimal(String(extra.quantity)));
}

/**
 * The DISH's own gross line total — `unitPrice × quantity`, WITHOUT any extras pick. The basket shows
 * the dish row at this price while each pick renders on its own indented row at {@link extraGross};
 * the two split what {@link lineGross} sums. Same `grossOf` primitive, so the dish row and the grand
 * total never round differently.
 */
export function dishGross(line: OrderLine): Decimal {
  return grossOf(line.product.unitPrice, line.quantity);
}

/**
 * One extras pick's gross contribution on a line — its resolved `price × (dishQuantity ×
 * pickQuantity)`, "0.00" for a free pick. The two counts are combined via
 * {@link combinedPickQuantity} (exact decimal multiply, no float) before the single `grossOf`. The
 * basket renders this indented beneath the dish; it mirrors the child sale line's filed gross.
 */
export function extraGross(line: OrderLine, extra: SelectedExtra): Decimal {
  return grossOf(extra.price, combinedPickQuantity(line, extra));
}

/**
 * Whether tapping this product has anything to ask before it can be rung up: a variant to choose (a
 * product with variants is never sold as itself, spec §15.1), or an offered list to answer.
 *
 * The two surfaces that ADD a line both read this — the product grid's tap and tender-pay's weighed
 * quantity — because both hand the picker's own `detail.product` to `addProduct`, so a variant the
 * dialog resolved reaches the line. The basket's Edit button does NOT read this: it gates on the
 * offered lists alone, because `setLineModifiers` replaces a line's answers and never its product.
 * What that narrower gate buys is ONE case: a dish whose only question is its variant gets no Edit
 * button at all, rather than a dialog whose save would carry nothing (`basket.ts`; `basket.test.ts`,
 * "offers no Edit on a line whose only question was its variant"). It does NOT cover the MIXED case
 * — a dish carrying variants AND at least one offered list passes that gate, the dialog then draws
 * the variant fieldset and refuses Save until one is picked, and `setLineModifiers` then never
 * carries that pick onto the line. Open, with the measurement, in `docs/backlog.md` — Task 12, the
 * entry beginning "Reopening the picker".
 */
export function needsModifierPicker(
  product: Pick<TillProduct, "variants" | "offeredModifiers">,
): boolean {
  if ((product.variants ?? []).length > 0) return true;
  return (product.offeredModifiers ?? []).length > 0;
}

/** How much of a line, followed by the selected unit's localized short label (its abbreviation). */
export function quantityLabel(line: OrderLine): string {
  return `${line.quantity} ${unitName(line.product)}`;
}

/**
 * Maps a line's per-line customisation (order-line customisation) to the `note` field every send builder
 * spreads onto its wire line (`SaleLine`, `RoundLine`). The key is present ONLY when the line carries it
 * — the same omission pattern as {@link toWireModifiers} — so a plain line's wire is byte-identical to
 * before (an empty object spreads nothing). The ONE mapping shared by `till-app`'s `#currentSaleLines`,
 * `till-table-order-screen`'s round builder, and the modifier picker's confirm (`product-grid`). The
 * server trims/validates it; it never reaches a sale or a huella.
 *
 * The parameter is the MINIMAL `{ note? }` shape, not the full `OrderLine` — both `OrderLine` and the
 * picker's `ModifierConfirmDetail` satisfy it structurally, so every caller passes its own line object
 * directly without hand-copying the field first.
 */
export function toWireLineExtras(line: { note?: string }): { note?: string } {
  const extras: { note?: string } = {};
  if (line.note !== undefined) {
    extras.note = line.note;
  }
  return extras;
}

/** Serialize the selected menu identity; the server refuses a line that names no menu item. */
export function toWireProductIdentity(product: {
  id: string;
  menuItemId?: string;
  variantId?: string;
}): Pick<SaleLine, "menuItemId" | "variantId"> {
  if (product.menuItemId === undefined) {
    throw new Error(`product ${product.id} has no menu item to sell it by`);
  }
  return {
    menuItemId: product.menuItemId,
    ...(product.variantId === undefined ? {} : { variantId: product.variantId }),
  };
}

/**
 * The two answer fields every send builder posts (`SaleLine`, `RoundLine`): one `extras` entry per
 * list the line picked from, each carrying that list's picks, and the `options` answers as they are
 * already held. Picks are grouped by their `listId` in the order the picks themselves are held, which
 * is the order the picker walked the dish's offered lists.
 *
 * Neither key is sent when the line answered nothing of that kind — never `[]` — so a plain line's
 * wire is byte-identical to a one-tap add. No display value travels: a pick sends its product and
 * count alone, and the server re-resolves the price, the VAT class and the three names.
 */
export function toWireModifiers(
  line: Pick<OrderLine, "extras" | "options">,
): Pick<SaleLine, "extras" | "options"> {
  const wire: Pick<SaleLine, "extras" | "options"> = {};
  const byList = new Map<string, ExtraSelection>();
  for (const extra of line.extras ?? []) {
    const selection = byList.get(extra.listId) ?? { listId: extra.listId, picks: [] };
    selection.picks.push({ productId: extra.productId, quantity: extra.quantity });
    byList.set(extra.listId, selection);
  }
  if (byList.size > 0) wire.extras = [...byList.values()];
  if (line.options?.length) wire.options = line.options;
  return wire;
}
