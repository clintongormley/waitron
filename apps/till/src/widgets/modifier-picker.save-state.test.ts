import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./modifier-picker.js";
import type { ModifierConfirmDetail, TillModifierPicker } from "./modifier-picker.js";
import type { LineSelection } from "../state/working-order.js";
import type { OfferedModifier, TillProduct } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

function offeredItem(productId: string, staff: string, price: string) {
  return {
    portion: "1",
    unit: {
      name: { en: "Each", es: "Unidad", ca: "Unitat", eu: "Unitatea", gl: "Unidade" },
      hardwareUnit: null,
      id: "00000000-0000-0000-0000-000000000001",
      abbreviation: { en: "ea", es: "ud", ca: "u", eu: "u", gl: "u" },
      precision: 0,
    },
    productId,
    name: staff,
    customerName: { es: `${staff} carta` },
    kitchenName: `${staff} KDS`,
    price,
    vatClass: "general" as const,
    maxQuantity: 1,
    preselected: false,
    addAllergens: null,
    suitableFor: [],
  };
}

/** A required list: at least one side must be picked. */
const sides: OfferedModifier = {
  kind: "extras",
  id: "list-sides",
  name: "Sides",
  customerName: { es: "Guarniciones carta" },
  kitchenName: "Guarnición KDS",
  minPicks: 1,
  maxPicks: 2,
  items: [offeredItem("p-chips", "Chips", "0.00"), offeredItem("p-salad", "Salad", "1.00")],
};

const cooked: OfferedModifier = {
  kind: "options",
  id: "list-cooked",
  name: "Punto",
  customerName: { es: "Punto carta" },
  kitchenName: "Punto KDS",
  defaultLabelId: "label-medium",
  labels: [
    {
      id: "label-rare",
      name: "Poco hecha",
      customerName: { es: "Poco hecha carta" },
      kitchenName: "Poco hecha KDS",
      available: true,
    },
    {
      id: "label-medium",
      name: "Al punto",
      customerName: { es: "Al punto carta" },
      kitchenName: "Al punto KDS",
      available: true,
    },
  ],
};

const burger: TillProduct = {
  id: "burger",
  name: "Burger",
  customerName: { es: "Burger carta" },
  pricingUnit: "each",
  unitPrice: "8.00",
  vatClass: "general",
  category: null,
  allergens: null,
  offeredModifiers: [sides, cooked],
};

/** What a line read back from the basket carries: chips and medium. */
const stored: LineSelection = {
  extras: [
    { listId: "list-sides", productId: "p-chips", name: "Chips", price: "0.00", quantity: 1 },
  ],
  options: [{ listId: "list-cooked", labelId: "label-medium" }],
};

async function mount(props: Partial<TillModifierPicker>): Promise<TillModifierPicker> {
  const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
    product: burger,
    ...props,
  });
  return el;
}
function confirmButton(el: TillModifierPicker) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(".confirm")!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: TillModifierPicker) {
  await el.updateComplete;
  const save = confirmButton(el);
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const blocked = { variant: "primary", disabled: true, innerDisabled: true };
async function pick(el: TillModifierPicker, id: string) {
  el.shadowRoot!.querySelector<HTMLInputElement>(`#${id}`)!.click();
  await el.updateComplete;
}
function confirmations(el: TillModifierPicker) {
  const sent: ModifierConfirmDetail[] = [];
  el.addEventListener("wt-modifier-confirm", (event) =>
    sent.push((event as CustomEvent<ModifierConfirmDetail>).detail),
  );
  return sent;
}

it("edit mode opens with Save quiet and disabled", async () => {
  const el = await mount({ initialSelections: stored });
  expect(await saveState(el)).toEqual(quiet);
});

it("in edit mode one changed choice makes Save primary and enabled, and changing it back makes it quiet again", async () => {
  const el = await mount({ initialSelections: stored });
  await pick(el, "label-list-cooked-label-rare");
  expect(await saveState(el)).toEqual(ready);
  await pick(el, "label-list-cooked-label-medium");
  expect(await saveState(el)).toEqual(quiet);
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself sends nothing for untouched choices.
it("a press that reaches Save's handler on untouched choices sends nothing", async () => {
  const el = await mount({ initialSelections: stored });
  const sent = confirmations(el);
  confirmButton(el).click();
  await el.updateComplete;
  expect(sent).toEqual([]);
});

it("a change that leaves a required list short keeps Save primary but disabled", async () => {
  const el = await mount({ initialSelections: stored });
  await pick(el, "pick-list-sides-p-chips");
  expect(await saveState(el)).toEqual(blocked);
});

it("after a save that leaves the picker open, Save is quiet again", async () => {
  const el = await mount({ initialSelections: stored });
  const sent = confirmations(el);
  await pick(el, "label-list-cooked-label-rare");
  confirmButton(el).click();
  expect(sent).toHaveLength(1);
  expect(await saveState(el)).toEqual(quiet);
});

it("add mode opens with Add primary and enabled", async () => {
  const el = await mount({ product: { ...burger, offeredModifiers: [cooked] } });
  expect(await saveState(el)).toEqual(ready);
});

it("in add mode a press with the offer's defaults sends them", async () => {
  const el = await mount({ product: { ...burger, offeredModifiers: [cooked] } });
  const sent = confirmations(el);
  confirmButton(el).click();
  expect(sent).toHaveLength(1);
  expect(sent[0]!.options).toEqual([{ listId: "list-cooked", labelId: "label-medium" }]);
  expect(sent[0]!.extras).toBeUndefined();
});

const buttonFill = (host: Element) =>
  getComputedStyle(host.shadowRoot!.querySelector("button")!).backgroundColor;

it.each(["light", "dark"] as const)(
  "in add mode Add is quiet like Cancel while a required choice is missing, and blue once it is made (%s theme)",
  async (theme) => {
    const { el } = await mountWidget<TillModifierPicker>(
      "till-modifier-picker",
      { product: burger },
      theme,
    );
    const cancelFill = buttonFill(el.shadowRoot!.querySelector(".cancel")!);
    expect(await saveState(el)).toEqual(quiet);
    expect(buttonFill(confirmButton(el))).toBe(cancelFill);
    await pick(el, "pick-list-sides-p-chips");
    expect(await saveState(el)).toEqual(ready);
    expect(buttonFill(confirmButton(el))).not.toBe(cancelFill);
  },
);
