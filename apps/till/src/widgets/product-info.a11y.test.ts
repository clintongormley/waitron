import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { TillProduct } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
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

it.each(["light", "dark"] as Theme[])(
  "can restore an option and explains the last-choice refusal in %s",
  async (theme) => {
    setLocale(theme === "dark" ? "es-ES" : "en-GB");
    let reject!: (error: unknown) => void;
    const change = vi.fn(
      () =>
        new Promise<void>((_yes, no) => {
          reject = no;
        }),
    );
    const product: TillProduct = {
      ...base,
      productId: "soup",
      modifierAvailability: [
        {
          kind: "options",
          id: "cooked",
          name: "Cooking",
          customerName: null,
          kitchenName: null,
          defaultLabelId: "rare",
          publishedDefaultLabelId: "rare",
          labels: [
            { id: "rare", name: "Rare", customerName: null, kitchenName: null, available: true },
            {
              id: "medium",
              name: "Medium",
              customerName: null,
              kitchenName: null,
              available: false,
            },
          ],
        },
      ],
    };
    const { el, host } = await mountWidget<TillProductInfo>(
      "till-product-info",
      { product, changeAvailability: vi.fn(), changeOptionAvailability: change },
      theme,
    );
    const restore = el.shadowRoot!.querySelector<HTMLElement>('[data-availability="medium"]')!;
    expect(restore).not.toBeNull();
    expect(restore.textContent).toBe(t("product_info.restore"));
    await expectNoA11yViolations(host);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-availability="rare"]')!);
    expect(change).toHaveBeenCalledExactlyOnceWith("cooked", "rare", false);
    reject({ code: "options.invalid", field: "labels" });
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull());
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe(
      theme === "dark"
        ? "Vuelve a poner otra opción a la venta antes de marcar esta como agotada."
        : "Put another choice back on sale before marking this one sold out.",
    );
    await expectNoA11yViolations(host);
    const closed: string[] = [];
    el.addEventListener("close-info", () => closed.push("close"));
    change.mockResolvedValueOnce(undefined);
    await userEvent.click(restore);
    expect(change).toHaveBeenLastCalledWith("cooked", "medium", true);
    await vi.waitFor(() => expect(closed).toEqual(["close"]));
  },
);

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

it.each([
  [
    "light",
    "product.not_found",
    "This dish or size is no longer offered here. Close this window and choose another dish or size.",
  ],
  ["dark", "product.not_found", codeMessage("product.not_found", "es-ES")],
  [
    "light",
    "product.archived",
    "This dish or size has been archived. Close this window and choose another dish or size.",
  ],
  ["dark", "product.archived", codeMessage("product.archived", "es-ES")],
] as const)(
  "availability controls, sending and refusal are accessible in %s for %s",
  async (theme, code, expected) => {
    setLocale(theme === "dark" ? "es-ES" : "en-GB");
    let reject!: (error: unknown) => void;
    const change = vi.fn(
      () =>
        new Promise<void>((_resolve, no) => {
          reject = no;
        }),
    );
    const product = {
      ...base,
      productId: "soup",
      available: false,
      variants: [
        {
          ...base,
          id: "cup",
          name: "Cup",
          unitPrice: "2.00",
          unitPriceDifference: null,
          available: false,
        },
      ],
    };
    const { el, host } = await mountWidget<TillProductInfo>(
      "till-product-info",
      { product, changeAvailability: change },
      theme,
    );
    const dish = el.shadowRoot!.querySelector<HTMLElement>('[data-availability="soup"]')!;
    expect(dish).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-availability="cup"]')).not.toBeNull();
    await expectNoA11yViolations(host);
    await userEvent.click(dish);
    expect(change).toHaveBeenCalledExactlyOnceWith("soup", true);
    expect((dish as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    reject({ code });
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull());
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe(expected);
    await expectNoA11yViolations(host);
  },
);
