import { afterEach, expect, it, vi } from "vitest";
import type { WtCombobox } from "@waitron/ui";
import { ProductEditor } from "./product-editor.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);

it.each(["general", "reduced", "super_reduced", "zero"] as const)(
  "starts a new product on %s and submits that class",
  async (defaultVatClass) => {
    const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      locales: ["es"],
      defaultVatClass,
    });
    const field = () => el.shadowRoot!.querySelector<WtCombobox>('[name="tax"]')!;
    expect(field().value).toBe(defaultVatClass);
    const submitted = vi.fn();
    el.addEventListener("wt-submit", submitted);
    const name = el.shadowRoot!.querySelector('[name="name"]')!;
    name.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Lemonade" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    expect(submitted.mock.calls[0]?.[0].detail.value.vatClass).toBe(defaultVatClass);
    field().dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "zero" },
        bubbles: true,
        composed: true,
      }),
    );
    el.defaultVatClass = "reduced";
    await el.updateComplete;
    expect(field().value).toBe("zero");
  },
);
