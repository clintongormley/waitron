import { userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { VariantForm } from "./variant-form.js";
import "./variant-form.js";
import type { ImageUploader } from "./image-upload.js";
import type { ProductEditorVariant } from "../api/client.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);

/**
 * A saved variant. Every one of its three names is a DIFFERENT string on purpose: this branch has
 * twice shipped a fixture whose staff name and customer name were the same text, which left no
 * assertion able to tell the two apart — and one of those times hid a real customer-facing defect.
 */
const halfPortion: ProductEditorVariant = {
  id: "8f1f2f3f-4f5f-4f6f-8f7f-9f8f7f6f5f4f",
  name: "Media",
  customerName: { es: "Media ración", en: "Half portion" },
  kitchenName: "1/2 RAC",
  image: "half.png",
  unitPrice: "6.50",
  available: true,
};

function stubApi(): ImageUploader {
  return { imageLibraryRequest: vi.fn().mockResolvedValue({}) };
}

async function mountForm(props: Partial<VariantForm> = {}) {
  return (
    await mountWidget<VariantForm>("dashboard-variant-form", {
      open: true,
      locales: ["es", "en"],
      value: null,
      unitLabel: "kg",
      api: stubApi(),
      ...props,
    })
  ).el;
}

/** Drives a field the way the primitive inside it reports a change. */
async function change(el: VariantForm, name: string, value: string | boolean) {
  const node = el.shadowRoot!.querySelector<HTMLElement>(`[name="${name}"]`)!;
  node.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: typeof value === "boolean" ? { checked: value } : { value },
    }),
  );
  await el.updateComplete;
}

async function click(el: VariantForm, id: string) {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${id}"]`)!.click();
  await el.updateComplete;
}

function field(el: VariantForm, name: string) {
  return el.shadowRoot!.querySelector(`[name="${name}"]`) as unknown as {
    value: string;
    label: string;
    checked: boolean;
    required: boolean;
    invalid: boolean;
    error: string;
  };
}

async function summaryEntries(el: VariantForm) {
  const summary = el.shadowRoot!.querySelector("wt-form-error-summary")!;
  await summary.updateComplete;
  return [...summary.shadowRoot!.querySelectorAll("li")].map((item) => item.textContent);
}

it("opens with every field of the variant it was given", async () => {
  const el = await mountForm({ value: halfPortion });
  expect(field(el, "name").value).toBe("Media");
  expect(field(el, "unitPrice").value).toBe("6.50");
  expect(field(el, "available").checked).toBe(true);
  expect(field(el, "kitchenName").value).toBe("1/2 RAC");
  expect(field(el, "customerName-es").value).toBe("Media ración");
  expect(field(el, "customerName-en").value).toBe("Half portion");
  expect(el.shadowRoot!.querySelector("dashboard-image-upload")!.image).toBe("half.png");
});

it("marks the name and the price as required and leaves the optional names unmarked", async () => {
  const el = await mountForm();
  expect(field(el, "name").required).toBe(true);
  expect(field(el, "unitPrice").required).toBe(true);
  expect(field(el, "kitchenName").required).toBe(false);
  expect(field(el, "customerName-es").required).toBe(false);
});

it("shows the product's unit with the price and offers no way to change it", async () => {
  const el = await mountForm({ unitLabel: "kg" });
  expect(field(el, "unitPrice").label).toBe(t("editor.price_unit").replace("{unit}", "kg"));
  // The unit belongs to the product, so the variant window names it but carries no control for it —
  // no unit dropdown, and not `wt-price-input`, whose unit is a button that opens a picker.
  expect(el.shadowRoot!.querySelector("wt-price-input")).toBeNull();
  expect(el.shadowRoot!.querySelector("select")).toBeNull();
  const buttons = [...el.shadowRoot!.querySelectorAll("button")].map((b) => b.textContent?.trim());
  expect(buttons).not.toContain("kg");
});

it("falls back to the plain price label when the product has no unit yet", async () => {
  const el = await mountForm({ unitLabel: "" });
  expect(field(el, "unitPrice").label).toBe(t("editor.price"));
});

it("refuses a blank name, explains it beside the field and in the summary, and keeps the draft", async () => {
  const el = await mountForm({ value: halfPortion });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await change(el, "name", "   ");
  await change(el, "unitPrice", "7.25");
  await click(el, "variant-save");
  expect(submit).not.toHaveBeenCalled();
  expect(field(el, "name").invalid).toBe(true);
  expect(field(el, "name").error).toBe(t("editor.variant_name_required"));
  expect(await summaryEntries(el)).toEqual([t("editor.variant_name_required")]);
  // The window stays as the person left it, so they correct one field rather than retyping the rest.
  expect(field(el, "unitPrice").value).toBe("7.25");
  await change(el, "name", "Entera");
  await click(el, "variant-save");
  expect(submit).toHaveBeenCalledTimes(1);
});

it("refuses a price that is not a plain amount", async () => {
  const el = await mountForm({ value: halfPortion });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await change(el, "unitPrice", "6,5x");
  await click(el, "variant-save");
  expect(submit).not.toHaveBeenCalled();
  expect(field(el, "unitPrice").error).toBe(t("editor.price_invalid"));
  expect(await summaryEntries(el)).toEqual([t("editor.price_invalid")]);
});

it("emits the edited variant, keeping its id and folding blank optional text to nothing", async () => {
  const el = await mountForm({ value: halfPortion });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await change(el, "name", " Entera ");
  await change(el, "unitPrice", "12.00");
  await change(el, "available", false);
  await change(el, "kitchenName", "  ");
  await change(el, "customerName-es", "Ración entera");
  await change(el, "customerName-en", "   ");
  await click(el, "variant-save");
  const event = submit.mock.calls[0]![0] as CustomEvent<{ value: ProductEditorVariant }>;
  expect(event.detail.value).toEqual({
    id: halfPortion.id,
    name: "Entera",
    customerName: { es: "Ración entera" },
    kitchenName: null,
    image: "half.png",
    unitPrice: "12.00",
    available: false,
  });
  expect(event.bubbles).toBe(true);
  expect(event.composed).toBe(true);
});

it("emits a variant with no id and no optional text when it opened empty", async () => {
  const el = await mountForm();
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await change(el, "name", "Regular");
  await change(el, "unitPrice", "3.00");
  await click(el, "variant-save");
  const value = (submit.mock.calls[0]![0] as CustomEvent<{ value: ProductEditorVariant }>).detail
    .value;
  expect(value).toEqual({
    name: "Regular",
    customerName: null,
    kitchenName: null,
    image: null,
    unitPrice: "3.00",
    available: true,
  });
  expect("id" in value).toBe(false);
});

it("leaves the image out when there is no library to pick one from", async () => {
  const el = await mountForm({ api: undefined });
  expect(el.shadowRoot!.querySelector("dashboard-image-upload")).toBeNull();
  // The rest of the window still works, so a missing library costs the picture and nothing else.
  expect(el.shadowRoot!.querySelector('[name="name"]')).not.toBeNull();
});

it("takes the image the picker reports", async () => {
  const el = await mountForm();
  el.shadowRoot!.querySelector("dashboard-image-upload")!.dispatchEvent(
    new CustomEvent("image-changed", {
      detail: { image: "whole.png" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await change(el, "name", "Entera");
  await change(el, "unitPrice", "9.00");
  await click(el, "variant-save");
  expect(
    (submit.mock.calls[0]![0] as CustomEvent<{ value: ProductEditorVariant }>).detail.value.image,
  ).toBe("whole.png");
});

it("keeps the image picker's open state to itself", async () => {
  const el = await mountForm();
  const seen = vi.fn();
  el.addEventListener("image-picker-state", seen);
  el.shadowRoot!.querySelector("dashboard-image-upload")!.dispatchEvent(
    new CustomEvent("image-picker-state", {
      detail: { open: true },
      bubbles: true,
      composed: true,
    }),
  );
  // The picker belongs to this window, not to the product editor behind it, which suspends itself
  // on its OWN image picker.
  expect(seen).not.toHaveBeenCalled();
});

it("cancels from the button and from the modal's own dismissal", async () => {
  const el = await mountForm({ value: halfPortion });
  const cancel = vi.fn();
  const submit = vi.fn();
  el.addEventListener("wt-cancel", cancel);
  el.addEventListener("wt-submit", submit);
  await click(el, "variant-cancel");
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel.mock.calls[0]![0].detail).toEqual({});
  el.shadowRoot!.querySelector("wt-modal")!.dispatchEvent(new CustomEvent("wt-close"));
  await el.updateComplete;
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(submit).not.toHaveBeenCalled();
});

it("does nothing while the save it already started is in flight", async () => {
  const el = await mountForm({ value: halfPortion, busy: true });
  const submit = vi.fn();
  const cancel = vi.fn();
  el.addEventListener("wt-submit", submit);
  el.addEventListener("wt-cancel", cancel);
  await click(el, "variant-save");
  await click(el, "variant-cancel");
  expect(submit).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  expect(field(el, "name").value).toBe("Media");
});

it("reseeds its fields when it is reopened for a different variant", async () => {
  const el = await mountForm({ value: halfPortion });
  await change(el, "name", "Editada a medias");
  el.open = false;
  await el.updateComplete;
  el.value = null;
  el.open = true;
  await el.updateComplete;
  expect(field(el, "name").value).toBe("");
  expect(field(el, "customerName-es").value).toBe("");
  expect(field(el, "available").checked).toBe(true);
});

it("puts focus in the first field a refused submit reported", async () => {
  const el = await mountForm({ value: null });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await click(el, "variant-save");
  expect(submit).not.toHaveBeenCalled();
  expect(field(el, "name").error).toBe(t("editor.variant_name_required"));
  // Leaving focus on Save gives a keyboard user nothing to act on: the message is beside a field
  // they would have to go looking for.
  await expect.poll(() => el.shadowRoot!.activeElement?.getAttribute("name")).toBe("name");
});

/** Focuses the name field, where a keyboard user lands first. */
async function focusName(el: VariantForm) {
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  const input = el
    .shadowRoot!.querySelector('wt-input[name="name"]')!
    .shadowRoot!.querySelector("input")!;
  input.focus();
  expect((input.getRootNode() as ShadowRoot).activeElement).toBe(input);
}

it("saves on Enter and cancels on Escape from a focused field", async () => {
  const el = await mountForm({ value: halfPortion });
  await focusName(el);
  const submit = vi.fn();
  const cancel = vi.fn();
  el.addEventListener("wt-submit", submit);
  el.addEventListener("wt-cancel", cancel);
  await userEvent.keyboard("{Enter}");
  expect(submit).toHaveBeenCalledTimes(1);
  await userEvent.keyboard("{Escape}");
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("holds Escape while the save it started is in flight", async () => {
  const press = async (busy: boolean) => {
    const el = await mountForm({ value: halfPortion, busy });
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    modal.dispatchEvent(escape);
    return escape.defaultPrevented;
  };
  // Taking the key is what stops the native dialog closing itself out from under a save in flight.
  expect(await press(true)).toBe(true);
  // The control in the other direction: with nothing in flight the key is left alone, so the dialog
  // closes and the window reports a cancel the ordinary way.
  expect(await press(false)).toBe(false);
});
