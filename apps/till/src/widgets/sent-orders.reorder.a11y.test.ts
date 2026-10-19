import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtRowActions } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";
import { current, now } from "../screens/till-table-order-screen.current-orders.test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { TillSentOrders } from "./sent-orders.js";
import "../till-app.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("Sent heading reorder %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([360, 390, 1280])("keeps the keyboard menu and heading usable at %i", async (width) => {
      await page.viewport(width, 1100);
      expect(window.innerWidth).toBe(width);
      setLocale(locale);
      const orders = structuredClone(current());
      orders.groups.find((group) => group.id === "g3")!.rows[0]!.courseId = "long";
      orders.retainedCourses = [
        {
          id: "long",
          name:
            locale === "en"
              ? "Mains from the seasonal menu"
              : "Platos principales de la carta de temporada",
          displayOrder: 1,
          heldUntilFired: true,
        },
      ];
      const { el, host } = await mountWidget<TillSentOrders>(
        "till-sent-orders",
        {
          scope: "visit",
          billId: "wo-4",
          now,
          snapshot: { scope: "visit", billId: "wo-4", current: orders },
        },
        theme,
      );
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-held-toggle]")!);
      await el.updateComplete;
      const more = el.shadowRoot!.querySelector<WtRowActions>('[data-group-more="g3"]')!;
      await more.updateComplete;
      const trigger = more.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
      trigger.focus();
      await userEvent.keyboard("{Enter}");
      const popup = more.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
      expect(popup.matches(":popover-open")).toBe(true);
      const action = more.querySelector<HTMLElement>("[data-group-later]")!;
      for (const control of [
        trigger,
        popup,
        action,
        el.shadowRoot!.querySelector<HTMLElement>('[data-group-drag="g3"]')!,
      ]) {
        const box = control.getBoundingClientRect();
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/a773-reorder-${locale}-${theme}-${width}.png`,
      });
      await userEvent.keyboard("{Escape}");
      expect(popup.matches(":popover-open")).toBe(false);
      expect(more.shadowRoot!.activeElement).toBe(trigger);
      trigger.focus();
      await userEvent.keyboard("{Enter}");
      const commands: unknown[] = [];
      el.addEventListener("reorder-held", (event) =>
        commands.push((event as CustomEvent).detail.heldGroupIds),
      );
      const native = action.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
      native.focus();
      await userEvent.keyboard("{Enter}");
      expect(commands).toEqual([["g4", "g3"]]);
      expect(popup.matches(":popover-open")).toBe(false);
    });
  });
});
