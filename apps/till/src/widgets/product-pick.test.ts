import { expect, it, vi } from "vitest";
import type { TillProduct } from "../api/client.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import { pickProduct } from "./product-pick.js";

function tap(product: Partial<TillProduct>) {
  const store = { addProduct: vi.fn(), emit: vi.fn() };
  const openModifiers = vi.fn();
  pickProduct(
    { id: "water", name: "Water", unitPrice: "1.50", ...product } as TillProduct,
    store as unknown as WorkingOrderStore,
    openModifiers,
  );
  return { store, openModifiers };
}

it("adds one of a product that can be sold now", () => {
  const { store } = tap({ available: true });
  expect(store.addProduct).toHaveBeenCalledWith(
    expect.objectContaining({ id: "water" }),
    "1",
    undefined,
    undefined,
  );
});

it.each([
  ["is unavailable", { available: false }],
  [
    "has only unavailable variants",
    { variants: [{ id: "big", name: "Big", unitPrice: "2.00", available: false }] },
  ],
] as const)("does nothing when a tapped product %s", (_, product) => {
  const { store, openModifiers } = tap(product as Partial<TillProduct>);
  expect(store.addProduct).not.toHaveBeenCalled();
  expect(store.emit).not.toHaveBeenCalled();
  expect(openModifiers).not.toHaveBeenCalled();
});
