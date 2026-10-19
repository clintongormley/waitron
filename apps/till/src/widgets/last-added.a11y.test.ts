import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { TillLastAdded } from "./last-added.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
const originalLocale = currentLocale();
afterEach(async () => {
  cleanupWidgets();
  setLocale(originalLocale);
  await page.viewport(414, 896);
});
for (const theme of ["light", "dark"] as const)
  describe(`A738 last-added accessibility ${theme}`, () => {
    it.each(["empty", "normal", "readOnly", "disabled", "sending", "locked", "fractional"])(
      "has no violations when %s",
      async (state) => {
        const store = new WorkingOrderStore();
        if (state !== "empty")
          store.addProduct(
            {
              id: "soup",
              name: "Staff soup",
              customerName: { en: "Customer soup" },
              kitchenName: "Kitchen soup",
              unitPrice: "123.45",
              pricingUnit: state === "fractional" ? "weight" : "each",
              vatClass: "general",
              category: null,
              allergens: { milk: {} },
              dietaryDeclarations: ["vegetarian"],
            },
            state === "fractional" ? "0.375" : "2",
            { note: "Serve separately, please." },
          );
        if (state === "sending") store.sending = true;
        if (state === "locked") store.lockEdits();
        const { host, el } = await mountWidget<TillLastAdded>(
          "till-last-added",
          { store, readOnly: state === "readOnly", disabled: state === "disabled" },
          theme,
        );
        host.style.width = "350px";
        await el.updateComplete;
        expect(el.shadowRoot).not.toBeNull();
        await expectNoA11yViolations(host);
      },
    );
  });
