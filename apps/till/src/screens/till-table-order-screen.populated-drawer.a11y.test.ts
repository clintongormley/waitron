import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import { current, row } from "./till-table-order-screen.current-orders.test-helpers.js";
import {
  storedDish,
  storedExtra,
  storedServed,
} from "./till-table-order-screen.sent-fallback.test-helpers.js";
import { openSentMore } from "./till-table-order-screen.sent.test-helpers.js";
import { resized } from "./till-table-order-screen.test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import type { WtDialog } from "@waitron/ui";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import "./till-table-order-screen.js";

const dish = {
  ...storedDish,
  groupId: null,
  sentAt: "2026-09-28T19:50:00.000Z",
  firedAt: "2026-09-28T19:50:00.000Z",
};
const extra = { ...storedExtra, groupId: null, sentAt: dish.sentAt };

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("populated table drawer in %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])(
      "keeps dish details and Void in Sent, with no duplicate list at %i",
      async (width) => {
        setLocale(locale);
        await page.viewport(width, 1000);
        const { el, host } = await mountWidget<TillTableOrderScreen>(
          "till-table-order-screen",
          {
            products: [],
            draftStore: null,
            lines: [dish, extra, storedServed],
            orderId: "wo-4",
            currentOrders: current({
              groups: [],
              reminder: null,
              ungrouped: [
                row(dish.id, dish.name!, "2.000", {
                  lineNo: 1,
                  nutrition: dish.nutrition,
                  netAmount: "8.00",
                  note: dish.note,
                  extras: [
                    {
                      lineId: extra.id,
                      name: extra.name!,
                      quantity: "2.000",
                      netAmount: "1.50",
                      unitPriceGross: "0.75",
                      priceQuantity: "1.000",
                    },
                  ],
                }),
                row(storedServed.id, storedServed.name!, "1.000", {
                  lineNo: 3,
                  netAmount: "2.00",
                  servedAt: storedServed.servedAt,
                  servedQuantity: "1.000",
                  kitchen: null,
                }),
              ],
            }),
          },
          theme,
        );
        host.style.width = "100%";
        await resized(el);
        expect(window.innerWidth).toBe(width);
        const q = (selector: string) => el.shadowRoot!.querySelector<HTMLElement>(selector)!;
        await userEvent.click(q("[data-open-drawer]"));
        await el.updateComplete;
        const drawer = q("[data-drawer]");
        expect(drawer.checkVisibility()).toBe(true);
        expect(
          drawer.querySelector(".pending, .pending-line, .served-line, [data-cancel-line]"),
        ).toBeNull();
        expect(drawer.textContent).not.toContain(t("table.pending_title"));
        expect(q("[data-tab-total]").textContent).toContain(formatMoney("10.00", currentLocale()));
        expect(q("[data-pending-badge]").textContent).toBe("2");
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/a773-populated-drawer-${locale}-${theme}-${width}.png`,
        });
        await userEvent.click(q("[data-open-drawer]"));
        await el.updateComplete;
        if (q("[data-draft-pane]").hidden) {
          await userEvent.click(q("[data-review-open]"));
          await el.updateComplete;
        }
        const panel = q("till-sent-orders") as TillSentOrders;
        await panel.updateComplete;
        const toggle = panel.shadowRoot!.querySelector<HTMLElement>("[data-sent-toggle]")!;
        if (toggle.getAttribute("aria-expanded") === "false") {
          await userEvent.click(toggle);
          await panel.updateComplete;
        }
        const info = panel.shadowRoot!.querySelector<HTMLElement>(
          '[data-sent-info="stored-dish"]',
        )!;
        expect(info.checkVisibility()).toBe(true);
        await userEvent.click(info);
        await el.updateComplete;
        const dialog = q("[data-sent-line-dialog]") as WtDialog;
        await dialog.updateComplete;
        expect(dialog.open).toBe(true);
        expect(dialog.textContent).toContain("Recorded dish");
        expect(dialog.textContent).toContain("Recorded extra");
        expect(dialog.textContent).toContain("No salt $& $'");
        expect(q("[data-sent-line-amount]").textContent).toContain(
          formatMoney("10.00", currentLocale()),
        );
        expect(q("[data-sent-line-amount]").textContent).toContain(
          formatMoney("6.50", currentLocale()),
        );
        expect(q("[data-sent-extra]").textContent).toContain(formatMoney("1.50", currentLocale()));
        expect(dialog.querySelector('wt-icon[name="allergen-gluten"]')).not.toBeNull();
        expect(dialog.querySelector('wt-icon[name="allergen-milk"]')).not.toBeNull();
        expect(dialog.querySelector("[data-cancel-line], [data-sent-extra] wt-button")).toBeNull();
        await openSentMore(el);
        const cancel = q("[data-sent-line-void]");
        expect(cancel.shadowRoot!.querySelector("button")!.checkVisibility()).toBe(true);
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/a773-populated-sent-${locale}-${theme}-${width}.png`,
        });
        const seen: CustomEvent[] = [];
        el.addEventListener("cancel-item", (event) => seen.push(event as CustomEvent));
        await userEvent.click(cancel);
        expect(seen.map((event) => [event.detail, event.bubbles, event.composed])).toEqual([
          [{ lineId: "stored-dish" }, true, true],
        ]);
      },
    );
  });
});
