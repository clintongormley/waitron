import { afterEach, expect, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillTenderPay } from "./tender-pay.js";
import type { TillModifierPicker } from "./modifier-picker.js";
import { sellingValuesOf, type TillProduct } from "../api/client.js";

const jamon: TillProduct = {
  id: "jamon",
  name: "Jamón",
  customerName: { es: "Jamón para el cliente" },
  unit: {
    id: "unit-kg",
    name: { en: "kg", es: "kg" },
    abbreviation: { en: "kg", es: "kg" },
    precision: 3,
    hardwareUnit: "kg",
  },
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
  allergens: null,
};

/** A weighed dish whose one question is its variant, so Add opens the modifier picker. */
const jamonWithVariants: TillProduct = {
  ...jamon,
  variants: [
    {
      ...sellingValuesOf(jamon),
      id: "v-iberico",
      name: "Ibérico",
      unitPrice: "30.00",
      unitPriceDifference: "20.00",
      available: true,
    },
    {
      ...sellingValuesOf(jamon),
      id: "v-serrano",
      name: "Serrano",
      unitPrice: "10.00",
      unitPriceDifference: null,
      available: true,
    },
  ],
};

async function press(el: TillTenderPay, key: string): Promise<void> {
  const pad = el.shadowRoot!.querySelector("till-numeric-pad")!;
  await (pad as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  pad.shadowRoot!.querySelector<HTMLElement>(`[data-key="${key}"]`)!.click();
  await el.updateComplete;
}

async function type(el: TillTenderPay, keys: string): Promise<void> {
  for (const key of keys) await press(el, key);
}

const query = (el: TillTenderPay, selector: string) => el.shadowRoot!.querySelector(selector);
const click = (el: TillTenderPay, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();

async function openPicker(store: WorkingOrderStore): Promise<{
  el: TillTenderPay;
  picker: TillModifierPicker;
}> {
  const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
  store.emit("product-selected", jamonWithVariants);
  await el.updateComplete;
  await type(el, "0.250");
  click(el, ".add");
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!;
  await picker.updateComplete;
  return { el, picker };
}

afterEach(cleanupWidgets);

it("rings a whole weight typed with a trailing decimal point", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
  store.emit("product-selected", jamon);
  await el.updateComplete;
  await type(el, "2.");
  expect(query(el, ".add")!.hasAttribute("disabled")).toBe(false);
  click(el, ".add");
  expect(store.lines).toHaveLength(1);
  expect(store.lines[0]!.quantity).toBe("2");
  expect(store.total).toBe("20.00");
});

it("cancelling the weighed dish's picker rings nothing and returns to idle", async () => {
  const store = new WorkingOrderStore();
  const { el, picker } = await openPicker(store);
  picker.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
  await el.updateComplete;
  expect(query(el, "till-modifier-picker")).toBeNull();
  expect(store.lines).toHaveLength(0);
  expect(query(el, ".pay")).not.toBeNull();
});

it("a second confirm from the picker before it closes rings the weighed dish once", async () => {
  const store = new WorkingOrderStore();
  const { picker } = await openPicker(store);
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => {
    errors.push(event.error);
    event.preventDefault();
  };
  window.addEventListener("error", onError);
  try {
    const confirm = () =>
      picker.dispatchEvent(
        new CustomEvent("wt-modifier-confirm", {
          detail: { product: { ...jamon, variantId: "v-iberico", unitPrice: "30.00" } },
          bubbles: true,
          composed: true,
        }),
      );
    // Both land before Lit removes the picker, as a double tap would.
    confirm();
    confirm();
  } finally {
    window.removeEventListener("error", onError);
  }
  expect(errors).toEqual([]);
  expect(store.lines).toHaveLength(1);
  expect(store.lines[0]!.product.variantId).toBe("v-iberico");
  expect(store.lines[0]!.quantity).toBe("0.250");
});
