import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, t } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { beer, menuOf, resized } from "./till-table-order-screen.test-helpers.js";
import {
  current,
  currentGroup,
  orderGroup,
  row,
} from "./till-table-order-screen.current-orders.test-helpers.js";
import {
  storedDish,
  storedExtra,
  storedServed,
} from "./till-table-order-screen.sent-fallback.test-helpers.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("bill panel total in %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s theme", (theme) => {
    it.each([360, 390, 1280])(
      "keeps Sent, New order and the bill amount readable at %i",
      async (width) => {
        await page.viewport(width, 1100);
        expect(window.innerWidth).toBe(width);
        setLocale(locale);
        const draft = new DraftStore();
        draft.appendLines([
          {
            product: beer,
            quantity: "2",
            extras: [
              { listId: "extras", productId: "sauce", name: "Sauce", quantity: 1, price: "0.25" },
            ],
          },
        ]);
        const { el, host } = await mountWidget<TillTableOrderScreen>(
          "till-table-order-screen",
          {
            orderId: "wo-4",
            draftStore: draft,
            products: [beer],
            menus: menuOf([beer]),
            lines: [storedDish, storedExtra, storedServed],
            groups: [orderGroup("held", 1, "held")],
            currentOrders: current({
              reminder: null,
              groups: [
                currentGroup("held", 1, "held", [
                  row("stored-dish", "Recorded dish", "2.000", {
                    released: false,
                    kitchen: null,
                    netAmount: "8.00",
                  }),
                  row("other", "Wine", "1.000", {
                    workingOrderId: "other-bill",
                    released: false,
                    kitchen: null,
                  }),
                ]),
              ],
              ungrouped: [
                row("stored-served", "Recorded served dish", "1.000", {
                  servedQuantity: "1.000",
                  servedAt: storedServed.servedAt,
                  netAmount: "2.00",
                }),
              ],
            }),
            now: Date.parse("2026-10-18T12:00:00Z"),
          },
          theme,
        );
        host.style.width = "100%";
        await resized(el);
        if (width < 1280) {
          await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!);
          await el.updateComplete;
        }
        const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
        await panel.updateComplete;
        for (const selector of ["[data-sent-toggle]", "[data-held-toggle]"]) {
          await userEvent.click(panel.shadowRoot!.querySelector<HTMLElement>(selector)!);
          await panel.updateComplete;
        }
        const total = el.shadowRoot!.querySelector<HTMLElement>("[data-order-total]")!;
        expect(total.textContent!.trim()).toBe(locale === "en" ? "€16.50" : "16,50 €");
        expect(total.checkVisibility()).toBe(true);
        expect(total.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
        expect(total.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        const summary = el.shadowRoot!.querySelector<HTMLElement>("[data-order-summary]")!;
        expect(summary.textContent).toContain(t("label.total"));
        const newOrder = el.shadowRoot!.querySelector("[data-round-controls]")!;
        expect(
          newOrder.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        const companion = panel.shadowRoot!.querySelector("[data-companion=other]")!;
        expect(companion.querySelector(".what")!.textContent!.replace(/\s+/g, " ").trim()).toBe(
          "Wine ×1",
        );
        expect(companion.querySelector(".amount, wt-button, button")).toBeNull();
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        await expectNoA11yViolations(host);
        await page.screenshot({
          element: el.shadowRoot!.querySelector<HTMLElement>("[data-draft-pane]")!,
          path: `__screenshots__/a773-panel-total-${locale}-${theme}-${width}.png`,
        });
      },
    );
  });
});
