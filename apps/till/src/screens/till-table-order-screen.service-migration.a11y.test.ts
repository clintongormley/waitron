import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtDialog, WtRowActions } from "@waitron/ui";
import { setLocale, t } from "../i18n/t.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import {
  current,
  currentGroup,
  flan,
  now,
  orderGroup,
} from "./till-table-order-screen.current-orders.test-helpers.js";
import { resized } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import "../till-app.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("Sent service migration in %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s theme", (theme) => {
    it.each([390, 1280])(
      "keeps the sole reminder and the presented dish's native station menu usable at %i",
      async (width) => {
        await page.viewport(width, 1000);
        expect(window.innerWidth).toBe(width);
        setLocale(locale);
        const { el, host } = await mountWidget<TillTableOrderScreen>(
          "till-table-order-screen",
          {
            orderId: "wo-4",
            draftStore: null,
            groups: [orderGroup("g3", 3, "held")],
            currentOrders: current({
              groups: [
                currentGroup("g3", 3, "held", [
                  {
                    ...flan,
                    billStatus: "placed",
                    kitchen: { ...flan.kitchen!, stationId: "cold", movable: true },
                  },
                ]),
              ],
              ungrouped: [],
            }),
            now,
          },
          theme,
        );
        host.style.width = "100%";
        await resized(el);
        const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
        await panel.updateComplete;
        const snooze = panel.shadowRoot!.querySelector<HTMLElement>("[data-reminder-snooze]")!;
        const clear = panel.shadowRoot!.querySelector("[data-reminder-unsnooze]");
        expect(snooze.checkVisibility()).toBe(true);
        expect(clear).toBeNull();
        const snoozes: unknown[] = [];
        el.addEventListener("snooze-group", (event) => snoozes.push((event as CustomEvent).detail));
        await userEvent.click(snooze);
        expect(snoozes).toEqual([{ groupId: "g3", minutes: 5 }]);
        await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
        await el.updateComplete;
        expect(el.shadowRoot!.querySelector("[data-drawer] [data-group-reminder]")).toBeNull();
        expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        await expectNoA11yViolations(host);
        await page.screenshot({
          element: panel,
          path: `__screenshots__/a773-service-migration-${locale}-${theme}-${width}-reminder.png`,
        });
        await userEvent.click(panel.shadowRoot!.querySelector<HTMLElement>("[data-held-toggle]")!);
        await panel.updateComplete;
        await userEvent.click(
          panel.shadowRoot!.querySelector<HTMLElement>("[data-sent-info=l-flan]")!,
        );
        await el.updateComplete;
        const dialog = el.shadowRoot!.querySelector<WtDialog>("[data-sent-line-dialog]")!;
        await dialog.updateComplete;
        const more = dialog.querySelector<WtRowActions>("wt-row-actions")!;
        await more.updateComplete;
        await userEvent.click(more.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
        const popup = more.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
        expect(popup.matches(":popover-open")).toBe(true);
        expect(popup.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
        expect(popup.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        const move = dialog.querySelector<HTMLElement>("[data-sent-line-station]")!;
        expect(move.textContent!.trim()).toBe(t("table.move_station"));
        expect(move.checkVisibility()).toBe(true);
        expect(move.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        await expectNoA11yViolations(host);
        await page.screenshot({
          element: popup,
          path: `__screenshots__/a773-service-migration-${locale}-${theme}-${width}-station.png`,
        });
        const moves: unknown[] = [];
        el.addEventListener("move-station", (event) => moves.push((event as CustomEvent).detail));
        await userEvent.click(move);
        expect(moves).toEqual([
          { workingOrderId: "wo-4", lineId: "l-flan", name: "Flan", stationId: "cold" },
        ]);
      },
    );
  });
});
