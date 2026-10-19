import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtRowActions } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import {
  current,
  currentGroup,
  orderGroup,
  row,
} from "./till-table-order-screen.current-orders.test-helpers.js";
import { storedDish } from "./till-table-order-screen.sent-fallback.test-helpers.js";
import { beer, menuOf, resized } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("retired held placement %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])("keeps Recall and New order Move usable at %i", async (width) => {
      await page.viewport(width, 1400);
      setLocale(locale);
      const draft = new DraftStore();
      const recalled = { ...storedDish, id: "recalled", name: "Recalled dish", lineNo: 2 };
      draft.loadFrom("draft", [
        {
          product: { ...beer, name: "Recalled dish" },
          quantity: "2.000",
          place: { kind: "fire" },
          source: { line: recalled, extras: [], netAmount: "6.50" },
        },
      ]);
      const { el, host } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        {
          draftStore: draft,
          products: [beer],
          menus: menuOf([beer]),
          orderId: "wo-4",
          editSentLines: true,
          lines: [storedDish],
          groups: [{ ...orderGroup("held", 1, "held"), lineIds: [storedDish.id] }],
          currentOrders: current({
            groups: [
              currentGroup("held", 1, "held", [
                row(storedDish.id, "Recorded dish", "2.000", {
                  lineNo: 1,
                  released: false,
                  kitchen: null,
                  netAmount: "6.50",
                }),
              ]),
            ],
            ungrouped: [],
            reminder: null,
          }),
        },
        theme,
      );
      host.style.width = "100%";
      await resized(el);
      const q = (selector: string) => el.shadowRoot!.querySelector<HTMLElement>(selector)!;
      await userEvent.click(q("[data-open-drawer]"));
      await el.updateComplete;
      const drawer = q("[data-drawer]");
      expect(drawer.querySelector("[data-move-line], [data-split-group-line]")).toBeNull();
      expect(drawer.querySelector("[data-group-line]")).toBeNull();

      expect(
        drawer.querySelector("[data-recall-line], [data-move-station], [data-send-line]"),
      ).toBeNull();
      expect(q("[data-move-dialog]")).toBeNull();
      await expectNoA11yViolations(host);
      await page.screenshot({
        element: drawer,
        path: `__screenshots__/a773-retired-placement-${locale}-${theme}-${width}.png`,
      });
      await userEvent.click(q("[data-open-drawer]"));
      await el.updateComplete;
      if (width < 1280) {
        await userEvent.click(q("[data-review-open]"));
        await el.updateComplete;
      }
      const panel = q("till-sent-orders") as TillSentOrders;
      await panel.updateComplete;
      for (const selector of ["[data-sent-toggle]", "[data-held-toggle]"]) {
        const toggle = panel.shadowRoot!.querySelector<HTMLElement>(selector)!;
        if (toggle.getAttribute("aria-expanded") === "false") {
          await userEvent.click(toggle);
          await panel.updateComplete;
        }
      }
      expect(
        panel.shadowRoot!.querySelector('[data-held-line="stored-dish"]')!.textContent,
      ).toContain("Recorded dish");
      await userEvent.click(
        panel.shadowRoot!.querySelector<HTMLElement>(
          '[data-held-line="stored-dish"] [data-sent-info]',
        )!,
      );
      await el.updateComplete;
      const more = q("[data-sent-line-dialog] wt-row-actions") as WtRowActions;
      await more.updateComplete;
      await userEvent.click(more.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
      expect(q("[data-sent-line-recall]").checkVisibility()).toBe(true);
      expect(q("[data-sent-line-fire]").checkVisibility()).toBe(true);
      expect(
        q("[data-sent-line-dialog]").querySelector("[data-move-line], [data-split-group-line]"),
      ).toBeNull();
      await expectNoA11yViolations(host);
      const dialog = q("[data-sent-line-dialog]");
      expect(window.innerWidth).toBe(width);
      await page.screenshot({
        path: `__screenshots__/a773-retired-send-menu-${locale}-${theme}-${width}.png`,
      });
      const closed = new Promise((resolve) =>
        dialog.addEventListener("wt-close", resolve, { once: true }),
      );
      await userEvent.click(q("[data-sent-line-close]"));
      await closed;
      await el.updateComplete;
      await userEvent.click(q('[data-draft-select="0"]'));
      await el.updateComplete;
      await userEvent.click(q("[data-draft-move]"));
      await el.updateComplete;
      const move = q("[data-draft-move-dialog]");
      expect(move.hasAttribute("open")).toBe(true);
      expect(q('[data-draft-move-to="join:held"]').checkVisibility()).toBe(true);
      expect(q('[data-draft-move-to="new"]').checkVisibility()).toBe(true);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({
        element: move.shadowRoot!.querySelector("dialog")!,
        path: `__screenshots__/a773-recalled-placement-${locale}-${theme}-${width}.png`,
      });
    });
  });
});
