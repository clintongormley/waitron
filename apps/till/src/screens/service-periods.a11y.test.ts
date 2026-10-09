import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  servedMenus,
} from "../widgets/test-helpers.js";
import { TillCounterScreen } from "./till-counter-screen.js";
import { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { TillProduct } from "../api/client.js";

const coffee: TillProduct = {
  id: "coffee",
  catalogueId: "breakfast",
  menuItemId: "coffee-offer",
  menuVersionId: "v1",
  productId: "coffee",
  name: "Staff coffee",
  customerName: { en: "Customer coffee", es: "Café para el cliente" },
  kitchenName: "Kitchen coffee",
  unitPrice: "3.00",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: null,
};
const menus = servedMenus(
  [{ id: "breakfast", name: "Breakfast", versionId: "v1", isDefault: true, orderable: false }],
  [{ id: "coffee-offer", menuId: "breakfast", productId: "coffee" }],
);

afterEach(cleanupWidgets);

for (const locale of ["en-GB", "es-ES"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      describe(`${locale} ${theme} ${width}px`, () => {
        for (const kind of ["counter", "table"] as const) {
          it(`${kind} announces a closed zone and keeps its basket accessible`, async () => {
            const previousLocale = currentLocale();
            try {
              setLocale(locale);
              await page.viewport(width, 900);
              expect(window.innerWidth).toBe(width);
              const store = new WorkingOrderStore();
              store.addProduct(coffee, "2");
              const shared = {
                service: {
                  open: true,
                  zoneOpen: false,
                  periodName: "Lunch",
                  keepOpen: null,
                  zoneKeepOpen: null,
                },
                zoneName: "Terrace",
                departmentName: "Restaurant",
                products: [coffee],
                menus: menus.map((menu) => ({ ...menu, orderable: true })),
              };
              const { el, host } =
                kind === "counter"
                  ? await mountWidget<TillCounterScreen>(
                      "till-counter-screen",
                      {
                        ...shared,
                        embedded: true,
                        store,
                        counterTab: {
                          key: "counter",
                          title: "Counter",
                          columns: 4,
                          cards: [
                            { type: "product-grid", colSpan: 2, rowSpan: 2, config: {} },
                            { type: "basket", colSpan: 2, rowSpan: 2, config: {} },
                          ],
                        },
                      },
                      theme,
                    )
                  : await mountWidget<TillTableOrderScreen>(
                      "till-table-order-screen",
                      { ...shared, draftStore: store },
                      theme,
                    );
              const notice = el.shadowRoot!.querySelector<HTMLElement>("[data-zone-closed]");
              expect(notice?.textContent?.trim()).toBe(
                locale === "en-GB"
                  ? "Terrace is closed: nothing new can be ordered here. Bills can be paid or moved to another area."
                  : "Terrace está cerrada: no se puede pedir nada nuevo aquí. Las cuentas se pueden cobrar o mover a otra zona.",
              );
              expect(notice!.getAttribute("role")).toBe("status");
              expect(notice!.getBoundingClientRect().right).toBeLessThanOrEqual(width);
              expect(el.shadowRoot!.querySelector("till-menu-switcher")).toBeNull();
              expect(store.lines.map((line) => [line.product.id, line.quantity])).toEqual([
                ["coffee", "2"],
              ]);
              await expectNoA11yViolations(host);
              await page.screenshot({
                path: `../__screenshots__/a366-zone-closed/${kind}-${locale}-${theme}-${width}.png`,
              });
            } finally {
              setLocale(previousLocale);
              await page.viewport(1280, 768);
            }
          });
          it(`${kind} announces the closed department and keeps a readable basket`, async () => {
            const previousLocale = currentLocale();
            try {
              setLocale(locale);
              await page.viewport(width, 900);
              const store = new WorkingOrderStore();
              store.addProduct(coffee, "2");
              const shared = {
                service: {
                  open: false,
                  zoneOpen: true,
                  periodName: null,
                  keepOpen: null,
                  zoneKeepOpen: null,
                },
                departmentName: "Restaurant",
                products: [coffee],
                menus,
              };
              const { el, host } =
                kind === "counter"
                  ? await mountWidget<TillCounterScreen>(
                      "till-counter-screen",
                      {
                        ...shared,
                        embedded: true,
                        store,
                        counterTab: {
                          key: "counter",
                          title: "Counter",
                          columns: 4,
                          cards: [
                            { type: "product-grid", colSpan: 2, rowSpan: 2, config: {} },
                            { type: "basket", colSpan: 2, rowSpan: 2, config: {} },
                          ],
                        },
                      },
                      theme,
                    )
                  : await mountWidget<TillTableOrderScreen>(
                      "till-table-order-screen",
                      { ...shared, draftStore: store },
                      theme,
                    );
              const notice = el.shadowRoot!.querySelector<HTMLElement>("[data-service-closed]")!;
              expect(notice.textContent!.trim()).toBe(
                locale === "en-GB"
                  ? "Restaurant is closed: no period is running"
                  : "Restaurant está cerrado: no hay ningún periodo en curso",
              );
              expect(notice.getAttribute("role")).toBe("status");
              expect(notice.getBoundingClientRect().right).toBeLessThanOrEqual(width);
              expect(el.shadowRoot!.querySelector("till-menu-switcher")).toBeNull();
              expect(store.lines.map((line) => [line.product.id, line.quantity])).toEqual([
                ["coffee", "2"],
              ]);
              await expectNoA11yViolations(host);
              await page.screenshot({
                path: `../__screenshots__/a366-service/${kind}-${locale}-${theme}-${width}.png`,
              });
            } finally {
              setLocale(previousLocale);
              await page.viewport(1280, 768);
            }
          });
          for (const state of ["last-orders", "grace", "expired"] as const) {
            it(`${kind} ${state} keeps period eligibility and its basket readable`, async () => {
              const previousLocale = currentLocale();
              try {
                setLocale(locale);
                await page.viewport(width, 900);
                const store = new WorkingOrderStore();
                store.addProduct(coffee, "2");
                store.canSelectProduct = () => false;
                if (state === "expired") store.setBlocked(["period_ended"]);
                const shared = {
                  service: {
                    open: state === "last-orders",
                    zoneOpen: true,
                    periodName: state === "last-orders" ? "Breakfast" : null,
                    zoneKeepOpen: null,
                    keepOpen: null,
                  },
                  departmentName: "Restaurant",
                  products: [coffee],
                  menus: menus.map((menu) => ({
                    ...menu,
                    orderable: false,
                    sendable: state === "grace",
                  })),
                };
                const { el, host } =
                  kind === "counter"
                    ? await mountWidget<TillCounterScreen>(
                        "till-counter-screen",
                        {
                          ...shared,
                          embedded: true,
                          store,
                          counterTab: {
                            key: "counter",
                            title: "Counter",
                            columns: 4,
                            cards: [
                              { type: "product-grid", colSpan: 2, rowSpan: 2, config: {} },
                              { type: "basket", colSpan: 2, rowSpan: 2, config: {} },
                            ],
                          },
                        },
                        theme,
                      )
                    : await mountWidget<TillTableOrderScreen>(
                        "till-table-order-screen",
                        { ...shared, draftStore: store },
                        theme,
                      );
                expect(el.shadowRoot!.querySelector("till-menu-browser")).toBeNull();
                if (state === "last-orders")
                  expect(
                    el.shadowRoot!.querySelector("[data-last-orders-ended]")?.textContent?.trim(),
                  ).toBe(
                    locale === "en-GB" ? "Last orders have ended" : "Ya no se admiten pedidos",
                  );
                expect(store.lines.map((line) => line.quantity)).toEqual(["2"]);
                await expectNoA11yViolations(host);
                await page.screenshot({
                  path: `../__screenshots__/a432-service/${kind}-${state}-${locale}-${theme}-${width}.png`,
                });
              } finally {
                setLocale(previousLocale);
                await page.viewport(1280, 768);
              }
            });
          }
        }
      });
    }
  }
}
