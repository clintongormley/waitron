import { afterEach, expect, it, onTestFinished } from "vitest";
import { userEvent } from "vitest/browser";
import { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { sellingValuesOf, type TillProduct } from "../api/client.js";
import { productAsVariant } from "../state/order-line.js";
import { formatMoney } from "@waitron/shared";
import type { WtInput, WtTextarea } from "@waitron/ui";
import type { ModifierConfirmDetail, TillModifierPicker } from "./modifier-picker.js";
import { dish as listedDish } from "../screens/till-table-order-screen.sent-prices.test-helpers.js";
import { TillBasket } from "./basket.js";
import { TillCounterScreen } from "../screens/till-counter-screen.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

const dish: TillProduct = {
  id: "soup",
  name: "Staff soup",
  customerName: { en: "Customer soup" },
  unitPrice: "5.00",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: { nuts: { kinds: ["walnuts"] } },
  dietaryDeclarations: ["vegan"],
};
afterEach(cleanupWidgets);

async function opening() {
  const store = new WorkingOrderStore();
  store.addProduct({ ...dish, id: "other", name: "Other dish" }, "1");
  store.addProduct(dish, "2", { note: "No salt" });
  const { el } = await mountWidget<TillBasket>("till-basket", { store, lineDetails: true });
  return { store, el, line: store.lines[1]! };
}
const pickerOf = (el: TillBasket) =>
  el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker");

it("keeps the details open on a line of a store the basket was handed when that store changes", async () => {
  const { el } = await opening();
  const handed = new WorkingOrderStore();
  handed.addProduct(dish, "1");
  el.store = handed;
  await el.updateComplete;
  el.openLineDetails(handed.lines[0]!);
  await el.updateComplete;
  expect(pickerOf(el)).not.toBeNull();
  handed.sending = false;
  await el.updateComplete;
  expect(pickerOf(el)).not.toBeNull();
});

it("closes the details when the basket is handed another store, and does not reopen them on the way back", async () => {
  const { el, store, line } = await opening();
  el.openLineDetails(line);
  await el.updateComplete;
  expect(pickerOf(el)).not.toBeNull();
  el.store = new WorkingOrderStore();
  await el.updateComplete;
  el.store = store;
  await el.updateComplete;
  expect(pickerOf(el)).toBeNull();
});

it("A738 extra and note removal stage the same window without changing the line", async () => {
  const store = new WorkingOrderStore();
  store.addProduct(
    {
      ...dish,
      offeredModifiers: [
        {
          kind: "extras",
          id: "sides",
          name: "Sides",
          customerName: null,
          kitchenName: null,
          minPicks: 1,
          maxPicks: 2,
          items: [
            {
              presentation: {
                name: "Staff cheese",
                customerName: null,
                kitchenName: null,
                variantName: null,
                variantCustomerName: null,
                variantKitchenName: null,
              },
              productId: "cheese",
              name: "Staff cheese",
              customerName: null,
              kitchenName: null,
              portion: "1",
              unit: {
                id: "each",
                staffName: "Staff unit",
                staffAbbreviation: "su",
                name: { en: "Each" },
                abbreviation: { en: "ea" },
                precision: 0,
                hardwareUnit: null,
              },
              price: "0.50",
              vatClass: "general",
              takeawayVatClass: "general",
              maxQuantity: 2,
              preselected: false,
              addAllergens: { milk: {} },
              suitableFor: ["vegetarian"],
            },
          ],
        },
      ],
    },
    "2",
    {
      note: "No salt",
      extras: [
        {
          listId: "sides",
          productId: "cheese",
          name: "Staff cheese",
          price: "0.50",
          quantity: 1,
        },
      ],
    },
  );
  const { el } = await mountWidget<TillBasket>("till-basket", {
    store,
    lineDetails: true,
    allowPickRemoval: true,
    makeAtStations: [
      { id: "bar", name: "Bar" },
      { id: "kitchen", name: "Kitchen" },
    ] as TillBasket["makeAtStations"],
  });
  expect(el.shadowRoot!.querySelector("[data-make-at]")).toBeNull();
  expect(el.shadowRoot!.querySelector(".edit-modifiers")).toBeNull();
  expect(el.shadowRoot!.querySelector(".note-toggle")).toBeNull();
  const remove = el.shadowRoot!.querySelector<HTMLElement>("[data-remove-extra]");
  expect(remove).not.toBeNull();
  await userEvent.click(remove!);
  await el.updateComplete;
  const picker = pickerOf(el)!;
  await picker.updateComplete;
  expect(store.lines[0]!.extras).toHaveLength(1);
  expect(
    picker.shadowRoot!.querySelector<HTMLInputElement>('[id="pick-sides-cheese"]')?.checked ??
      picker.shadowRoot!.querySelector('[data-test="pick-sides-cheese-count"]')?.textContent,
  ).toBe("0");
  expect(
    picker.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(".confirm")!.disabled,
  ).toBe(true);
  await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".cancel")!);
  await el.updateComplete;
  expect(store.lines[0]!.extras).toHaveLength(1);
  const noteRemove = el.shadowRoot!.querySelector<HTMLElement>("[data-remove-note]");
  expect(noteRemove).not.toBeNull();
  await userEvent.click(noteRemove!);
  await el.updateComplete;
  const notePicker = pickerOf(el)!;
  await notePicker.updateComplete;
  expect(notePicker.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!.value).toBe("");
  expect(store.lines[0]!.note).toBe("No salt");
  await userEvent.click(notePicker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
  expect(store.lines[0]!.note).toBeUndefined();
  expect(store.lines[0]!.extras?.[0]?.name).toBe("Staff cheese");
});

it.each(["info", "hold", "double click", "note"])(
  "A738 opens the same plain-dish line window from %s after a sibling is removed",
  async (entry) => {
    const { store, el, line } = await opening();
    store.removeLine(0);
    await el.updateComplete;
    const row = el.shadowRoot!.querySelector<HTMLElement>(".line")!;
    if (entry === "info")
      await userEvent.click(row.querySelector<HTMLElement>("[data-line-detail]")!);
    if (entry === "hold")
      await userEvent.click(row.querySelector<HTMLElement>(".name")!, { delay: 650 });
    if (entry === "double click")
      await userEvent.dblClick(row.querySelector<HTMLElement>(".name")!);
    if (entry === "note")
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>(".line-extras-note")!);
    await el.updateComplete;
    expect(pickerOf(el), `missing line window for ${entry}`).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("till-modifier-picker")).toHaveLength(1);
    expect(pickerOf(el)!.product.name).toBe("Staff soup");
    expect(pickerOf(el)!.initialSelections?.note).toBe("No salt");
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]).toBe(line);
    expect(line.quantity).toBe("2");
  },
);

it("A738 never opens a stale line or opens inspection during an order request", async () => {
  const { el, store, line } = await opening();
  expect(typeof el.openLineDetails).toBe("function");
  store.removeLine(1);
  el.openLineDetails(line);
  await el.updateComplete;
  expect(pickerOf(el)).toBeNull();
  el.orderInFlight = true;
  el.openLineDetails(store.lines[0]!);
  await el.updateComplete;
  expect(pickerOf(el)).toBeNull();
});

it("A738 collection inspection without a listing has no editable note or Save", async () => {
  const prior = currentLocale();
  setLocale("en-GB");
  try {
    const { el, store, line } = await opening();
    Object.assign(el, { readOnly: true, storedLines: null });
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-line-detail="1"]')!);
    await el.updateComplete;
    const picker = pickerOf(el)!;
    expect(picker).not.toBeNull();
    await picker.updateComplete;
    expect(picker.shadowRoot!.querySelector("wt-textarea")).toBeNull();
    expect(picker.shadowRoot!.querySelector(".confirm")).toBeNull();
    expect(picker.shadowRoot!.textContent).toContain("No salt");
    expect(picker.shadowRoot!.textContent).toContain("Walnuts");
    expect(picker.shadowRoot!.textContent).toContain("Vegan");
    expect(picker.shadowRoot!.querySelector(".cancel")!.textContent!.trim()).toBe("Close");
    picker.dispatchEvent(
      new CustomEvent("wt-modifier-confirm", {
        detail: { product: dish, note: "Changed", quantity: "3" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(line.note).toBe("No salt");
    expect(line.quantity).toBe("2");
    expect(store.lines).toHaveLength(2);
  } finally {
    setLocale(prior);
  }
});

it("A738 a retrieved placed order keeps its Counter basket read-only without adjustment facts", async () => {
  const store = new WorkingOrderStore();
  store.loadFrom("placed-order", [{ product: dish, quantity: "2", note: "Recorded note" }]);
  const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
    store,
    stage: "collect",
    storedLines: null,
  });
  const basket = el.shadowRoot!.querySelector<TillBasket>("till-basket")!;
  await basket.updateComplete;
  await userEvent.click(basket.shadowRoot!.querySelector<HTMLElement>("[data-line-detail]")!);
  await basket.updateComplete;
  const picker = pickerOf(basket)!;
  await picker.updateComplete;
  expect(picker.shadowRoot!.querySelector("wt-textarea")).toBeNull();
  expect(picker.shadowRoot!.querySelector(".confirm")).toBeNull();
  expect(basket.shadowRoot!.querySelector(".step-inc")).toBeNull();
  expect(basket.shadowRoot!.querySelector(".remove")).toBeNull();
  expect(store.lines[0]!.note).toBe("Recorded note");
});

it("A738 sent inspection keeps frozen answers after the offered list disappears", async () => {
  const store = new WorkingOrderStore();
  store.loadFrom("placed", [
    {
      product: { ...dish, offeredModifiers: [] },
      quantity: "2",
      optionSnapshots: [
        {
          listName: { en: "Preparation staff" },
          labelName: { en: "Rare staff" },
          listCustomerName: { en: "Customer list" },
          labelCustomerName: { en: "Customer rare" },
          listKitchenName: "Kitchen list",
          labelKitchenName: "Kitchen rare",
        },
      ],
    },
  ]);
  const { el } = await mountWidget<TillBasket>("till-basket", {
    store,
    lineDetails: true,
    readOnly: true,
  });
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-line-detail]")!);
  await el.updateComplete;
  const picker = pickerOf(el)!;
  await picker.updateComplete;
  expect(picker.shadowRoot!.textContent).toContain("Preparation staff: Rare staff");
  expect(picker.shadowRoot!.textContent).not.toContain("Kitchen rare");
  expect(picker.shadowRoot!.textContent).not.toContain("Customer rare");
});

it("A738 applies quantity and note together to the same unsent line", async () => {
  const { el, store, line } = await opening();
  el.openLineDetails(line);
  await el.updateComplete;
  const picker = pickerOf(el)!;
  await picker.updateComplete;
  const quantity = picker.shadowRoot!.querySelector<WtInput>('[name="quantity"]');
  expect(quantity, "line window needs a quantity field").not.toBeNull();
  expect(
    picker.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(".confirm")!.disabled,
  ).toBe(true);
  quantity!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "3" } }));
  picker
    .shadowRoot!.querySelector<WtTextarea>("wt-textarea")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: " No onion " } }));
  await picker.updateComplete;
  expect(line.quantity).toBe("2");
  expect(line.note).toBe("No salt");
  const observations: { quantity: string; note?: string }[] = [];
  store.on("changed", () => observations.push({ quantity: line.quantity, note: line.note }));
  await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
  await el.updateComplete;
  expect(store.lines[1]).toBe(line);
  expect(observations).toEqual([{ quantity: "3", note: "No onion" }]);
  expect(pickerOf(el)).toBeNull();
});

it("A738 an invoice-limit refusal leaves quantity and note together unchanged", async () => {
  const { el, store, line } = await opening();
  store.simplifiedInvoiceLimit = "15";
  el.openLineDetails(line);
  await el.updateComplete;
  const picker = pickerOf(el)!;
  await picker.updateComplete;
  const quantity = picker.shadowRoot!.querySelector<WtInput>('[name="quantity"]');
  expect(quantity).not.toBeNull();
  quantity!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "4" } }));
  picker
    .shadowRoot!.querySelector<WtTextarea>("wt-textarea")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Changed" } }));
  await picker.updateComplete;
  await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
  expect(line.quantity).toBe("2");
  expect(line.note).toBe("No salt");
  expect(pickerOf(el)).toBe(picker);
  await picker.updateComplete;
  expect(
    picker.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(".confirm")!.disabled,
  ).toBe(false);
  store.allowFullInvoiceFor(store.id);
  await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
  expect(line.quantity).toBe("4");
  expect(line.note).toBe("Changed");
});

it("a line note's label draws the Bold weight", async () => {
  const store = new WorkingOrderStore();
  store.addProduct(dish, "1", { note: "No salt" });
  const { el } = await mountWidget<TillBasket>("till-basket", { store });
  el.parentElement!.style.setProperty("--wt-font-weight-bold", "800");
  const label = el.shadowRoot!.querySelector<HTMLElement>(".line-extras-label")!;
  expect(label.textContent).toContain(":");
  expect(getComputedStyle(label).fontWeight).toBe("800");
});

it.each([
  { nutrition: { allergens: { milk: {} }, dietaryDeclarations: ["halal"] }, want: "Milk" },
  { nutrition: undefined, want: "The declaration was not recorded when this dish was sent." },
])(
  "uses the sent declaration in a read-only counter dish window ($want)",
  async ({ nutrition, want }) => {
    const locale = currentLocale();
    onTestFinished(() => setLocale(locale));
    setLocale("en");
    const store = new WorkingOrderStore();
    store.loadFrom(
      "wo-9",
      [
        {
          product: dish,
          quantity: "2",
          workingOrderLineId: "l-1",
          extras: [
            { listId: "sides", productId: "side", name: "Side", quantity: 1, price: "1.00" },
          ],
        },
      ],
      undefined,
      4,
    );
    const { el } = await mountWidget<TillBasket>("till-basket", {
      store,
      lineDetails: true,
      readOnly: true,
      storedLines: {
        orderId: "wo-9",
        revision: 4,
        lines: [
          {
            ...listedDish,
            id: "l-1",
            productId: dish.id,
            quantity: "2.000",
            unitPriceGross: "5.00",
            sentAt: "2026-11-12T08:00:00Z",
            nutrition,
          },
          {
            ...listedDish,
            id: "l-extra",
            lineNo: 2,
            productId: "side",
            parentLineNo: 1,
            listId: "sides",
            sentAt: "2026-11-12T08:00:00Z",
            nutrition: { allergens: { eggs: {} }, dietaryDeclarations: ["kosher"] },
          },
        ],
      },
    });
    store.refreshDeclarations([
      { ...dish, allergens: { sesame: {} }, dietaryDeclarations: ["halal"] },
    ]);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".extra-allergens")?.textContent?.trim()).toBe("Eggs");
    el.nutritionLines = el.storedLines;
    el.storedLines = null;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".extra-allergens")?.textContent?.trim()).toBe("Eggs");
    el.openLineDetails(store.lines[0]!);
    await el.updateComplete;
    const picker = pickerOf(el)!;
    await picker.updateComplete;
    expect(picker.shadowRoot!.textContent).toContain(want);
    expect(picker.shadowRoot!.textContent).not.toContain("Walnuts");
    expect(picker.shadowRoot!.textContent).not.toContain("Vegan");
    if (nutrition !== undefined) {
      expect(picker.shadowRoot!.textContent).toContain("Recorded when sent");
      expect(el.shadowRoot!.querySelector('wt-icon[name="allergen-milk"]')).not.toBeNull();
    }
  },
);

it("refreshes an open variant line's declaration while retaining staged edits", async () => {
  const { el, line, store } = await opening();
  line.product = { ...line.product, variantId: "small" };
  el.openLineDetails(line);
  await el.updateComplete;
  const picker = pickerOf(el)!;
  await picker.updateComplete;
  picker
    .shadowRoot!.querySelector<WtTextarea>("wt-textarea")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Staged note" } }));
  const dirty = store.dirty;
  const savedProduct = line.product;
  line.product = { ...savedProduct, allergens: { sesame: {} }, dietaryDeclarations: ["halal"] };
  store.emit("changed");
  await el.updateComplete;
  await picker.updateComplete;
  expect(picker.product.allergens).toEqual({ sesame: {} });
  expect(pickerOf(el)).toBe(picker);
  expect(picker.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!.value).toBe("Staged note");
  expect(line.note).toBe("No salt");
  expect(store.dirty).toBe(dirty);
});

const sizes: NonNullable<TillProduct["variants"]> = [
  {
    ...sellingValuesOf(dish),
    id: "v-cup",
    name: "Cup",
    unitPrice: "5.00",
    unitPriceDifference: null,
    available: true,
  },
  {
    ...sellingValuesOf(dish),
    id: "v-bowl",
    name: "Bowl",
    unitPrice: "8.00",
    unitPriceDifference: "3.00",
    available: true,
  },
];
const cupOfSoup = productAsVariant({ ...dish, menuItemId: "mi-soup", variants: sizes }, sizes[0]!);
const sizeRadio = (picker: TillModifierPicker, id: string) =>
  picker.shadowRoot!.querySelector<HTMLInputElement>(`[name="product-variant"][value="${id}"]`)!;

it("reopens an unsent line on its variant and saves a changed one into the line", async () => {
  const locale = currentLocale();
  onTestFinished(() => setLocale(locale));
  setLocale("en");
  const store = new WorkingOrderStore();
  store.addProduct(cupOfSoup, "1");
  const { el } = await mountWidget<TillBasket>("till-basket", { store, lineDetails: true });
  el.openLineDetails(store.lines[0]!);
  await el.updateComplete;
  const picker = pickerOf(el)!;
  await picker.updateComplete;
  expect(sizeRadio(picker, "v-cup").checked).toBe(true);
  await userEvent.click(sizeRadio(picker, "v-bowl"));
  await picker.updateComplete;
  await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
  await el.updateComplete;
  expect(pickerOf(el)).toBeNull();
  expect(store.lines[0]!.product.variantId).toBe("v-bowl");
  const shown = el.shadowRoot!.textContent!;
  expect(shown).toContain("Bowl");
  expect(shown).not.toContain("Cup");
  expect(shown).toContain(formatMoney("8.00", currentLocale()));
});

it("opens a sent line's window read-only, offering no other variant, and refuses a save of one", async () => {
  const store = new WorkingOrderStore();
  store.loadFrom(
    "wo-9",
    [{ product: cupOfSoup, quantity: "1", workingOrderLineId: "l-1" }],
    undefined,
    4,
  );
  const { el } = await mountWidget<TillBasket>("till-basket", {
    store,
    lineDetails: true,
    storedLines: {
      orderId: "wo-9",
      revision: 4,
      lines: [
        {
          ...listedDish,
          id: "l-1",
          productId: "v-cup",
          quantity: "1.000",
          unitPriceGross: "5.00",
          sentAt: "2026-11-12T08:00:00Z",
        },
      ],
    },
  });
  el.openLineDetails(store.lines[0]!);
  await el.updateComplete;
  const picker = pickerOf(el)!;
  await picker.updateComplete;
  expect(picker.readOnly).toBe(true);
  expect(picker.shadowRoot!.querySelectorAll('[name="product-variant"]')).toHaveLength(0);
  expect(picker.shadowRoot!.querySelector(".confirm")).toBeNull();
  const save = new CustomEvent<ModifierConfirmDetail>("wt-modifier-confirm", {
    detail: {
      product: productAsVariant(cupOfSoup, sizes[1]!),
      quantity: "1",
      note: "",
      extras: [],
      options: [],
    },
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  picker.dispatchEvent(save);
  await el.updateComplete;
  expect(save.defaultPrevented).toBe(true);
  expect(store.lines[0]!.product).toBe(cupOfSoup);
  expect(store.dirty).toBe(false);
});
