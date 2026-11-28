import { expect, it, vi } from "vitest";
import type { TillProduct } from "../api/menu-api.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { pickProduct } from "./product-pick.js";

function tap(product: Partial<TillProduct>) {
  const store = new WorkingOrderStore();
  const emit = vi.spyOn(store, "emit");
  const openModifiers = vi.fn();
  pickProduct(
    { id: "water", name: "Water", unitPrice: "1.50", ...product } as TillProduct,
    store,
    openModifiers,
  );
  return { store, emit, openModifiers };
}

it("adds one of a product that can be sold now", () => {
  const { store } = tap({ available: true });
  expect(store.lines).toMatchObject([{ product: { id: "water" }, quantity: "1" }]);
});

it.each([
  ["is unavailable", { available: false }],
  [
    "has only unavailable variants",
    { variants: [{ id: "big", name: "Big", unitPrice: "2.00", available: false }] },
  ],
] as const)("does nothing when a tapped product %s", (_, product) => {
  const { store, emit, openModifiers } = tap(product as Partial<TillProduct>);
  expect(store.lines).toEqual([]);
  expect(emit).not.toHaveBeenCalled();
  expect(openModifiers).not.toHaveBeenCalled();
});
