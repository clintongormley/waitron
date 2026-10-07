import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import type { VariantForm } from "./variant-form.js";
import "./variant-form.js";
import type { ImageUploader } from "./image-upload.js";
import type { ProductEditorVariant } from "../api/client.js";

afterEach(cleanupWidgets);

/** Staff name, customer name and kitchen name are three different strings, as they are in the app. */
const halfPortion: ProductEditorVariant = {
  id: "8f1f2f3f-4f5f-4f6f-8f7f-9f8f7f6f5f4f",
  name: "Media",
  customerName: { es: "Media ración", en: "Half portion" },
  kitchenName: "1/2 RAC",
  image: "half.png",
  unitPrice: "6.50",
  available: true,
  active: true,
};

function stubApi(): ImageUploader {
  return { imageLibraryRequest: vi.fn().mockResolvedValue({}) };
}

async function mount(value: ProductEditorVariant | null, theme: "light" | "dark") {
  const mounted = await mountWidget<VariantForm>(
    "dashboard-variant-form",
    {
      open: true,
      locales: ["es", "en"],
      value,
      unitLabel: "kg",
      basePrice: "9.00",
      api: stubApi(),
    },
    theme,
  );
  await mounted.el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return mounted;
}

/** Drives a field the way the primitive inside it reports a change. */
async function change(el: VariantForm, name: string, value: string) {
  el.shadowRoot!.querySelector(`[name="${name}"]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}

async function saveOf(el: VariantForm): Promise<[string, boolean]> {
  const save = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="variant-save"]',
  )!;
  await save.updateComplete;
  return [save.variant, save.disabled];
}

describe.each(["light", "dark"] as const)("variant form (%s)", (theme) => {
  it("is accessible while empty", async () => {
    const { el, host } = await mount(null, theme);
    expect(await saveOf(el)).toEqual(["secondary", true]);
    await expectNoA11yViolations(host);
  });

  it("is accessible filled in", async () => {
    const { el, host } = await mount(halfPortion, theme);
    expect(await saveOf(el)).toEqual(["secondary", true]);
    await expectNoA11yViolations(host);
  });

  it("is accessible changed, with Save ready", async () => {
    const { el, host } = await mount(halfPortion, theme);
    await change(el, "name", "Entera");
    expect(await saveOf(el)).toEqual(["primary", false]);
    await expectNoA11yViolations(host);
  });

  it("is accessible showing its errors", async () => {
    const { el, host } = await mount(null, theme);
    await change(el, "unitPrice", "3.00");
    expect(await saveOf(el)).toEqual(["primary", false]);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="variant-save"]')!.click();
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('wt-input[name="name"]')!
        .error,
    ).not.toBe("");
    await expectNoA11yViolations(host);
  });
});
