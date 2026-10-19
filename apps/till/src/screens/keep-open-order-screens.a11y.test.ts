import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { TillCounterScreen } from "./till-counter-screen.js";
import { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { TillProduct } from "../api/client.js";
import type { TillKeepOpen } from "../widgets/keep-open.js";

const coffee: TillProduct = {
  id: "coffee",
  productId: "coffee",
  name: "Staff coffee",
  customerName: { en: "Customer coffee", es: "Café para el cliente" },
  kitchenName: "Kitchen coffee",
  unitPrice: "3.00",
  pricingUnit: "each" as const,
  vatClass: "general",
  category: null,
  allergens: null,
};
afterEach(cleanupWidgets);
for (const locale of ["en-GB", "es-ES"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      describe(`${locale} ${theme} ${width}px`, () => {
        for (const kind of ["counter", "table"] as const) {
          it(`${kind} keeps running, extended and closed-period recovery readable and accessible`, async () => {
            const previous = currentLocale();
            try {
              setLocale(locale);
              await page.viewport(width, 900);
              expect(window.innerWidth).toBe(width);
              for (const state of ["running", "extended", "closed"] as const) {
                const name = locale === "en-GB" ? "Lunch" : "Comida";
                const subject = {
                  periodId: "lunch",
                  periodName: name,
                  endsAt: "14:00",
                  running: state !== "closed",
                  extendedUntil: state === "extended" ? "14:30" : null,
                };
                const store = new WorkingOrderStore();
                store.addProduct(coffee, "2");
                const shared = {
                  service: {
                    open: state !== "closed",
                    zoneOpen: true,
                    periodName: state === "closed" ? null : name,
                    periodOccurrenceKey: '["department","2026-10-12","period","08:00"]',
                    zoneKeepOpen: null,
                    keepOpen: subject,
                  },
                  departmentName: "Restaurant",
                  products: [coffee],
                };
                const { el, host } =
                  kind === "counter"
                    ? await mountWidget<TillCounterScreen>(
                        "till-counter-screen",
                        {
                          ...shared,
                          embedded: true,
                          store,
                          selectedServiceZoneId: "counter",
                        },
                        theme,
                      )
                    : await mountWidget<TillTableOrderScreen>(
                        "till-table-order-screen",
                        { ...shared, zoneId: "dining", draftStore: store },
                        theme,
                      );
                const line = el.shadowRoot!.querySelector<HTMLElement>(
                  state === "closed" ? "[data-service-closed]" : "[data-service-period]",
                )!;
                const want =
                  state === "closed"
                    ? t("menu.department_closed").replace("{department}", "Restaurant")
                    : t(state === "extended" ? "keep_open.line_extended" : "keep_open.line_until")
                        .replace("{period}", t("service.open"))
                        .replace("{time}", state === "extended" ? "14:30" : "14:00");
                const widget = el.shadowRoot!.querySelector<TillKeepOpen>("till-keep-open")!;
                await widget.updateComplete;
                const button = widget.shadowRoot!.querySelector<HTMLElement>("wt-button")!;
                expect((state === "closed" ? line : button).textContent!.trim()).toBe(want);
                expect(button.textContent!.trim()).toBe(
                  state === "closed"
                    ? t("keep_open.button").replace("{period}", widget.keepOpen!.periodName)
                    : want,
                );
                for (const node of [line, button]) {
                  const bounds = node.getBoundingClientRect();
                  expect(bounds.width).toBeGreaterThan(0);
                  expect(bounds.left).toBeGreaterThanOrEqual(0);
                  expect(bounds.right).toBeLessThanOrEqual(width);
                }
                expect(store.lines.map((l) => [l.product.id, l.quantity])).toEqual([
                  ["coffee", "2"],
                ]);
                await expectNoA11yViolations(host);
                await page.screenshot({
                  path: `__screenshots__/a366-keep-open-orders/${kind}-${locale}-${theme}-${width}-${state}.png`,
                });
                cleanupWidgets();
              }
            } finally {
              setLocale(previous);
              await page.viewport(1280, 768);
            }
          });
        }
      });
    }
  }
}
