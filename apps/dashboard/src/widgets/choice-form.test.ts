import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ChoiceForm, type ChoiceDraft } from "./choice-form.js";

afterEach(cleanupWidgets);

async function mountChoice(props: Partial<ChoiceForm> & { kind: "extras" | "options" }) {
  return (
    await mountWidget<ChoiceForm>("dashboard-choice-form", {
      open: true,
      locales: ["es", "en"],
      value: null,
      ...props,
    })
  ).el;
}
async function change(el: ChoiceForm, name: string, value: string | boolean) {
  const node = el.shadowRoot!.querySelector<HTMLElement>(`[name="${name}"]`)!;
  if (node instanceof HTMLSelectElement) {
    node.value = String(value);
    node.dispatchEvent(new Event("change"));
  } else
    node.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: typeof value === "boolean" ? { checked: value } : { value },
      }),
    );
  await el.updateComplete;
}
async function click(el: ChoiceForm, id: string) {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${id}"]`)!.click();
  await el.updateComplete;
}

it("emits an extras choice with names, price and effects, and validates the price", async () => {
  const el = await mountChoice({ kind: "extras" });
  const save = vi.fn();
  el.addEventListener("wt-choice-save", save);
  await click(el, "choice-save");
  expect(save).not.toHaveBeenCalled(); // name required in default language
  await change(el, "name-es", "Queso");
  await change(el, "priceDelta", "1.5x");
  await click(el, "choice-save");
  expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull(); // bad price
  await change(el, "priceDelta", "1.50");
  await change(el, "maxQuantity", "2");
  await click(el, "choice-save");
  const detail = (save.mock.calls[0]![0] as CustomEvent<{ value: ChoiceDraft }>).detail;
  expect(detail.value).toMatchObject({
    name: { es: "Queso" },
    available: true,
    priceDelta: "1.50",
    maxQuantity: 2,
  });
  expect((save.mock.calls[0]![0] as CustomEvent).composed).toBe(true);
});

it("authors allergen and dietary effects on an extras choice", async () => {
  const el = await mountChoice({
    kind: "extras",
    value: {
      id: "a",
      name: { es: "Queso" },
      available: true,
      priceDelta: "1.00",
      maxQuantity: 2,
      addAllergens: { milk: { presence: "contains", source: "queso" } },
      dietaryEffect: { invalidates: ["halal"] },
    },
  });
  const save = vi.fn();
  el.addEventListener("wt-choice-save", save);
  await change(el, "addAllergens", "eggs");
  await change(el, "presence-eggs", "may_contain");
  await change(el, "dietaryEffect", "vegan");
  await click(el, "choice-save");
  const value = (save.mock.calls[0]![0] as CustomEvent<{ value: ChoiceDraft }>).detail.value;
  expect(value).toMatchObject({
    addAllergens: {
      milk: { presence: "contains", source: "queso" },
      eggs: { presence: "may_contain" },
    },
    dietaryEffect: { invalidates: ["halal", "vegan"] },
  });
});

it("emits an options choice with only its shared fields", async () => {
  const el = await mountChoice({ kind: "options" });
  const save = vi.fn();
  el.addEventListener("wt-choice-save", save);
  expect(el.shadowRoot!.querySelector('[name="priceDelta"]')).toBeNull();
  await change(el, "name-es", "Uno");
  await change(el, "available", false);
  await click(el, "choice-save");
  const value = (save.mock.calls[0]![0] as CustomEvent<{ value: ChoiceDraft }>).detail.value;
  expect(value).toEqual({ id: value.id, name: { es: "Uno" }, available: false });
});

it("guards its close so it does not bubble past itself", async () => {
  const el = await mountChoice({ kind: "options" });
  const outer = vi.fn();
  const cancel = vi.fn();
  el.addEventListener("wt-close", outer); // a wt-modal close must not escape as wt-close
  el.addEventListener("wt-choice-cancel", cancel);
  el.shadowRoot!.querySelector("wt-modal")!.dispatchEvent(
    new CustomEvent("wt-close", { bubbles: true, composed: true }),
  );
  await el.updateComplete;
  // the element re-emits wt-choice-cancel, and does not let a raw wt-close leak to consumers
  expect(outer).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledTimes(1);
});
