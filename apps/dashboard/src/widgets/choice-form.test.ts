import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ChoiceForm, type ChoiceDraft } from "./choice-form.js";
import { t } from "../i18n/t.js";

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
function field(el: ChoiceForm, name: string) {
  return el.shadowRoot!.querySelector(`[name="${name}"]`) as unknown as {
    invalid: boolean;
    error: string;
  };
}
async function summaryEntries(el: ChoiceForm) {
  const summary = el.shadowRoot!.querySelector("wt-form-error-summary");
  if (summary === null) return null;
  await summary.updateComplete;
  return {
    heading: summary.heading,
    entries: [...summary.shadowRoot!.querySelectorAll("li")].map((item) => item.textContent),
  };
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
  expect((await summaryEntries(el))?.entries).toEqual([t("modifiers.price_invalid")]); // bad price
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

it("explains every bad field in the shared error summary under the form heading", async () => {
  const el = await mountChoice({ kind: "extras" });
  expect((await summaryEntries(el))?.entries ?? []).toEqual([]);
  await change(el, "priceDelta", "free");
  await change(el, "maxQuantity", "0");
  await click(el, "choice-save");
  expect(await summaryEntries(el)).toEqual({
    heading: t("form.error_heading"),
    entries: [
      t("modifiers.name_required"),
      t("modifiers.price_invalid"),
      t("modifiers.quantity_invalid"),
    ],
  });
  expect(field(el, "name-es").error).toBe(t("modifiers.name_required"));
  expect(field(el, "priceDelta").error).toBe(t("modifiers.price_invalid"));
  expect(field(el, "maxQuantity").error).toBe(t("modifiers.quantity_invalid"));
});

it("rejects a price or quantity beyond what the server stores, on that field", async () => {
  const el = await mountChoice({ kind: "extras" });
  const save = vi.fn();
  el.addEventListener("wt-choice-save", save);
  await change(el, "name-es", "Queso");
  await change(el, "priceDelta", "12345678901");
  await change(el, "maxQuantity", "2147483648");
  await click(el, "choice-save");
  expect(save).not.toHaveBeenCalled();
  expect(field(el, "priceDelta").invalid).toBe(true);
  expect(field(el, "maxQuantity").invalid).toBe(true);
  // The largest values the server accepts still save.
  await change(el, "priceDelta", "1234567890.99");
  await change(el, "maxQuantity", "2147483647");
  await click(el, "choice-save");
  expect(save).toHaveBeenCalledTimes(1);
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
  // A choice declares only presence; an existing source is carried through but never edited here.
  expect(el.shadowRoot!.querySelector('input[name*="source"]')).toBeNull();
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

it("authors allergen and dietary effects on an options choice", async () => {
  const el = await mountChoice({
    kind: "options",
    value: { id: "o", name: { es: "Uno" }, available: true },
  });
  const save = vi.fn();
  el.addEventListener("wt-choice-save", save);
  // Effects are edited for options too, not just extras — the till reads them for diet checks.
  expect(el.shadowRoot!.querySelector("details")).not.toBeNull();
  expect(el.shadowRoot!.querySelector('[name="priceDelta"]')).toBeNull();
  await change(el, "addAllergens", "eggs");
  await change(el, "dietary-reviewed", true);
  await change(el, "dietaryEffect", "vegan");
  await click(el, "choice-save");
  const value = (save.mock.calls[0]![0] as CustomEvent<{ value: ChoiceDraft }>).detail.value;
  expect(value).toMatchObject({
    id: "o",
    name: { es: "Uno" },
    available: true,
    addAllergens: { eggs: { presence: "contains" } },
    dietaryEffect: { invalidates: ["vegan"] },
  });
  expect(value).not.toHaveProperty("priceDelta");
  expect(value).not.toHaveProperty("maxQuantity");
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
