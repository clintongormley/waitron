import { afterEach, describe, expect, it } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { ProductDetails } from "./product-details.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("archived details accessibility (%s)", (theme) => {
  it("opens a named plain-text panel", async () => {
    const { el, host } = await mountWidget<ProductDetails>(
      "dashboard-product-details",
      {
        ...{
          open: true,
          value: {
            id: "coffee",
            parentId: null,
            inherited: null,
            name: "Staff coffee",
            customerName: { en: "House coffee", es: "Café de la casa" },
            kitchenName: "BAR",
            description: null,
            image: null,
            unitId: null,
            unitPrice: "3.00",
            vatClass: "reduced",
            active: false,
            available: true,
            ordering: "public",
            primaryCategoryId: null,
            color: null,
            variants: [],
            modifiers: [],
            allergens: {},
            dietaryDeclarations: [],
            courseId: null,
          },
        },
      },
      theme,
    );
    const modal = el.shadowRoot?.querySelector("wt-modal");
    expect(modal).toBeTruthy();
    await modal!.updateComplete;
    expect(modal!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await expectNoA11yViolations(host);
  });
});
