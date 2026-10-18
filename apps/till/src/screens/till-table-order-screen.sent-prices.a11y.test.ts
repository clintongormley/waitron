import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { decimal, formatMoney } from "@waitron/shared";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { resized } from "./till-table-order-screen.test-helpers.js";
import { current } from "./till-table-order-screen.current-orders.test-helpers.js";
import { dish, extra, recorded } from "./till-table-order-screen.sent-prices.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import type { WtDialog } from "@waitron/ui";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("Served prices %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])(
      "keeps original prices readable and the drawer free of Served duplicates at %i",
      async (width) => {
        setLocale(locale);
        await page.viewport(width, 1200);
        const { el, host } = await mountWidget<TillTableOrderScreen>(
          "till-table-order-screen",
          {
            orderId: "wo-4",
            products: [],
            lines: [
              { ...dish, servedAt: "2026-09-28T20:05:00Z", optionSnapshots: [], note: null },
              { ...extra, servedAt: "2026-09-28T20:05:00Z", optionSnapshots: [], note: null },
            ],
            currentOrders: current({
              groups: [],
              reminder: null,
              ungrouped: [
                { ...recorded, servedAt: "2026-09-28T20:05:00Z", servedQuantity: "2.000" },
              ],
            }),
          },
          theme,
        );
        host.style.width = "100%";
        await resized(el);
        const review = el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
        if (review?.checkVisibility()) {
          await userEvent.click(review);
          await el.updateComplete;
        }
        const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
        await panel.updateComplete;
        for (const selector of ["[data-sent-toggle]", "[data-served-toggle]"]) {
          const toggle = panel.shadowRoot!.querySelector<HTMLElement>(selector)!;
          if (toggle.getAttribute("aria-expanded") === "false") {
            await userEvent.click(toggle);
            await panel.updateComplete;
          }
        }
        expect(panel.shadowRoot!.querySelector('[data-served-line="dish"]')!.textContent).toContain(
          "Recorded pizza",
        );
        await userEvent.click(
          panel.shadowRoot!.querySelector<HTMLElement>('[data-sent-info="dish"]')!,
        );
        await el.updateComplete;
        const dialog = el.shadowRoot!.querySelector<WtDialog>("[data-sent-line-dialog]")!;
        await dialog.updateComplete;
        const original = dialog.querySelector<HTMLElement>("[data-sent-line-amount] s")!;
        expect(original.checkVisibility()).toBe(true);
        expect(original.textContent).toBe(formatMoney(decimal("18.00"), currentLocale()));
        expect(getComputedStyle(original).textDecorationLine).toContain("line-through");
        expect(dialog.querySelector('[data-sent-extra="extra"] s')!.textContent).toBe(
          formatMoney(decimal("3.00"), currentLocale()),
        );
        expect(dialog.querySelector("[data-price-was]")!.textContent!.trim()).toBe(
          t("table.price_was"),
        );
        expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(width);
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/a773-served-prices-${locale}-${theme}-${width}.png`,
        });
        const closed = new Promise<void>((resolve) =>
          dialog.addEventListener("wt-close", () => resolve(), { once: true }),
        );
        await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-close]")!);
        await closed;
        await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
        await el.updateComplete;
        expect(
          el.shadowRoot!.querySelector("[data-drawer] .served, [data-drawer] .served-line"),
        ).toBeNull();
        el.shadowRoot!.querySelector<HTMLElement>("[data-drawer]")!.scrollIntoView({
          block: "center",
        });
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/a773-served-drawer-${locale}-${theme}-${width}.png`,
        });
      },
    );
  });
});
