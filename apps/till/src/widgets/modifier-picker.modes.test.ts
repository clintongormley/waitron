import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TillProduct } from "../api/client.js";
import { TillModifierPicker } from "./modifier-picker.js";
import { TillProductGrid } from "./product-grid.js";
import { formatMoney } from "../i18n/format.js";

const product = {
  id: "dish",
  descriptions: { es: "Plato" },
  pricingUnit: "each",
  unitPrice: "8.00",
  vatClass: "reduced",
  category: null,
  allergens: null,
  modifiers: [
    { id: "note", name: { es: "Dedicatoria" }, available: true, type: "text" },
    {
      id: "extra",
      name: { es: "Extras" },
      available: true,
      type: "extras",
      required: true,
      maxTotalQuantity: null,
      choices: [
        {
          id: "cheese",
          name: { es: "Queso" },
          priceDelta: "1.00",
          available: true,
          maxQuantity: 3,
          defaultQuantity: 2,
        },
      ],
    },
    {
      id: "side",
      name: { es: "Guarnición" },
      available: true,
      type: "options",
      defaultChoiceId: "salad",
      choices: [{ id: "salad", name: { es: "Ensalada" }, available: true }],
    },
    {
      id: "cut",
      name: { es: "Cortar" },
      available: true,
      type: "yes-no",
      yesLabel: { es: "Sí" },
      noLabel: { es: "No" },
      defaultValue: false,
    },
  ],
} satisfies TillProduct;

afterEach(cleanupWidgets);

it("seeds all four modes once and sends explicit false, literal text and selected quantities", async () => {
  const store = new WorkingOrderStore();
  const { el: grid } = await mountWidget<TillProductGrid>("till-product-grid", {
    products: [product],
    store,
  });
  grid.shadowRoot!.querySelector<HTMLElement>(".tile")!.click();
  await grid.updateComplete;
  const picker = grid.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker");
  expect(picker).not.toBeNull();
  await picker!.updateComplete;
  const input = picker!.shadowRoot!.querySelector<HTMLTextAreaElement>(
    'textarea[name="modifier-note"]',
  )!;
  input.value = " <b>Happy day</b> ";
  input.dispatchEvent(new Event("input"));
  picker!.shadowRoot!.querySelector<HTMLElement>('[data-test="opt-cheese-dec"]')!.click();
  await picker!.updateComplete;
  picker!.product = structuredClone(product);
  await picker!.updateComplete;
  picker!.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
  expect(store.lines[0]?.modifierSelections).toEqual([
    { modifierId: "note", type: "text", text: " <b>Happy day</b> " },
    { modifierId: "extra", type: "extras", choices: [{ choiceId: "cheese", quantity: 1 }] },
    { modifierId: "side", type: "options", choiceId: "salad" },
    { modifierId: "cut", type: "yes-no", value: false },
  ]);
  expect(formatMoney(store.total)).toBe(formatMoney("9.00"));
  expect(store.lines[0]?.modifierSnapshots?.find((entry) => entry.type === "text")).toMatchObject({
    text: " <b>Happy day</b> ",
  });
});

it("keeps an available required modifier with no usable choices visible and blocks Add with a reason", async () => {
  const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
    product: {
      ...product,
      modifiers: [
        {
          id: "side",
          type: "options",
          name: { es: "Guarnición" },
          available: true,
          defaultChoiceId: null,
          choices: [],
        },
      ],
    },
  });
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(".confirm")!.disabled,
  ).toBe(true);
  expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain("Guarnición");
});

it("omits an unavailable whole modifier and does not substitute a stale choice with its new default", async () => {
  const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", { product });
  el.product = {
    ...product,
    modifiers: product.modifiers.map((modifier) =>
      modifier.type === "options"
        ? {
            ...modifier,
            defaultChoiceId: "other",
            choices: [{ id: "other", name: { es: "Otra" }, available: true }],
          }
        : modifier,
    ),
  };
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(".confirm")!.disabled,
  ).toBe(true);
});

it("optional unavailable modifiers do not open the picker", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
    products: [
      {
        ...product,
        modifiers: product.modifiers.map((modifier) => ({ ...modifier, available: false })),
      },
    ],
    store,
  });
  el.shadowRoot!.querySelector<HTMLElement>(".tile")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
  expect(store.lineCount).toBe(1);
});

it("reopens an explicit draft without reapplying defaults to an empty extras selection", async () => {
  const optional = {
    ...product,
    modifiers: product.modifiers.map((modifier) =>
      modifier.type === "extras" ? { ...modifier, required: false } : modifier,
    ),
  };
  const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
    product: optional,
    initialSelections: [
      { modifierId: "extra", type: "extras", choices: [] },
      { modifierId: "side", type: "options", choiceId: "salad" },
      { modifierId: "cut", type: "yes-no", value: false },
    ],
  });
  expect(el.shadowRoot!.querySelector('[data-test="opt-cheese-count"]')!.textContent).toBe("0");
});

describe.each(["light", "dark"] as const)("modifier modes accessibility (%s)", (theme) => {
  it("exposes labels and keyboard controls for all four modes", async () => {
    const { host } = await mountWidget<TillModifierPicker>(
      "till-modifier-picker",
      { product },
      theme,
    );
    await expectNoA11yViolations(host);
  });
  it("announces an unsellable required modifier", async () => {
    const { host } = await mountWidget<TillModifierPicker>(
      "till-modifier-picker",
      {
        product: {
          ...product,
          modifiers: [
            {
              type: "options",
              id: "side",
              name: { es: "Guarnición" },
              available: true,
              choices: [],
              defaultChoiceId: null,
            },
          ],
        },
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});

it("enforces the sum cap on extras, while an unlimited cap still respects each choice maximum", async () => {
  const capped: TillProduct = {
    ...product,
    modifiers: product.modifiers.map((modifier) =>
      modifier.type === "extras" ? { ...modifier, maxTotalQuantity: 2 } : modifier,
    ),
  };
  const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", { product: capped });
  const increment = () =>
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      '[data-test="opt-cheese-inc"]',
    )!;
  expect(increment().disabled).toBe(true);
  el.product = product;
  await el.updateComplete;
  expect(increment().disabled).toBe(false);
  increment().click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-test="opt-cheese-count"]')!.textContent).toBe("3");
  expect(increment().disabled).toBe(true);
});

it("does not silently discard a selected extra when the published choice disappears", async () => {
  const optional: TillProduct = {
    ...product,
    modifiers: product.modifiers.map((modifier) =>
      modifier.type === "extras" ? { ...modifier, required: false } : modifier,
    ),
  };
  const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
    product: optional,
  });
  el.product = {
    ...optional,
    modifiers: optional.modifiers!.map((modifier) =>
      modifier.type === "extras" ? { ...modifier, choices: [] } : modifier,
    ),
  };
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(".confirm")!.disabled,
  ).toBe(true);
  expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
});
