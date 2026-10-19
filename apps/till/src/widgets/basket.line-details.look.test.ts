import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TillProduct } from "../api/client.js";
import { TillBasket } from "./basket.js";
import type { TillModifierPicker } from "./modifier-picker.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

const dish: TillProduct = {
  id: "dish",
  name: "Crema de calabaza con verduras de temporada (Ración grande)",
  customerName: { en: "Customer soup" },
  kitchenName: "Kitchen soup",
  unitPrice: "123.45",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: { nuts: { kinds: ["walnuts"] }, gluten: { kinds: ["wheat"] } },
  dietaryDeclarations: ["vegetarian"],
  offeredModifiers: [
    {
      kind: "extras",
      id: "sides",
      name: "Staff sides",
      customerName: { en: "Customer sides" },
      kitchenName: "Kitchen sides",
      minPicks: 0,
      maxPicks: 3,
      items: [
        {
          productId: "cheese",
          name: "Queso curado de oveja",
          customerName: { en: "Customer cheese" },
          kitchenName: "Kitchen cheese",
          price: "1.25",
          vatClass: "general",
          portion: "1",
          unit: {
            id: "each",
            name: { en: "Each" },
            abbreviation: { en: "ea" },
            precision: 0,
            hardwareUnit: null,
          },
          maxQuantity: 3,
          preselected: false,
          addAllergens: { milk: {} },
          suitableFor: ["vegetarian"],
        },
      ],
    },
  ],
};
afterEach(cleanupWidgets);
for (const locale of ["en-GB", "es-ES"])
  for (const theme of ["light", "dark"] as const)
    it.each([390, 1280])(
      `A738 amount columns and line window fit ${locale} ${theme} %s`,
      async (width) => {
        const priorLocale = currentLocale(),
          priorWidth = window.innerWidth,
          priorHeight = window.innerHeight;
        setLocale(locale);
        await page.viewport(width, 844);
        try {
          const store = new WorkingOrderStore();
          store.addProduct(dish, "2", {
            note: "Sin sal. Servir el queso aparte, por favor.",
            extras: [
              {
                listId: "sides",
                productId: "cheese",
                name: "Queso curado de oveja",
                price: "1.25",
                quantity: 2,
              },
            ],
          });
          store.addProduct(
            { ...dish, id: "water", name: "Agua", unitPrice: "1.50", allergens: null },
            "1",
          );
          const { el, host } = await mountWidget<TillBasket>(
            "till-basket",
            {
              store,
              lineDetails: true,
              allowPickRemoval: true,
              stacked: width === 390,
            },
            theme,
          );
          const amounts = [
            ...el.shadowRoot!.querySelectorAll<HTMLElement>(".line-total, .option-total"),
          ];
          expect(amounts).toHaveLength(3);
          expect(el.shadowRoot!.querySelector(".option .qty")?.textContent?.trim()).toBe("4");
          const right = amounts[0]!.getBoundingClientRect().right;
          for (const amount of amounts)
            expect(Math.abs(amount.getBoundingClientRect().right - right)).toBeLessThanOrEqual(1);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
          await expectNoA11yViolations(host);
          await page.screenshot({
            element: el,
            path: `__screenshots__/a738-line-details/${locale}-${theme}-${width}-rows.png`,
          });
          await userEvent.click(
            el.shadowRoot!.querySelector<HTMLElement>('[data-line-detail="0"]')!,
          );
          await el.updateComplete;
          const picker = el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!;
          await picker.updateComplete;
          const modal = picker.shadowRoot!.querySelector("wt-modal")!;
          await modal.updateComplete;
          const dialog = modal.shadowRoot!.querySelector("dialog")!;
          expect(dialog.open).toBe(true);
          expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
          expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(width);
          await expectNoA11yViolations(host);
          await page.screenshot({
            element: dialog,
            path: `__screenshots__/a738-line-details/${locale}-${theme}-${width}-window.png`,
          });
          await userEvent.keyboard("{Escape}");
          await expect.poll(() => el.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
        } finally {
          cleanupWidgets();
          setLocale(priorLocale);
          await page.viewport(priorWidth, priorHeight);
        }
      },
    );
