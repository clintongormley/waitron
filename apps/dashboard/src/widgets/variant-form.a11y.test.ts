import { afterEach, describe, it, vi } from "vitest";
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

describe.each(["light", "dark"] as const)("variant form (%s)", (theme) => {
  it("is accessible while empty", async () => {
    const { host } = await mount(null, theme);
    await expectNoA11yViolations(host);
  });

  it("is accessible filled in", async () => {
    const { host } = await mount(halfPortion, theme);
    await expectNoA11yViolations(host);
  });

  it("is accessible showing its errors", async () => {
    const { el, host } = await mount(null, theme);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="variant-save"]')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
