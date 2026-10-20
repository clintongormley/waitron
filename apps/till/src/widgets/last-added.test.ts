import { afterEach, expect, it } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { WorkingOrderStore } from "../state/working-order.js";
import type { OrderLine } from "../state/working-order.js";
import type { TillProduct } from "../api/client.js";
import { TillLastAdded } from "./last-added.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

const dish: TillProduct = {
  id: "soup",
  menuItemId: "offer-soup",
  name: "Staff soup",
  customerName: { en: "Customer soup" },
  kitchenName: "Kitchen soup",
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
async function mount(quantity = "2", product = dish) {
  const store = new WorkingOrderStore();
  store.addProduct(product, quantity);
  const { el } = await mountWidget<TillLastAdded>("till-last-added", { store });
  return { el, store };
}
const step = (el: TillLastAdded, by: number) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-last-added-step="${by}"]`)!;
const detail = (el: TillLastAdded) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-last-added-detail]")!;

it("A738 last-added steps exactly its saved line and removes it at one", async () => {
  const { el, store } = await mount();
  const first = store.lines[0]!;
  store.addProduct(dish, "1");
  const latest = store.lines[1]!;
  await el.updateComplete;
  await userEvent.click(step(el, 1));
  await el.updateComplete;
  expect(first.quantity).toBe("2");
  expect(latest.quantity).toBe("2");
  await userEvent.click(step(el, -1));
  await el.updateComplete;
  expect(latest.quantity).toBe("1");
  await userEvent.click(step(el, -1));
  await el.updateComplete;
  expect(store.lines).toEqual([first]);
  expect(el.shadowRoot!.querySelector("[data-last-added]")).toBeNull();
});
it.each(["weight", "fractional"])(
  "A738 last-added never offers whole steps for %s",
  async (kind) => {
    const product =
      kind === "weight"
        ? { ...dish, pricingUnit: "weight" as const }
        : {
            ...dish,
            unit: {
              id: "ml",
              name: { en: "Millilitre" },
              abbreviation: { en: "ml" },
              precision: 3,
              hardwareUnit: null,
            },
          };
    const { el, store } = await mount("0.375", product);
    expect(el.shadowRoot!.textContent).toContain("×0.375");
    expect(el.shadowRoot!.querySelector("[data-last-added-step]")).toBeNull();
    expect(store.lines[0]!.quantity).toBe("0.375");
  },
);
it("A738 last-added hold emits one matching detail and never changes quantity", async () => {
  const { el, store } = await mount();
  const seen: OrderLine[] = [];
  el.addEventListener("open-line-details", (event) =>
    seen.push((event as CustomEvent<{ line: OrderLine }>).detail.line),
  );
  if (navigator.maxTouchPoints > 0) {
    el.id = "last-added-gesture";
    await commands.touchGesture({
      at: "#last-added-gesture [data-last-added-detail]",
      holdMs: 650,
    });
  } else await userEvent.click(detail(el), { delay: 650 });
  expect(seen).toEqual([store.lines[0]]);
  expect(store.lines[0]!.quantity).toBe("2");
  expect(el.shadowRoot!.textContent).toContain("Staff soup");
  expect(el.shadowRoot!.textContent).not.toContain("Customer soup");
  expect(el.shadowRoot!.textContent).not.toContain("Kitchen soup");
});
it("A738 holding a step changes once without opening details", async () => {
  const { el, store } = await mount();
  const seen: unknown[] = [];
  el.addEventListener("open-line-details", (e) => seen.push(e));
  await userEvent.click(step(el, 1), { delay: 650 });
  expect(store.lines[0]!.quantity).toBe("3");
  expect(seen).toEqual([]);
});
it("A738 retained controls cannot step or inspect a replacement line", async () => {
  const { el, store } = await mount();
  const priorStep = step(el, 1),
    priorDetail = detail(el);
  const seen: unknown[] = [];
  el.addEventListener("open-line-details", (e) => seen.push(e));
  store.loadFrom("replacement", [{ product: dish, quantity: "7" }]);
  priorStep.click();
  priorDetail.click();
  expect(store.lines[0]!.quantity).toBe("7");
  expect(seen).toEqual([]);
});
it.each(["disabled", "sending", "locked", "readOnly"])(
  "A738 %s refuses quantity changes",
  async (mode) => {
    const { el, store } = await mount();
    const prior = step(el, 1);
    if (mode === "disabled") el.disabled = true;
    else if (mode === "sending") store.sending = true;
    else if (mode === "locked") store.lockEdits();
    else el.readOnly = true;
    prior.click();
    await el.updateComplete;
    expect(store.lines[0]!.quantity).toBe("2");
    expect((step(el, 1) as HTMLElement & { disabled: boolean }).disabled).toBe(true);
  },
);
it("A738 last-added follows a new store and ignores later old-store changes", async () => {
  const { el, store } = await mount();
  const replacement = new WorkingOrderStore();
  replacement.addProduct({ ...dish, name: "New staff dish" }, "3");
  el.store = replacement;
  await el.updateComplete;
  replacement.addMerging({ ...dish, name: "New staff dish" }, "2");
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain("New staff dish");
  expect(el.shadowRoot!.textContent).toContain("×5");
  store.addProduct(dish, "9");
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain("×5");
  expect(el.shadowRoot!.textContent).not.toContain("×9");
});
