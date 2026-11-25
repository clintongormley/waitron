import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { resized } from "./till-table-order-screen.test-helpers.js";
import {
  storedDish,
  storedExtra,
  storedServed,
} from "./till-table-order-screen.sent-fallback.test-helpers.js";
import "../till-app.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("incomplete Sent read in %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s theme", (theme) => {
    it.each([360, 390, 1280])(
      "keeps native prices and stored nutrition readable at %i",
      async (width) => {
        await page.viewport(width, 1000);
        expect(window.innerWidth).toBe(width);
        setLocale(locale);
        const { el, host } = await mountWidget<TillTableOrderScreen>(
          "till-table-order-screen",
          {
            orderId: "wo-4",
            draftStore: null,
            currentOrders: null,
            currentOrdersUnread: true,
            lines: [storedDish, storedExtra, storedServed],
          },
          theme,
        );
        host.style.width = "100%";
        await resized(el);
        const fallback = el.shadowRoot!.querySelector<HTMLElement>("[data-sent-fallback]")!;
        expect(fallback.checkVisibility()).toBe(true);
        expect(el.getBoundingClientRect().width).toBe(width);
        expect(fallback.scrollWidth).toBeLessThanOrEqual(fallback.clientWidth);
        expect(el.shadowRoot!.querySelector("[data-sent-unread]")!.textContent).toBe(
          t("table.current_orders_unread"),
        );
        expect(
          el.shadowRoot!.querySelector<HTMLElement>("[data-sent-unread]")!.checkVisibility(),
        ).toBe(true);
        expect(fallback.querySelector("wt-button, button, wt-row-actions, input")).toBeNull();
        const prices = [...fallback.querySelectorAll<HTMLElement>("[data-sent-fallback-price]")];
        expect(prices.map((price) => price.textContent!.replace(/\s/g, ""))).toEqual(
          locale === "en"
            ? ["Was€10.00€6.50", "€1.50", "€2.00"]
            : ["Antes10,00€6,50€", "1,50€", "2,00€"],
        );
        const dish = fallback.querySelector<HTMLElement>(
          "[data-sent-fallback-line] > .sent-fallback-row",
        )!;
        const extra = fallback.querySelector<HTMLElement>(
          "[data-sent-fallback-extra] > .sent-fallback-row",
        )!;
        expect(extra.getBoundingClientRect().left).toBeGreaterThan(
          dish.getBoundingClientRect().left,
        );
        expect(getComputedStyle(extra).color).not.toBe(getComputedStyle(dish).color);
        expect(parseFloat(getComputedStyle(extra).fontSize)).toBeLessThan(
          parseFloat(getComputedStyle(dish).fontSize),
        );
        expect(Math.round(prices[1]!.getBoundingClientRect().right)).toBe(
          Math.round(prices[0]!.getBoundingClientRect().right),
        );
        expect(currentLocale().startsWith(locale)).toBe(true);
        for (const price of prices) {
          const rect = price.getBoundingClientRect();
          expect(rect.width).toBeGreaterThan(0);
          expect(rect.left).toBeGreaterThanOrEqual(0);
          expect(rect.right).toBeLessThanOrEqual(width);
        }
        for (const name of [
          "allergen-gluten",
          "diet-kosher",
          "allergen-milk",
          "diet-no_fish",
          "allergen-eggs",
          "diet-halal",
        ]) {
          const icon = fallback.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
            `wt-icon[name="${name}"]`,
          )!;
          await icon.updateComplete;
          expect(icon.shadowRoot!.querySelector("svg")).not.toBeNull();
          const rect = icon.getBoundingClientRect();
          expect(rect.width).toBeGreaterThan(0);
          expect(rect.left).toBeGreaterThanOrEqual(0);
          expect(rect.right).toBeLessThanOrEqual(width);
        }
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/a773-sent-fallback-${locale}-${theme}-${width}.png`,
          element: el.shadowRoot!.querySelector<HTMLElement>("[data-sent-orders]")!,
        });
      },
    );
  });
});
