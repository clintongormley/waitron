import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { resized } from "./till-table-order-screen.test-helpers.js";
import {
  current,
  currentGroup,
  orderGroup,
  row,
} from "./till-table-order-screen.current-orders.test-helpers.js";
import { storedDish } from "./till-table-order-screen.sent-fallback.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("Sent paid facts %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])(
      "keeps partial, full and other-bill payment facts in the dish window at %i",
      async (width) => {
        setLocale(locale);
        await page.viewport(width, 1200);
        const balance = {
          workingOrderId: "wo-4",
          status: "open" as const,
          total: "6.50",
          received: "3.25",
          reserved: "0.00",
          outstanding: "3.25",
          tips: "0.00",
          payments: [],
          paidLines: [{ lineId: storedDish.id, lineNo: 1, paidQuantity: "1.000" }],
        };
        const { el, host } = await mountWidget<TillTableOrderScreen>(
          "till-table-order-screen",
          {
            orderId: "wo-4",
            products: [],
            lines: [storedDish],
            billBalance: balance,
            groups: [{ ...orderGroup("held", 1, "held"), lineIds: [storedDish.id] }],
            currentOrders: current({
              groups: [
                currentGroup("held", 1, "held", [
                  row(storedDish.id, "Recorded dish", "2.000", {
                    lineNo: 1,
                    released: false,
                    kitchen: null,
                    netAmount: "6.50",
                  }),
                ]),
              ],
              ungrouped: [],
              reminder: null,
            }),
          },
          theme,
        );
        host.style.width = "100%";
        await resized(el);
        const q = (selector: string) => el.shadowRoot!.querySelector<HTMLElement>(selector)!;
        const review = q("[data-review-open]");
        if (review?.checkVisibility()) {
          await userEvent.click(review);
          await el.updateComplete;
        }
        const panel = q("till-sent-orders") as TillSentOrders;
        await panel.updateComplete;
        for (const selector of ["[data-sent-toggle]", "[data-held-toggle]"]) {
          const toggle = panel.shadowRoot!.querySelector<HTMLElement>(selector)!;
          if (toggle.getAttribute("aria-expanded") === "false") {
            await userEvent.click(toggle);
            await panel.updateComplete;
          }
        }
        expect(
          panel.shadowRoot!.querySelector('[data-held-line="stored-dish"]')!.textContent,
        ).toContain("Recorded dish");
        await userEvent.click(
          panel.shadowRoot!.querySelector<HTMLElement>('[data-sent-info="stored-dish"]')!,
        );
        await el.updateComplete;
        expect(q("[data-sent-line-status]").textContent!.trim()).toBe(t("table.group_held"));
        expect(q("[data-sent-line-dialog] [data-line-paid]").checkVisibility()).toBe(true);
        expect(q("[data-sent-line-dialog] [data-line-paid]").textContent!.trim()).toBe(
          t("bill_pay.paid_part").replace("{paid}", "1").replace("{quantity}", "2"),
        );
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/a773-current-list-paid-${locale}-${theme}-${width}.png`,
        });
        el.billBalance = { ...balance, workingOrderId: "wo-other" };
        await el.updateComplete;
        expect(el.shadowRoot!.querySelector("[data-sent-line-dialog] [data-line-paid]")).toBeNull();
        el.billBalance = {
          ...balance,
          received: "6.50",
          outstanding: "0.00",
          paidLines: [{ lineId: storedDish.id, lineNo: 1, paidQuantity: "2.000" }],
        };
        await el.updateComplete;
        expect(q("[data-sent-line-dialog] [data-line-paid]").textContent!.trim()).toBe(
          t("bill_pay.paid"),
        );
        el.billBalance = { ...balance, received: "0.00", outstanding: "6.50", paidLines: [] };
        await el.updateComplete;
        expect(el.shadowRoot!.querySelector("[data-sent-line-dialog] [data-line-paid]")).toBeNull();
        expect(window.innerWidth).toBe(width);
      },
    );
  });
});
