import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import type { DeadEndAnswer } from "../api/client.js";
import type { OrderLine } from "../state/working-order.js";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { beer, flan, menuOf, resized } from "./till-table-order-screen.test-helpers.js";
import type { TillDeadEndsSection } from "../widgets/dead-ends-section.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("automatic routing %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])("visible warnings before Send at %i", async (width) => {
      await page.viewport(width, 1500);
      setLocale(locale);
      const draft = new DraftStore();
      draft.addProduct(beer, "2");
      draft.addProduct(flan, "1");
      const { el, host } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        { draftStore: draft, products: [beer, flan], menus: menuOf([beer, flan]), orderId: "bill" },
        theme,
      );
      host.style.width = "100%";
      await resized(el);
      if (width === 390) {
        await userEvent.click(el.shadowRoot!.querySelector<WtButton>("[data-review-open]")!);
        await el.updateComplete;
      }
      const answer: DeadEndAnswer = {
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
      };
      el.addEventListener("check-dead-ends", (event) => {
        event.preventDefault();
        const { sent, checkId } = (event as CustomEvent<{ sent: OrderLine[]; checkId: number }>)
          .detail;
        el.answerDeadEnds(sent, answer, checkId);
      });
      el.billEdit = { billId: "bill", editorVersion: 1, draftId: "saved", draftRevision: 1 };
      el.routingRevision = 1;
      await el.updateComplete;
      await expect
        .poll(() => el.shadowRoot!.querySelector("[data-draft-routing-warning]"))
        .not.toBeNull();
      const warning = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-routing-warning]")!;
      const detail = warning.querySelector<TillDeadEndsSection>("till-dead-ends-section")!;
      await detail.updateComplete;
      expect(window.innerWidth).toBe(width);
      expect(warning.checkVisibility()).toBe(true);
      expect(warning.querySelector('[aria-hidden="true"]')!.textContent).toContain("⚠");
      expect(detail.shadowRoot!.querySelector(".reason")!.textContent).toContain("Bar");
      const pane = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-pane]")!;
      const bounds = warning.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(pane.getBoundingClientRect().right);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(draft.lines.map((line) => [line.product.name, line.quantity])).toEqual([
        ["Beer", "2"],
        ["Flan", "1"],
      ]);
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("[data-draft-preview]")!.open,
      ).toBe(false);
      await expectNoA11yViolations(host);
      await page.screenshot({
        element: pane,
        path: `__screenshots__/a773-automatic-routing-${locale}-${theme}-${width}.png`,
      });
    });
  });
});
