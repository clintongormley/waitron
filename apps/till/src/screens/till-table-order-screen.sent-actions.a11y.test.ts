import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtDialog, WtRowActions } from "@waitron/ui";
import type { TabLine } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { current, groups, now } from "./till-table-order-screen.current-orders.test-helpers.js";
import { resized } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import "../till-app.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

const line: TabLine = {
  id: "l-flan",
  name: "Flan",
  lineNo: 1,
  groupId: "g3",
  productId: null,
  quantity: "2.000",
  unitPrecision: 0,
  unitPriceGross: "2.00",
  servedAt: null,
  courseId: null,
  sentAt: null,
  firedAt: null,
  state: "queued",
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
  stationId: "cold",
  movable: true,
};

describe.each(["en", "es"] as const)("Sent dish actions in %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])("opens native held and served menus at %i", async (width) => {
      await page.viewport(width, 1000);
      expect(window.innerWidth).toBe(width);
      setLocale(locale);
      const orders = structuredClone(current());
      orders.groups[2]!.rows[0]!.kitchen!.stationId = "cold";
      orders.groups[2]!.rows[0]!.kitchen!.movable = true;
      const { el, host } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        {
          orderId: "wo-4",
          groups,
          currentOrders: orders,
          lines: [line],
          now,
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
      for (const kind of ["held", "served"] as const) {
        await userEvent.click(
          panel.shadowRoot!.querySelector<HTMLElement>(`[data-${kind}-toggle]`)!,
        );
        await panel.updateComplete;
        await userEvent.click(
          panel.shadowRoot!.querySelector<HTMLElement>(
            `[data-sent-info="${kind === "held" ? "l-flan" : "l-croq"}"]`,
          )!,
        );
        await el.updateComplete;
        const dialog = el.shadowRoot!.querySelector<WtDialog>("[data-sent-line-dialog]")!;
        await dialog.updateComplete;
        const more = dialog.querySelector<WtRowActions>("wt-row-actions")!;
        await more.updateComplete;
        const trigger = more.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
        expect(
          more.shadowRoot!.querySelector("wt-icon")!.shadowRoot!.querySelector("svg"),
        ).not.toBeNull();
        await userEvent.click(trigger);
        const popup = more.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
        expect(popup.matches(":popover-open")).toBe(true);
        expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(popup.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
        expect(popup.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        const actions = [...more.querySelectorAll<HTMLElement>("wt-button")];
        expect(actions.map((action) => action.textContent!.trim())).toEqual(
          kind === "held"
            ? locale === "es"
              ? ["Marchar ya", "Retirar", "Cambiar de estación…", "Descuento…", "Cancelar…"]
              : ["Fire now", "Recall", "Move to station…", "Comp…", "Void…"]
            : locale === "es"
              ? ["Cancelar…", "Deshacer servido"]
              : ["Void…", "Undo served"],
        );
        for (const action of actions) {
          expect(action.checkVisibility()).toBe(true);
          expect(action.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        }
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/a773-sent-menu-${locale}-${theme}-${width}-${kind}.png`,
        });
        await userEvent.click(trigger);
        await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-close]")!);
        await el.updateComplete;
      }
    });
  });
});
