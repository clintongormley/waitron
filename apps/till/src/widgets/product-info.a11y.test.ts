import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { TillProduct } from "../api/client.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget, type Theme } from "./test-helpers.js";
import { TillProductInfo } from "./product-info.js";

const originalLocale = currentLocale();
afterEach(async () => {
  cleanupWidgets();
  setLocale(originalLocale);
  await page.viewport(414, 896);
});

const base: TillProduct = {
  id: "soup",
  name: "Staff soup",
  customerName: { en: "Customer soup" },
  kitchenName: "Kitchen soup",
  unitPrice: "4.00",
  vatClass: "general",
  category: null,
  allergens: null,
};

describe.each(["light", "dark"] as Theme[])("product information in %s", (theme) => {
  it.each([
    { state: "unreviewed", allergens: null, dietaryDeclarations: [] },
    { state: "reviewed empty", allergens: {}, dietaryDeclarations: [] },
    {
      state: "declared kinds",
      allergens: {
        gluten: { kinds: ["wheat", "barley"] },
        nuts: { kinds: ["hazelnuts"] },
        milk: {},
      },
      dietaryDeclarations: ["vegan"],
    },
    {
      state: "diet only",
      allergens: {},
      dietaryDeclarations: ["no_meat", "no_fish", "halal", "kosher"],
    },
  ] as { state: string; allergens: TillProduct["allergens"]; dietaryDeclarations: string[] }[])(
    "$state has an accessible dialog and distinct review wording",
    async (state) => {
      const { el, host } = await mountWidget<TillProductInfo>(
        "till-product-info",
        { product: { ...base, ...state } },
        theme,
      );
      const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
      await vi.waitFor(() => expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true));
      expect(el.shadowRoot!.textContent!.includes(t("product_info.not_reviewed"))).toBe(
        state.allergens === null,
      );
      expect(el.shadowRoot!.textContent!.includes(t("allergens.as_served_none"))).toBe(
        state.allergens !== null && Object.keys(state.allergens).length === 0,
      );
      await expectNoA11yViolations(host);
    },
  );

  it.each(["en-GB", "es-ES"])(
    "keeps the long nutrition labels and both footer actions inside a phone in %s",
    async (locale) => {
      await page.viewport(390, 844);
      setLocale(locale);
      const product: TillProduct = {
        ...base,
        allergens: {
          gluten: { kinds: ["wheat", "barley", "kamut"] },
          nuts: { kinds: ["brazil_nuts", "macadamia"] },
          sulphites: {},
        },
        dietaryDeclarations: ["vegan", "halal", "kosher"],
      };
      const { el } = await mountWidget<TillProductInfo>("till-product-info", { product }, theme);
      const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
      await vi.waitFor(() => expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true));
      expect(window.innerWidth).toBe(390);
      for (const selector of ["[data-add]", "[data-close]"]) {
        const control = el.shadowRoot!.querySelector(selector)!;
        const bounds = control.getBoundingClientRect();
        expect(bounds.width).toBeGreaterThan(0);
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(390);
      }
      const closed: string[] = [];
      el.addEventListener("close-info", () => closed.push("close"));
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-close]")!);
      expect(closed).toEqual(["close"]);
    },
  );
});
