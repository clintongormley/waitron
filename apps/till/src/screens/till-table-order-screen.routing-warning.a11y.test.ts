import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton, WtCombobox } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { beer, flan, menuOf, resized } from "./till-table-order-screen.test-helpers.js";
import type { TillDeadEndsSection } from "../widgets/dead-ends-section.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

// The tall viewport isolates the panel's width from page height.
afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("retained routing warning %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([360, 390, 1280])("reason and controls at %i", async (width) => {
      await page.viewport(width, 1500);
      setLocale(locale);
      const draft = new DraftStore();
      draft.addProduct(beer, "2");
      draft.addProduct(flan, "1");
      const { el, host } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        {
          draftStore: draft,
          products: [beer, flan],
          menus: menuOf([beer, flan]),
          orderId: "bill",
        },
        theme,
      );
      host.style.width = "100%";
      await resized(el);
      if (width < 1280) {
        await userEvent.click(el.shadowRoot!.querySelector<WtButton>("[data-review-open]")!);
        await el.updateComplete;
      }
      el.addEventListener("check-dead-ends", (event) => event.preventDefault());
      await userEvent.click(
        el.shadowRoot!.querySelector<WtButton>('[data-draft-action="send-all"]')!,
      );
      el.answerDeadEnds([...draft.lines], {
        sends: true,
        deadEnds: [
          {
            key: "0",
            name: "Beer",
            quantity: "2",
            stationId: "bar",
            stationName: "Bar",
            why: "closed",
          },
        ],
        stations: [{ id: "kitchen", name: locale === "es" ? "Cocina" : "Kitchen", open: true }],
      });
      await el.updateComplete;
      await userEvent.click(el.shadowRoot!.querySelector<WtButton>("[data-draft-dismiss]")!);
      await el.updateComplete;
      const pane = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-pane]")!;
      const warning = pane.querySelector<HTMLElement>("[data-draft-routing-warning]")!;
      expect(window.innerWidth).toBe(width);
      expect(warning.checkVisibility()).toBe(true);
      const detail = warning.querySelector<TillDeadEndsSection>("till-dead-ends-section")!;
      await detail.updateComplete;
      expect(detail.shadowRoot!.querySelector(".reason")!.textContent).toContain("Bar");
      const field = detail.shadowRoot!.querySelector<WtCombobox>("wt-combobox")!;
      const remove = detail.shadowRoot!.querySelector<WtButton>(".remove")!;
      await field.updateComplete;
      await remove.updateComplete;
      for (const control of [field, remove]) {
        const box = control.getBoundingClientRect();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
      const rowBounds = warning.assignedSlot!.parentElement!.getBoundingClientRect();
      expect(warning.getBoundingClientRect().width).toBeLessThanOrEqual(rowBounds.width);
      expect(rowBounds.right).toBeLessThanOrEqual(pane.getBoundingClientRect().right);
      expect(warning.getBoundingClientRect().right).toBeLessThanOrEqual(
        pane.getBoundingClientRect().right,
      );
      for (const paragraph of detail.shadowRoot!.querySelectorAll("p")) {
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        for (const box of range.getClientRects())
          expect(box.right).toBeLessThanOrEqual(rowBounds.right + 0.5);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({
        element: pane,
        path: `__screenshots__/a773-routing-${locale}-${theme}-${width}.png`,
      });
      expect(draft.lines.map((line) => [line.product.name, line.quantity])).toEqual([
        ["Beer", "2"],
        ["Flan", "1"],
      ]);
    });
  });
});
