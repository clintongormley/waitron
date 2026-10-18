import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { resized } from "./till-table-order-screen.test-helpers.js";
import { storedServed } from "./till-table-order-screen.sent-fallback.test-helpers.js";
import { current, row } from "./till-table-order-screen.current-orders.test-helpers.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import "./till-table-order-screen.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("drawer without pending dishes in %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])(
      "keeps the total and Sent details without an empty To serve card at %i",
      async (width) => {
        setLocale(locale);
        await page.viewport(width, 1000);
        const { el, host } = await mountWidget<TillTableOrderScreen>(
          "till-table-order-screen",
          { orderId: "wo-4", products: [], draftStore: null, lines: [] },
          theme,
        );
        host.style.width = "100%";
        await resized(el);
        const q = (selector: string) => el.shadowRoot!.querySelector<HTMLElement>(selector)!;
        await userEvent.click(q("[data-open-drawer]"));
        await el.updateComplete;
        const drawer = q("[data-drawer]");
        expect(drawer.checkVisibility()).toBe(true);
        expect(drawer.querySelector(".pending")).toBeNull();
        expect(drawer.textContent).not.toContain(t("table.none_pending"));
        expect(q("[data-tab-total]").textContent).toContain(formatMoney("0.00", currentLocale()));
        await expectNoA11yViolations(host);

        el.lines = [storedServed];
        el.currentOrdersUnread = true;
        await el.updateComplete;
        expect(drawer.querySelector(".pending")).toBeNull();
        expect(q("[data-pending-badge]")).toBeNull();
        const total = q("[data-tab-total]");
        expect(total.textContent).toContain(formatMoney("2.00", currentLocale()));
        expect(total.checkVisibility()).toBe(true);
        expect(total.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/a773-empty-drawer-${locale}-${theme}-${width}.png`,
        });

        await userEvent.click(q("[data-open-drawer]"));
        await el.updateComplete;
        const fallback = q('[data-sent-fallback-line="stored-served"]');
        expect(fallback.checkVisibility()).toBe(true);
        expect(fallback.textContent).toContain("Recorded served dish");
        expect(q("[data-sent-unread]").checkVisibility()).toBe(true);

        el.currentOrdersUnread = false;
        el.currentOrders = current({
          groups: [],
          reminder: null,
          ungrouped: [
            row(storedServed.id, storedServed.name!, "1.000", {
              lineNo: storedServed.lineNo,
              servedAt: storedServed.servedAt,
              servedQuantity: "1.000",
              netAmount: "2.00",
            }),
          ],
        });
        await el.updateComplete;
        const panel = q("till-sent-orders") as TillSentOrders;
        await panel.updateComplete;
        for (const selector of ["[data-sent-toggle]", "[data-served-toggle]"]) {
          const toggle = panel.shadowRoot!.querySelector<HTMLElement>(selector)!;
          if (toggle.getAttribute("aria-expanded") === "false") {
            await userEvent.click(toggle);
            await panel.updateComplete;
          }
        }
        const served = panel.shadowRoot!.querySelector<HTMLElement>(
          '[data-served-line="stored-served"]',
        )!;
        expect(served.checkVisibility()).toBe(true);
        expect(served.textContent).toContain("Recorded served dish");
        await userEvent.click(q("[data-open-drawer]"));
        await el.updateComplete;
        expect(q("[data-drawer]").querySelector(".pending")).toBeNull();
        expect(q("[data-drawer]").textContent).not.toContain(t("table.pending_title"));
        expect(el.getBoundingClientRect().width).toBe(width);
        expect(window.innerWidth).toBe(width);
      },
    );
  });
});
