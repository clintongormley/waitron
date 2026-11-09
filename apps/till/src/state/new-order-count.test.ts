import { describe, expect, it } from "vitest";
import type { TillProduct } from "../api/client.js";
import { newOrderByProduct, newOrderDishes, newOrderItems } from "./new-order-count.js";
import type { OrderLine } from "./working-order.js";

const dish = (id: string, name: string, extra: Partial<TillProduct> = {}): TillProduct => ({
  id,
  name,
  pricingUnit: "each",
  unitPrice: "4.00",
  vatClass: "general",
  category: null,
  allergens: null,
  ...extra,
});

const croquettes = dish("croquettes", "Croquettes");
const pork = dish("pork", "Pork shoulder");
const name = (line: OrderLine): string => line.product.name;

describe("counting the New order", () => {
  it("dishes by name, summed, first appearance first", () => {
    const lines: OrderLine[] = [
      { product: { ...croquettes, variantId: "aioli", variantName: "aioli" }, quantity: "1" },
      { product: pork, quantity: "1" },
      { product: { ...croquettes, variantId: "plain", variantName: "no sauce" }, quantity: "1" },
    ];
    expect(newOrderDishes(lines, name)).toEqual([
      { name: "Croquettes", items: 2 },
      { name: "Pork shoulder", items: 1 },
    ]);
    expect(newOrderItems(lines)).toBe(3);
  });

  it("by product, whatever the variant", () => {
    const beer = dish("beer", "Beer");
    const lines: OrderLine[] = [
      { product: { ...beer, variantId: "small", variantName: "Small" }, quantity: "1" },
      { product: { ...beer, variantId: "large", variantName: "Large" }, quantity: "2" },
    ];
    expect(newOrderByProduct(lines)).toEqual(new Map([["beer", 3]]));
  });

  it("an empty New order", () => {
    expect(newOrderItems([])).toBe(0);
    expect(newOrderDishes([], name)).toEqual([]);
    expect(newOrderByProduct([])).toEqual(new Map());
  });
});
