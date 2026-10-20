import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtInput, WtButton } from "@waitron/ui";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TillProduct } from "../api/client.js";
import type { TillModifierPicker, ModifierConfirmDetail } from "./modifier-picker.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./modifier-picker.js";

const product: TillProduct = {
  id: "dish",
  name: "Staff soup",
  unitPrice: "5.00",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: null,
};
afterEach(cleanupWidgets);

it("A738 a retained Save cannot confirm after the picker becomes read-only", async () => {
  const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
    product,
    quantity: "2",
    lineDetails: true,
    initialSelections: {},
  });
  const sent: ModifierConfirmDetail[] = [];
  el.addEventListener("wt-modifier-confirm", (e) =>
    sent.push((e as CustomEvent<ModifierConfirmDetail>).detail),
  );
  el.shadowRoot!.querySelector('[name="quantity"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "3" } }),
  );
  await el.updateComplete;
  const save = el.shadowRoot!.querySelector<WtButton>(".confirm")!;
  expect(save.disabled).toBe(false);
  el.readOnly = true;
  await el.updateComplete;
  save.click();
  expect(sent).toEqual([]);
});

it("A738 reconnecting keeps a quantity draft and its unsaved baseline", async () => {
  const { el, host } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
    product,
    quantity: "2",
    lineDetails: true,
    initialSelections: {},
  });
  el.shadowRoot!.querySelector('[name="quantity"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "3" } }),
  );
  await el.updateComplete;
  el.remove();
  host.appendChild(el);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<WtInput>('[name="quantity"]')!.value).toBe("3");
  expect(el.shadowRoot!.querySelector<WtButton>(".confirm")!.disabled).toBe(false);
  const sent: ModifierConfirmDetail[] = [];
  el.addEventListener("wt-modifier-confirm", (e) =>
    sent.push((e as CustomEvent<ModifierConfirmDetail>).detail),
  );
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
  expect(sent[0]?.quantity).toBe("3");
});

it.each(["0", "-1", "2.5", "abc", "1.2.3", ""])(
  "A738 invalid whole-unit quantity %s never confirms and explains the field",
  async (value) => {
    const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
      product,
      quantity: "2",
      lineDetails: true,
      initialSelections: {},
    });
    const field = el.shadowRoot!.querySelector<WtInput>('[name="quantity"]');
    expect(field).not.toBeNull();
    const sent: ModifierConfirmDetail[] = [];
    el.addEventListener("wt-modifier-confirm", (e) =>
      sent.push((e as CustomEvent<ModifierConfirmDetail>).detail),
    );
    field!.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<WtButton>(".confirm")!.click();
    await el.updateComplete;
    expect(sent).toEqual([]);
    expect(field!.error).not.toBe("");
    expect(el.shadowRoot!.querySelector<WtButton>(".confirm")!.disabled).toBe(true);
  },
);

it("A738 a decimal quantity changes Save and running price without rounding", async () => {
  const prior = currentLocale();
  setLocale("es-ES");
  try {
    const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
      product: {
        ...product,
        unit: {
          id: "kg",
          name: { en: "Kilograms" },
          abbreviation: { en: "kg" },
          precision: 3,
          hardwareUnit: null,
        },
      },
      quantity: "1.250",
      lineDetails: true,
      initialSelections: {},
    });
    const field = el.shadowRoot!.querySelector<WtInput>('[name="quantity"]');
    expect(field).not.toBeNull();
    await userEvent.fill(field!.shadowRoot!.querySelector("input")!, "2,375");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<WtButton>(".confirm")!.disabled).toBe(false);
    const sent: ModifierConfirmDetail[] = [];
    el.addEventListener("wt-modifier-confirm", (e) =>
      sent.push((e as CustomEvent<ModifierConfirmDetail>).detail),
    );
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
    expect(sent[0]?.quantity).toBe("2.375");
    expect(el.shadowRoot!.querySelector(".running-amount")!.textContent).toContain("11,88");
  } finally {
    setLocale(prior);
  }
});
