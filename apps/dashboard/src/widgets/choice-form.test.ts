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
/**
 * Drives the shared allergen/dietary picker the way the picker itself reports a change: the choice
 * form only ever sees the widget's `wt-change`, never the inner comboboxes. `dietary` is a plain
 * string list here so a test can pass an arbitrary label without importing the union.
 */
async function drivePicker(
  el: ChoiceForm,
  value: { addAllergens: string[]; removeAllergens: string[]; dietary: string[] },
) {
  el.shadowRoot!.querySelector("dashboard-allergen-dietary-picker")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
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
      suitableFor: ["halal"],
    },
  });
  const save = vi.fn();
  el.addEventListener("wt-choice-save", save);
  // The shared picker seeds from the stored effects — milk added, suitable-for halal, nothing removed.
  expect(el.shadowRoot!.querySelector("dashboard-allergen-dietary-picker")!.value).toEqual({
    addAllergens: ["milk"],
    removeAllergens: [],
    dietary: ["halal"],
  });
  // Editing through the picker records each added allergen as `contains`. The presence granularity
  // and the per-entry `source` the old per-code select carried are gone by design (a choice authors
  // only which allergens it adds); the follow-up allergen spec drops the presence wrapper too.
  await drivePicker(el, {
    addAllergens: ["milk", "eggs"],
    removeAllergens: [],
    dietary: ["halal", "vegan"],
  });
  await click(el, "choice-save");
  const value = (save.mock.calls[0]![0] as CustomEvent<{ value: ChoiceDraft }>).detail.value;
  expect(value.addAllergens).toEqual({
    milk: { presence: "contains" },
    eggs: { presence: "contains" },
  });
  expect(value.suitableFor).toEqual(["halal", "vegan"]);
});

it("writes an added allergen as contains and a non-null dietary effect", async () => {
  const el = await mountChoice({ kind: "extras" });
  const save = vi.fn();
  el.addEventListener("wt-choice-save", save);
  await change(el, "name-es", "Queso");
  await drivePicker(el, { addAllergens: ["gluten"], removeAllergens: [], dietary: ["vegan"] });
  await click(el, "choice-save");
  const value = (save.mock.calls[0]![0] as CustomEvent<{ value: ChoiceDraft }>).detail.value;
  expect(value.addAllergens).toEqual({ gluten: { presence: "contains" } });
  expect(value.suitableFor).toEqual(["vegan"]);
});

it("renders no presence select and no reviewed switch", async () => {
  const el = await mountChoice({ kind: "extras" });
  expect(el.shadowRoot!.querySelector('[name^="presence-"]')).toBeNull();
  // The reviewed switch used to render as a wt-switch named "dietary-reviewed"; assert its absence
  // structurally so this fails if the control ever comes back, not on a removed string key.
  expect(el.shadowRoot!.querySelector('wt-switch[name="dietary-reviewed"]')).toBeNull();
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
  // No price fields on an options choice. The client always sends an explicit (here empty) dietary
  // effect rather than omitting it, so the record can never be read as "not yet reviewed".
  expect(value).toEqual({
    id: value.id,
    name: { es: "Uno" },
    available: false,
    suitableFor: [],
  });
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
  await drivePicker(el, { addAllergens: ["eggs"], removeAllergens: [], dietary: ["vegan"] });
  await click(el, "choice-save");
  const value = (save.mock.calls[0]![0] as CustomEvent<{ value: ChoiceDraft }>).detail.value;
  expect(value).toMatchObject({
    id: "o",
    name: { es: "Uno" },
    available: true,
    addAllergens: { eggs: { presence: "contains" } },
    suitableFor: ["vegan"],
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
