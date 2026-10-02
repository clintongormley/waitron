import { afterEach, describe, expect, it } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import type { VariantTable } from "./variant-table.js";
import "./variant-table.js";
import type { ProductEditorVariant } from "../api/client.js";
import { setLocale } from "../i18n/t.js";

afterEach(cleanupWidgets);
afterEach(() => setLocale("es-ES"));

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
  it.each([
    ["en-GB", ["Media", "Entera"]],
    ["es-ES", ["Media", "Entera"]],
  ])("names each available switch for its variant in %s", async (locale, labels) => {
    setLocale(locale as "en-GB" | "es-ES");
    const { el, host } = await mount(false, theme);
    expect(
      [...el.shadowRoot!.querySelectorAll("tbody wt-switch")].map((control) =>
        control.shadowRoot!.querySelector('[role="switch"]')!.getAttribute("aria-label"),
      ),
    ).toEqual(labels);
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
    await chooseOption(el.shadowRoot!.querySelector("wt-combobox[name=variant-status]")!, "all");
    await el.updateComplete;
    // Without these the scan could pass on a table that drew neither state.
    expect(el.shadowRoot!.querySelector("[data-test=inactive-0]")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(2);
    await expectNoA11yViolations(host);
  });

  it("is accessible with a row's Edit focused", async () => {
    const { el, host } = await mount(false, theme);
    const row = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-test="edit-row-0"]')!;
    row.focus();
    expect(el.shadowRoot!.activeElement).toBe(row);
    await expectNoA11yViolations(host);
  });

  it("is accessible with its row menu open", async () => {
    const { el, host } = await mount(false, theme);
    el.shadowRoot!.querySelector("wt-row-actions")!.show();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
