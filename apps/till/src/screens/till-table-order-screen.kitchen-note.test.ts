import { WorkingOrderStore } from "../state/working-order.js";
import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import "./till-table-order-screen.js";

afterEach(cleanupWidgets);
it.each([false, true])(
  "offers the kitchen note before dishes on a table, handheld=%s",
  async (handheld) => {
    const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
      orderId: "bill-a",
      handheld,
    });
    const note = el.shadowRoot!.querySelector("till-order-kitchen-note");
    expect(note).not.toBeNull();
    const layout = el.shadowRoot!.querySelector(".layout")!;
    expect(note!.compareDocumentPosition(layout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  },
);

it("shows one note for the table rather than one per draft basket", async () => {
  const draftStore = new WorkingOrderStore();
  draftStore.addProduct(
    {
      id: "dish",
      name: "Dish",
      customerName: { es: "Plato" },
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
      category: null,
      allergens: null,
    },
    "1",
  );
  const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    orderId: "bill-a",
    draftStore,
  });
  const baskets = [...el.shadowRoot!.querySelectorAll("till-basket")];
  expect(baskets.length).toBeGreaterThan(0);
  for (const basket of baskets) {
    await basket.updateComplete;
    expect(basket.shadowRoot!.querySelector("till-order-kitchen-note")).toBeNull();
  }
});
