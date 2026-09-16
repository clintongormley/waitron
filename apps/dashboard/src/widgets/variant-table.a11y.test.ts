import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import type { VariantTable } from "./variant-table.js";
import "./variant-table.js";
import type { ProductEditorVariant } from "../api/client.js";

afterEach(cleanupWidgets);

/** Staff name and customer name differ on every row, as they do in the app. */
const variants: ProductEditorVariant[] = [
  {
    id: "1f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f",
    name: "Media",
    customerName: { es: "Media ración" },
    kitchenName: "1/2",
    image: null,
    unitPrice: "6.50",
    available: true,
  },
  {
    name: "Entera",
    customerName: { es: "Ración entera" },
    kitchenName: "ENT",
    image: null,
    unitPrice: "12.00",
    available: false,
  },
];

async function mount(busy: boolean, theme: "light" | "dark") {
  return mountWidget<VariantTable>(
    "dashboard-variant-table",
    { variants, unitLabel: "kg", busy },
    theme,
  );
}

describe.each(["light", "dark"] as const)("variant table (%s)", (theme) => {
  it("is accessible listing its variants", async () => {
    const { host } = await mount(false, theme);
    await expectNoA11yViolations(host);
  });

  it("is accessible while the product is saving", async () => {
    const { host } = await mount(true, theme);
    await expectNoA11yViolations(host);
  });

  it("is accessible with its row menu open", async () => {
    const { el, host } = await mount(false, theme);
    el.shadowRoot!.querySelector("wt-row-actions")!.show();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
