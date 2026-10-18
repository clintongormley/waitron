import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton, WtCombobox } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import type { OrderLine } from "../state/working-order.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import {
  beer,
  flan,
  menuOf,
  openDraftLine,
  resized,
} from "./till-table-order-screen.test-helpers.js";
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
          courses: [
            {
              id: "mains",
              name: locale === "es" ? "Principales" : "Mains",
              displayOrder: 1,
              heldUntilFired: true,
            },
          ],
        },
        theme,
      );
      host.style.width = "100%";
      await resized(el);
      if (width < 1280) {
        await userEvent.click(el.shadowRoot!.querySelector<WtButton>("[data-review-open]")!);
        await el.updateComplete;
      }
      const checked = new Promise<{ sent: readonly OrderLine[]; checkId: number }>((resolve) =>
        el.addEventListener(
          "check-dead-ends",
          (event) => {
            event.preventDefault();
            resolve((event as CustomEvent).detail);
          },
          { once: true },
        ),
      );
      el.billEdit = { billId: "bill", editorVersion: 1, draftId: "draft", draftRevision: 1 };
      el.routingRevision = 1;
      const check = await checked;
      el.answerDeadEnds(
        check.sent,
        {
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
        },
        check.checkId,
      );
      await el.updateComplete;
      const pane = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-pane]")!;
      const warning = pane.querySelector<HTMLElement>("[data-draft-routing-warning]")!;
      expect(window.innerWidth).toBe(width);
      expect(warning.checkVisibility()).toBe(true);
      const picker = await openDraftLine(el, 0);
      const detail = pane.querySelector<TillDeadEndsSection>(
        "[data-draft-routing-detail] till-dead-ends-section",
      )!;
      await detail.updateComplete;
      expect(detail.shadowRoot!.querySelector(".reason")!.textContent).toContain("Bar");
      const note = picker.shadowRoot!.querySelector("wt-textarea")!;
      expect(detail.getBoundingClientRect().width).toBeGreaterThanOrEqual(
        note.getBoundingClientRect().width - 1,
      );
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
      const windowBounds = detail.getBoundingClientRect();
      for (const paragraph of detail.shadowRoot!.querySelectorAll("p")) {
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        for (const box of range.getClientRects())
          expect(box.right).toBeLessThanOrEqual(windowBounds.right + 0.5);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/a773-routing-${locale}-${theme}-${width}.png`,
      });
      expect(draft.lines.map((line) => [line.product.name, line.quantity])).toEqual([
        ["Beer", "2"],
        ["Flan", "1"],
      ]);
    });
  });
});
