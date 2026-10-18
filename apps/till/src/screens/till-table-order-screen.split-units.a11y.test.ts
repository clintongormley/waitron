import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { beer, menuOf, resized } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("Split quantity %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([360, 390, 1280])("full-height touch control at %i", async (width) => {
      await page.viewport(width, 1500);
      setLocale(locale);
      const draft = new DraftStore();
      draft.addProduct(beer, "3", { note: "No ice, please" });
      const { el, host } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        { draftStore: draft, products: [beer], menus: menuOf([beer]), orderId: "bill" },
        theme,
      );
      host.style.width = "100%";
      await resized(el);
      if (width < 1280) {
        await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!);
        await el.updateComplete;
      }
      const pane = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-pane]")!;
      const control = pane.querySelector<HTMLButtonElement>("[data-split-draft-line]")!;
      const basket = control.closest("till-basket")!;
      await basket.updateComplete;
      expect(window.innerWidth).toBe(width);
      expect(control.checkVisibility()).toBe(true);
      expect(control.assignedSlot?.name).toBe("end-0");
      const box = control.getBoundingClientRect();
      const entry = control.assignedSlot!.parentElement!.getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThan(44);
      expect(box.height).toBeCloseTo(entry.height, 0);
      expect(box.right).toBeCloseTo(entry.right, 0);
      expect(box.right).toBeLessThanOrEqual(width);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(control.getAttribute("aria-label")).toBe(
        locale === "en" ? "Split quantity · Beer" : "Separar cantidad · Beer",
      );
      await expectNoA11yViolations(host);
      await page.screenshot({
        element: pane,
        path: `__screenshots__/a773-unit-chevron-${locale}-${theme}-${width}.png`,
      });
      await userEvent.click(control);
      await el.updateComplete;
      expect(draft.lines.map((line) => line.quantity)).toEqual(["1", "1", "1"]);
      expect(draft.lines.map((line) => line.note)).toEqual([
        "No ice, please",
        "No ice, please",
        "No ice, please",
      ]);
      expect(pane.querySelectorAll("[data-split-draft-line]")).toHaveLength(0);
      await expectNoA11yViolations(host);
    });
  });
});
