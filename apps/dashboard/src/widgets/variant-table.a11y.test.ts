import { afterEach, describe, expect, it } from "vitest";
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
    active: true,
  },
  {
    name: "Entera",
    customerName: { es: "Ración entera" },
    kitchenName: "ENT",
    image: null,
    unitPrice: "12.00",
    available: false,
    active: true,
  },
];

async function mount(
  busy: boolean,
  theme: "light" | "dark",
  rows: ProductEditorVariant[] = variants,
) {
  return mountWidget<VariantTable>(
    "dashboard-variant-table",
    {
      variants: rows,
      basePrice: "9.00",
      unitLabel: "kg",
      unitId: "kg",
      unitOptions: [
        { value: null, label: "Each" },
        { value: "kg", label: "kg" },
      ],
      addUnitLabel: "Add unit",
      busy,
    },
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

  it("is accessible showing an Inactive variant and a price hint, every status at once", async () => {
    const { el, host } = await mount(false, theme, [
      { ...variants[0]!, active: false },
      { ...variants[1]!, unitPrice: null },
    ]);
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("select[name=variant-status]")!;
    select.value = "all";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await el.updateComplete;
    // Without these the scan could pass on a table that drew neither state.
    expect(el.shadowRoot!.querySelector("[data-test=inactive-0]")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(2);
    await expectNoA11yViolations(host);
  });

  it("is accessible with its row menu open", async () => {
    const { el, host } = await mount(false, theme);
    el.shadowRoot!.querySelector("wt-row-actions")!.show();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
