import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtInput, WtTextarea } from "@waitron/ui";
import type { OfferedModifier, TillProduct } from "../api/client.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TillBasket } from "./basket.js";
import type { TillModifierPicker } from "./modifier-picker.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./basket.js";

function extraList(id: string, price: string): OfferedModifier {
  return {
    kind: "extras",
    id,
    name: `Staff ${id}`,
    customerName: null,
    kitchenName: null,
    minPicks: 1,
    maxPicks: 2,
    items: [
      {
        presentation: {
          name: `Staff cheese ${id}`,
          customerName: null,
          kitchenName: null,
          variantName: null,
          variantCustomerName: null,
          variantKitchenName: null,
        },
        productId: "cheese",
        name: `Staff cheese ${id}`,
        customerName: null,
        kitchenName: null,
        price,
        vatClass: "general",
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
        maxQuantity: 2,
        preselected: false,
        addAllergens: { milk: {} },
        suitableFor: ["vegetarian"],
      },
    ],
  };
}
const product: TillProduct = {
  id: "dish",
  name: "Staff soup",
  unitPrice: "5.00",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: null,
  offeredModifiers: [extraList("sides", "0.50"), extraList("garnish", "0.75")],
};
afterEach(cleanupWidgets);

async function opening() {
  const store = new WorkingOrderStore();
  store.addProduct(product, "2", {
    note: "No salt",
    extras: [
      {
        listId: "sides",
        productId: "cheese",
        name: "Staff cheese sides",
        price: "0.50",
        quantity: 1,
      },
      {
        listId: "garnish",
        productId: "cheese",
        name: "Staff cheese garnish",
        price: "0.75",
        quantity: 1,
      },
    ],
  });
  const line = store.lines[0]!;
  const { el } = await mountWidget<TillBasket>("till-basket", { store, lineDetails: true });
  el.openLineDetails(line);
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!;
  await picker.updateComplete;
  return { store, line, el, picker };
}
function summary(store: WorkingOrderStore) {
  const line = store.lines[0]!;
  return {
    quantity: line.quantity,
    note: line.note,
    extras: line.extras?.map(({ listId, productId, quantity, price }) => ({
      listId,
      productId,
      quantity,
      price,
    })),
    total: store.total,
  };
}
async function edit(picker: TillModifierPicker) {
  await userEvent.fill(
    picker
      .shadowRoot!.querySelector<WtInput>('[name="quantity"]')!
      .shadowRoot!.querySelector("input")!,
    "3",
  );
  await userEvent.click(
    picker.shadowRoot!.querySelector<WtButton>('[data-test="pick-sides-cheese-inc"]')!,
  );
  await userEvent.fill(
    picker
      .shadowRoot!.querySelector<WtTextarea>("wt-textarea")!
      .shadowRoot!.querySelector("textarea")!,
    "No onion",
  );
  await picker.updateComplete;
}

it("A738 quantity extras and note save atomically to the same unsent line with separate list identities", async () => {
  const { store, line, el, picker } = await opening();
  const before = summary(store);
  await edit(picker);
  expect(summary(store)).toEqual(before);
  const observations: ReturnType<typeof summary>[] = [];
  store.on("changed", () => observations.push(summary(store)));
  await userEvent.click(picker.shadowRoot!.querySelector<WtButton>(".confirm")!);
  await el.updateComplete;
  expect(store.lines[0]).toBe(line);
  expect(observations).toEqual([
    {
      quantity: "3",
      note: "No onion",
      extras: [
        { listId: "sides", productId: "cheese", quantity: 2, price: "0.50" },
        { listId: "garnish", productId: "cheese", quantity: 1, price: "0.75" },
      ],
      total: "20.25",
    },
  ]);
  expect(el.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
});

it("A738 a required extra and both maxima constrain the combined line draft", async () => {
  const { store, picker } = await opening();
  const before = summary(store);
  await edit(picker);
  const up = picker.shadowRoot!.querySelector<WtButton>('[data-test="pick-sides-cheese-inc"]')!;
  expect(up.disabled).toBe(true);
  up.click();
  await picker.updateComplete;
  expect(
    picker.shadowRoot!.querySelector('[data-test="pick-sides-cheese-count"]')!.textContent?.trim(),
  ).toBe("2");
  const down = picker.shadowRoot!.querySelector<WtButton>('[data-test="pick-garnish-cheese-dec"]')!;
  await userEvent.click(down);
  await picker.updateComplete;
  const save = picker.shadowRoot!.querySelector<WtButton>(".confirm")!;
  expect(save.disabled).toBe(true);
  save.click();
  expect(summary(store)).toEqual(before);
  await userEvent.click(
    picker.shadowRoot!.querySelector<WtButton>('[data-test="pick-garnish-cheese-inc"]')!,
  );
  await picker.updateComplete;
  expect(save.disabled).toBe(false);
});

it.each(["list", "item"])(
  "A738 a removed live %s keeps all combined edits uncommitted",
  async (removed) => {
    const { store, line, picker } = await opening();
    const before = summary(store);
    await edit(picker);
    picker.product = {
      ...product,
      offeredModifiers:
        removed === "list"
          ? [extraList("garnish", "0.75")]
          : [
              { ...extraList("sides", "0.50"), items: [] } as OfferedModifier,
              extraList("garnish", "0.75"),
            ],
    };
    await picker.updateComplete;
    expect(picker.shadowRoot!.querySelector<WtButton>(".confirm")!.disabled).toBe(true);
    picker.shadowRoot!.querySelector<WtButton>(".confirm")!.click();
    expect(store.lines[0]).toBe(line);
    expect(summary(store)).toEqual(before);
    expect(picker.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
  },
);
