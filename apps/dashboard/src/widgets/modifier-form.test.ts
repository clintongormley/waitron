import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ModifierForm } from "./modifier-form.js";
import type { Modifier } from "../api/client.js";

afterEach(cleanupWidgets);
const base = { id: "m", name: { es: "Extras", fr: "Suppléments" }, available: true };
const extra: Modifier = {
  ...base,
  type: "extras",
  required: false,
  maxTotalQuantity: null,
  choices: [
    {
      id: "a",
      name: { es: "Queso" },
      available: true,
      priceDelta: "1.00",
      maxQuantity: 2,
      defaultQuantity: 1,
      dietaryEffect: { invalidates: ["halal"] },
    },
    {
      id: "b",
      name: { es: "Bacon" },
      available: true,
      priceDelta: "2.00",
      maxQuantity: 1,
      defaultQuantity: 0,
    },
  ],
};
async function mount(value: Modifier | null = null) {
  return (
    await mountWidget<ModifierForm>("dashboard-modifier-form", {
      open: true,
      locales: ["es", "en"],
      value,
    })
  ).el;
}
async function change(el: ModifierForm, name: string, value: string | boolean) {
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
async function click(el: ModifierForm, id: string) {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${id}"]`)!.click();
  await el.updateComplete;
}
it("shows required name feedback and emits the shared event with translations", async () => {
  const el = await mount();
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await click(el, "save");
  expect(submit).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
  await change(el, "name-es", "Nota");
  await change(el, "name-en", "Note");
  await click(el, "save");
  expect(submit.mock.calls[0]![0].detail).toEqual({
    value: { type: "text", name: { es: "Nota", en: "Note" }, available: true },
  });
  expect(submit.mock.calls[0]![0].composed).toBe(true);
});
it("changes an unused type without leaking fields and retains disabled-language names", async () => {
  const el = await mount(extra);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await change(el, "type", "yes-no");
  await change(el, "yesLabel-es", "Sí");
  await change(el, "noLabel-es", "No");
  await click(el, "save");
  expect(submit.mock.calls[0]![0].detail.value).toEqual({
    type: "yes-no",
    name: base.name,
    available: true,
    yesLabel: { es: "Sí" },
    noLabel: { es: "No" },
    defaultValue: false,
  });
});
it("reorders choices, adds and removes a stable choice, and preserves effects", async () => {
  const el = await mount(extra);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await click(el, "down-a");
  await click(el, "add-choice");
  expect(el.shadowRoot!.querySelectorAll("[data-choice]")).toHaveLength(3);
  const id = el.shadowRoot!.querySelectorAll<HTMLElement>("[data-choice]")[2]!.dataset.choice!;
  await click(el, `remove-${id}`);
  await click(el, "save");
  expect(submit.mock.calls[0]![0].detail.value.choices.map((c: { id: string }) => c.id)).toEqual([
    "b",
    "a",
  ]);
  expect(submit.mock.calls[0]![0].detail.value.choices[1].dietaryEffect).toEqual({
    invalidates: ["halal"],
  });
});
it("rejects negative prices, fractional limits and defaults above the total cap", async () => {
  const el = await mount(extra);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await change(el, "priceDelta-a", "-1");
  await change(el, "maxQuantity-a", "1.5");
  await change(el, "maxTotalQuantity", "0");
  await click(el, "save");
  expect(submit).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelectorAll("wt-input[invalid]").length).toBeGreaterThanOrEqual(3);
  await change(el, "priceDelta-a", "1.00");
  await change(el, "maxQuantity-a", "2");
  await change(el, "maxTotalQuantity", "1");
  await change(el, "defaultQuantity-a", "2");
  await click(el, "save");
  expect(submit).not.toHaveBeenCalled();
});
it("clears unavailable defaults visibly and blocks an available required empty choice set", async () => {
  const el = await mount({ ...extra, required: true, choices: [extra.choices[0]!] });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await change(el, "available-a", false);
  expect(
    (el.shadowRoot!.querySelector('[name="defaultQuantity-a"]') as unknown as { value: string })
      .value,
  ).toBe("0");
  await click(el, "save");
  expect(submit).not.toHaveBeenCalled();
  await change(el, "available", false);
  await click(el, "save");
  expect(submit.mock.calls[0]![0].detail.value.choices[0].defaultQuantity).toBe(0);
});
it("clears an option default when its choice becomes unavailable", async () => {
  const el = await mount({
    ...base,
    type: "options",
    defaultChoiceId: "a",
    choices: [
      { id: "a", name: { es: "Uno" }, available: true },
      { id: "b", name: { es: "Dos" }, available: true },
    ],
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await change(el, "available-a", false);
  await click(el, "save");
  expect(submit.mock.calls[0]![0].detail.value.defaultChoiceId).toBeNull();
});
it("retains a draft across busy/server errors and emits cancel once", async () => {
  const el = await mount();
  const submit = vi.fn(),
    cancel = vi.fn();
  el.addEventListener("wt-submit", submit);
  el.addEventListener("wt-cancel", cancel);
  await change(el, "name-es", "Nota");
  el.busy = true;
  await el.updateComplete;
  await click(el, "save");
  expect(submit).not.toHaveBeenCalled();
  el.busy = false;
  el.fieldErrors = { name: "Rejected" };
  await el.updateComplete;
  expect(
    (el.shadowRoot!.querySelector('[name="name-es"]') as unknown as { value: string }).value,
  ).toBe("Nota");
  await click(el, "cancel");
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel.mock.calls[0]![0].detail).toEqual({});
});
it("authors source-free allergen and direct dietary effects while preserving existing specificity", async () => {
  const el = await mount({
    ...extra,
    choices: [
      { ...extra.choices[0]!, addAllergens: { milk: { presence: "contains", source: "queso" } } },
    ],
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await change(el, "addAllergens-a", "eggs");
  await change(el, "presence-a-eggs", "may_contain");
  await change(el, "dietaryEffect-a", "vegan");
  await click(el, "save");
  expect(submit.mock.calls[0]![0].detail.value.choices[0]).toMatchObject({
    addAllergens: {
      milk: { presence: "contains", source: "queso" },
      eggs: { presence: "may_contain" },
    },
    dietaryEffect: { invalidates: ["halal", "vegan"] },
  });
  expect(el.shadowRoot!.querySelector('input[name*="source"]')).toBeNull();
});
it("associates server choice paths with the submitted choice fields", async () => {
  const el = await mount(extra);
  el.fieldErrors = { "choices.0.priceDelta": "Rejected price" };
  await el.updateComplete;
  expect(
    (el.shadowRoot!.querySelector('[name="priceDelta-a"]') as unknown as { error: string }).error,
  ).toBe("Rejected price");
});
