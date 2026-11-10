import { itemCount } from "./draft-groups.js";
import { takesExtras } from "./order-line.js";
import type { OrderLine } from "./working-order.js";

/** Whole units count by quantity; anything weighed or fractional counts as one (D4). A dish no
 * longer offered has no unit to read, so a whole quantity is counted as whole units. */
export function countsWholeUnits(line: OrderLine): boolean {
  return takesExtras(line.product) || (line.notOffered === true && /^\d+$/.test(line.quantity));
}

export function lineItems(line: OrderLine): number {
  return itemCount({ quantity: line.quantity, wholeUnits: countsWholeUnits(line) });
}

export function newOrderItems(lines: readonly OrderLine[]): number {
  return lines.reduce((sum, line) => sum + lineItems(line), 0);
}

/** One entry per name, items summed, in first-appearance order (D6). */
export function newOrderDishes(
  lines: readonly OrderLine[],
  name: (line: OrderLine) => string,
): { name: string; items: number }[] {
  const byName = new Map<string, number>();
  for (const line of lines) {
    const key = name(line);
    byName.set(key, (byName.get(key) ?? 0) + lineItems(line));
  }
  return [...byName].map(([dishName, items]) => ({ name: dishName, items }));
}

/** Product id → items, every line of the product whatever its variant or choices (D7). */
export function newOrderByProduct(lines: readonly OrderLine[]): Map<string, number> {
  const byProduct = new Map<string, number>();
  for (const line of lines) {
    const id = line.product.id;
    byProduct.set(id, (byProduct.get(id) ?? 0) + lineItems(line));
  }
  return byProduct;
}
