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
import { sellingValuesOf, type SaleLine, type TillProduct } from "../api/client.js";
import type { OrderLine, SelectedExtra } from "./working-order.js";
import { trimQuantity } from "../widgets/dish-format.js";
import { productUnit, unitName } from "../widgets/product-name.js";

type PricedPick = Pick<SelectedExtra, "price" | "quantity">;

/**
 * The dish plus every extras pick. Each component is rounded and then summed, as the server's
 * `grossBasketWithOptions` prices the dish and each pick as separate rows; never one rounding of a
 * summed unit price. A not-offered pick counts, because an unedited retrieved order is still billed
 * for it. An options answer has no price.
 */
export function lineGross(line: OrderLine): Decimal {
  const dish = dishGross(line);
  const extras = [...(line.extras ?? []), ...(line.notOfferedExtras ?? [])];
  if (extras.length === 0) {
    return dish;
  }
  const extrasGross = sumDecimals(extras.map((extra) => extraGross(line, extra)));
  return toScale(addDecimal(dish, extrasGross), MONEY_SCALE);
}

/** A pick is taken per dish AND by its own count: "extra bacon ×2" on three burgers bills six. */
function combinedPickQuantity(line: OrderLine, extra: PricedPick): Decimal {
  return multiplyDecimal(decimal(line.quantity), decimal(String(extra.quantity)));
}

/** The dish alone, WITHOUT any extras pick. */
export function dishGross(line: OrderLine): Decimal {
  return grossOf(line.product.unitPrice, line.quantity);
}

export function extraGross(line: OrderLine, extra: PricedPick): Decimal {
  return grossOf(extra.price, combinedPickQuantity(line, extra));
}

/**
 * Whether adding this product must ask something first: an offered list, or a variant, since a
 * product with variants is never sold as itself. The basket's Edit button does NOT use this: it
 * gates on the offered lists alone, because `setLineModifiers` never changes a line's product. A
 * dish with variants AND an offered list still loses a re-picked variant there; see
 * `docs/backlog.md`, the entry beginning "Reopening the picker".
 */
export function needsModifierPicker(
  product: Pick<TillProduct, "variants" | "offeredModifiers">,
): boolean {
  if ((product.variants ?? []).length > 0) return true;
  return (product.offeredModifiers ?? []).length > 0;
}

/**
 * The product as sold as one of its variants: under the variant's price and selling values, with the
 * variant's three names carried ALONGSIDE the product's, never folded into them. Each surface resolves
 * the name it shows (`product-presentation.ts`), so the basket can render the staff name while a
 * receipt renders the customer one.
 */
export function productAsVariant(
  product: TillProduct,
  variant: NonNullable<TillProduct["variants"]>[number],
): TillProduct {
  return {
    ...product,
    ...sellingValuesOf(variant),
    unitPrice: variant.unitPrice,
    variantId: variant.id,
    variantName: variant.name,
    variantCustomerName: variant.customerName ?? null,
    variantKitchenName: variant.kitchenName ?? null,
  };
}

/** A whole-count unit's three-place server quantity reads "2", not "2.000". */
export function displayQuantity(product: TillProduct, quantity: string): string {
  return productUnit(product).precision !== 0 ? quantity : trimQuantity(quantity);
}

export function quantityLabel(line: OrderLine): string {
  const unit = unitName(line.product);
  return unit === "" ? line.quantity : `${line.quantity} ${unit}`;
}

/** The decimal places a quantity uses, trailing zeros aside. */
export function quantityPlaces(quantity: string): number {
  return (quantity.split(".")[1] ?? "").replace(/0+$/, "").length;
}

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
  menuVersionId?: string;
}): Pick<SaleLine, "menuItemId" | "variantId" | "menuVersionId"> {
  if (product.menuItemId === undefined) {
    throw new Error(`product ${product.id} has no menu item to sell it by`);
  }
  return {
    menuItemId: product.menuItemId,
    ...(product.variantId === undefined ? {} : { variantId: product.variantId }),
    ...(product.menuVersionId === undefined ? {} : { menuVersionId: product.menuVersionId }),
  };
}

/** Neither key is sent when empty, never `[]`. No price, VAT rate or name travels. */
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
