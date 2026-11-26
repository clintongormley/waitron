import { afterEach, expect, it } from "vitest";
import { commands, userEvent } from "vitest/browser";
import type { TillProduct } from "../api/menu-api.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TillBasket } from "./basket.js";
import type { TillModifierPicker } from "./modifier-picker.js";
import { cleanupWidgets, mountWidget, touchContextMenu } from "./test-helpers.js";
import "./basket.js";

const dish: TillProduct = {
  id: "dish",
  name: "Staff soup",
  unitPrice: "5.00",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: null,
};
afterEach(async () => {
  await commands.parkTouch();
  cleanupWidgets();
});

async function opening() {
  const store = new WorkingOrderStore();
  store.addProduct(dish, "2", { note: "No salt" });
  const { el } = await mountWidget<TillBasket>("till-basket", { store, lineDetails: true });
  el.id = "line-gesture-probe";
  return { store, el, line: store.lines[0]! };
}
async function hold(el: TillBasket, selector: string) {
  if (navigator.maxTouchPoints > 0) {
    await commands.touchGesture({ at: `#line-gesture-probe ${selector}`, holdMs: 650 });
  } else {
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>(selector)!, { delay: 650 });
  }
  await el.updateComplete;
}

it("keeps the browser menu off a basket line during a touch hold", async () => {
  const { el } = await opening();
  expect(touchContextMenu(el.shadowRoot!.querySelector<HTMLElement>(".name")!)).toBe(true);
});

it("keeps the browser menu on a basket line without hold for details", async () => {
  const { el } = await opening();
  el.lineDetails = false;
  await el.updateComplete;
  expect(touchContextMenu(el.shadowRoot!.querySelector<HTMLElement>(".name")!)).toBe(false);
});

it("lets the browser offer Paste in the basket's quantity field", async () => {
  const { el, line } = await opening();
  el.openLineDetails(line);
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!;
  await picker.updateComplete;
  const quantity = picker.shadowRoot!.querySelector("[name=quantity]")!;
  expect(touchContextMenu(quantity.shadowRoot!.querySelector("input")!)).toBe(false);
});

it("A738 a held line opens one window without changing quantity or removing the dish", async () => {
  const { el, store, line } = await opening();
  await hold(el, ".name");
  const picker = el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker");
  expect(picker).not.toBeNull();
  expect(el.shadowRoot!.querySelectorAll("till-modifier-picker")).toHaveLength(1);
  expect(picker!.product.id).toBe("dish");
  expect(picker!.initialSelections?.note).toBe("No salt");
  expect(store.lines).toHaveLength(1);
  expect(store.lines[0]).toBe(line);
  expect(line.quantity).toBe("2");
});

it.each([".step-inc", ".step-dec", ".remove"])(
  "A738 holding the line control %s never opens line details",
  async (selector) => {
    const { el, store, line } = await opening();
    await hold(el, selector);
    expect(el.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
    if (selector === ".remove") expect(store.lines).toHaveLength(0);
    else {
      expect(store.lines[0]).toBe(line);
      expect(line.quantity).toBe(selector === ".step-inc" ? "3" : "1");
    }
  },
);
