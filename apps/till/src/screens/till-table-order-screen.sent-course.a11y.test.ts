import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtDialog } from "@waitron/ui";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import {
  current,
  currentGroup,
  orderGroup,
  row,
} from "./till-table-order-screen.current-orders.test-helpers.js";
import { storedDish } from "./till-table-order-screen.sent-fallback.test-helpers.js";
import { resized } from "./till-table-order-screen.test-helpers.js";
import "../till-app.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("Sent course in %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s theme", (theme) => {
    it.each([390, 1280])("keeps a retired course readable at %i", async (width) => {
      await page.viewport(width, 900);
      setLocale(locale);
      const name =
        locale === "en"
          ? "Desserts to share at the table $& $'"
          : "Postres para compartir en la mesa $& $'";
      const course = { id: "retired", name, displayOrder: 2, heldUntilFired: true };
      const { el, host } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        {
          orderId: "wo-4",
          courses: [],
          draftStore: null,
          lines: [{ ...storedDish, courseId: course.id, course }],
          groups: [orderGroup("group", 1, "held")],
          currentOrders: current({
            retainedCourses: [course],
            reminder: null,
            ungrouped: [],
            groups: [
              currentGroup("group", 1, "held", [
                row(storedDish.id, storedDish.name!, storedDish.quantity, {
                  courseId: course.id,
                  released: false,
                }),
              ]),
            ],
          }),
        },
        theme,
      );
      host.style.width = "100%";
      await resized(el);
      const drawerToggle = el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!;
      await userEvent.click(drawerToggle);
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector(
          "[data-drawer] [data-line-course], [data-drawer] [data-line-course-static]",
        ),
      ).toBeNull();
      await expectNoA11yViolations(host);
      await page.screenshot({
        element: el,
        path: `__screenshots__/a773-course-drawer-${locale}-${theme}-${width}.png`,
      });
      await userEvent.click(drawerToggle);
      await el.updateComplete;
      const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
      await panel.updateComplete;
      for (const selector of ["[data-sent-toggle]", "[data-held-toggle]"]) {
        await userEvent.click(panel.shadowRoot!.querySelector<HTMLElement>(selector)!);
        await panel.updateComplete;
      }
      await userEvent.click(
        panel.shadowRoot!.querySelector<HTMLElement>(`[data-sent-info="${storedDish.id}"]`)!,
      );
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector<WtDialog>("[data-sent-line-dialog]")!;
      await dialog.updateComplete;
      const label = dialog.querySelector<HTMLElement>("[data-sent-course]")!;
      expect(label.textContent?.trim()).toBe(name);
      expect(label.checkVisibility()).toBe(true);
      expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      expect(label.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
      await expectNoA11yViolations(host);
      await page.screenshot({
        element: dialog.shadowRoot!.querySelector<HTMLDialogElement>("dialog")!,
        path: `__screenshots__/a773-sent-course-${locale}-${theme}-${width}.png`,
      });
      const closed = new Promise<void>((resolve) =>
        dialog.addEventListener("wt-close", () => resolve(), { once: true }),
      );
      await userEvent.click(dialog.querySelector<HTMLElement>("[data-sent-line-close]")!);
      await closed;
      el.currentOrders = null;
      await el.updateComplete;
      const fallback = el.shadowRoot!.querySelector<HTMLElement>("[data-sent-fallback]")!;
      const fallbackLabel = fallback.querySelector<HTMLElement>("[data-sent-course]")!;
      expect(fallbackLabel.textContent?.trim()).toBe(name);
      expect(fallbackLabel.checkVisibility()).toBe(true);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({
        element: fallback,
        path: `__screenshots__/a773-sent-course-fallback-${locale}-${theme}-${width}.png`,
      });
    });
  });
});
