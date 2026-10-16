import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TillCounterScreen } from "./till-counter-screen.js";
import "./till-counter-screen.js";

afterEach(cleanupWidgets);

it("offers the whole-order kitchen note above an empty counter basket", async () => {
  const previous = currentLocale();
  setLocale("en");
  try {
    const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
      store: new WorkingOrderStore(),
      counterTab: {
        key: "counter",
        title: "Counter",
        columns: 12,
        cards: [{ type: "basket", colSpan: 12, rowSpan: 1, config: {} }],
      },
    });
    const grid = el.shadowRoot!.querySelector("till-card-grid")!;
    await grid.updateComplete;
    const basket = grid.shadowRoot!.querySelector("till-basket")!;
    await basket.updateComplete;
    expect(basket.shadowRoot!.querySelector("till-order-kitchen-note")).not.toBeNull();
    expect(basket.shadowRoot!.textContent).toContain("Basket is empty");
  } finally {
    setLocale(previous);
  }
});

it("follows the basket scope and closes on same-id reload without changing a dish note", async () => {
  const store = new WorkingOrderStore();
  store.loadFrom("order-a", [
    {
      product: {
        id: "dish",
        name: "Dish",
        customerName: { es: "Plato" },
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
        category: null,
        allergens: null,
      },
      quantity: "1",
      note: "No ice",
    },
  ]);
  const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
    store,
    counterTab: {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [{ type: "basket", colSpan: 12, rowSpan: 1, config: {} }],
    },
  });
  const grid = el.shadowRoot!.querySelector("till-card-grid")!;
  await grid.updateComplete;
  const basket = grid.shadowRoot!.querySelector("till-basket")!;
  await basket.updateComplete;
  const heading = basket.shadowRoot!.querySelector("till-order-kitchen-note")!;
  await heading.updateComplete;
  expect(heading.scopeKey).toBe("order:order-a");
  heading.shadowRoot!.querySelector<HTMLElement>("[data-edit]")!.click();
  await heading.updateComplete;
  expect(heading.shadowRoot!.querySelector("wt-dialog")?.open).toBe(true);
  store.loadFrom("order-a", [...store.lines]);
  await basket.updateComplete;
  await heading.updateComplete;
  expect(heading.shadowRoot!.querySelector("wt-dialog")).toBeNull();
  expect(store.lines[0]?.note).toBe("No ice");
});
