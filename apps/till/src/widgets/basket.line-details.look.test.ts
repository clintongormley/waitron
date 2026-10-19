import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TabLine, TillProduct } from "../api/client.js";
import { TillBasket } from "./basket.js";
import type { TillModifierPicker } from "./modifier-picker.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

const dish: TillProduct = {
  id: "dish",
  name: "Roasted pumpkin soup with seasonal garden vegetables (Large portion)",
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
          name: "Mature farmhouse sheep cheese",
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
      `A738 sent collection station action fits ${locale} ${theme} %s`,
      async (width) => {
        const priorLocale = currentLocale(),
          priorWidth = window.innerWidth,
          priorHeight = window.innerHeight;
        setLocale(locale);
        await page.viewport(width, 844);
        try {
          const store = new WorkingOrderStore();
          store.loadFrom(
            "placed",
            [
              {
                product: dish,
                workingOrderLineId: "sent-dish",
                quantity: "2",
                note: "Serve separately, please.",
              },
            ],
            undefined,
            4,
          );
          const { el, host } = await mountWidget<TillBasket>(
            "till-basket",
            {
              store,
              lineDetails: true,
              readOnly: true,
              storedLines: null,
              stationMoveLines: {
                orderId: "placed",
                revision: 4,
                lines: [
                  {
                    id: "sent-dish",
                    lineNo: 1,
                    stationId: "kitchen",
                    movable: true,
                    productId: dish.id,
                    parentLineNo: null,
                    quantity: "2.000",
                    unitPrecision: 0,
                    unitPriceGross: "123.45",
                    servedAt: null,
                    courseId: null,
                    groupId: null,
                    sentAt: "2026-10-19T10:00:00Z",
                    firedAt: "2026-10-19T10:00:00Z",
                    state: "queued",
                    note: "Serve separately, please.",
                    listId: null,
                    menuItemId: null,
                    parentProductId: null,
                  } satisfies TabLine,
                ],
              },
            },
            theme,
          );
          await userEvent.click(
            el.shadowRoot!.querySelector<HTMLElement>('[data-line-detail="0"]')!,
          );
          await el.updateComplete;
          const picker = el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!;
          await picker.updateComplete;
          const modal = picker.shadowRoot!.querySelector("wt-modal")!;
          await modal.updateComplete;
          const dialog = modal.shadowRoot!.querySelector("dialog")!;
          const action = picker.querySelector<HTMLElement>("[data-move-station]")!;
          const native = action.shadowRoot!.querySelector("button")!;
          const box = native.getBoundingClientRect(),
            bounds = dialog.getBoundingClientRect();
          const tap = parseFloat(getComputedStyle(el).getPropertyValue("--wt-tap-min"));
          expect(dialog.matches(":modal")).toBe(true);
          expect(box.width).toBeGreaterThanOrEqual(tap);
          expect(box.height).toBeGreaterThanOrEqual(tap);
          expect(box.left).toBeGreaterThanOrEqual(bounds.left);
          expect(box.right).toBeLessThanOrEqual(bounds.right);
          expect(box.top).toBeGreaterThanOrEqual(bounds.top);
          expect(box.bottom).toBeLessThanOrEqual(bounds.bottom);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          await expectNoA11yViolations(host);
          await page.screenshot({
            element: dialog,
            path: `__screenshots__/a738-station-move/${locale}-${theme}-${width}.png`,
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
            note: "No salt. Serve the cheese separately on a small plate, please.",
            extras: [
              {
                listId: "sides",
                productId: "cheese",
                name: "Mature farmhouse sheep cheese",
                price: "1.25",
                quantity: 2,
              },
            ],
          });
          store.addProduct(
            { ...dish, id: "water", name: "Water", unitPrice: "1.50", allergens: null },
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
