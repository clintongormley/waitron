import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import type { OrderGroup } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { beer, flan, menuOf, resized } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("New order %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([360, 390, 1280])("group choices at %i", async (width) => {
      await page.viewport(width, 1500);
      setLocale(locale);
      const draft = new DraftStore();
      const mains = {
        ...beer,
        id: "main",
        menuItemId: "offer-main",
        name: "Solomillo",
        courseId: "main",
      };
      const bread = { ...beer, id: "bread", menuItemId: "offer-bread", name: "Bread" };
      draft.addProduct(beer, "1");
      draft.addProduct(mains, "1");
      draft.addProduct(flan, "1");
      draft.addProduct(bread, "1");
      draft.setLinePlaces([0], { kind: "fire" });
      draft.setLinePlaces([1], { kind: "new", slot: 1 });
      draft.setLinePlaces([2], { kind: "join", groupId: "held" });
      draft.setLinePlaces([3], { kind: "new", slot: 1 });
      const groups: OrderGroup[] = [
        {
          id: "held",
          position: 1,
          displayNumber: 7,
          numberPartyId: "party",
          state: "held",
          firedAt: null,
          remindAt: null,
          lineIds: [],
          courseIds: [],
          summary: "Sent steak",
        },
      ];
      const { el, host } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        {
          draftStore: draft,
          products: [beer, mains, flan, bread],
          menus: menuOf([beer, mains, flan, bread]),
          orderId: "bill",
          groups,
          courses: [
            {
              id: "main",
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
      expect(window.innerWidth).toBe(width);
      const pane = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-pane]")!;
      expect(pane.checkVisibility()).toBe(true);
      const courseHeading = pane.querySelector<HTMLElement>(".draft-section-name")!;
      expect(getComputedStyle(courseHeading).fontWeight).toBe(
        getComputedStyle(host).getPropertyValue("--wt-font-weight-normal").trim(),
      );
      for (const group of pane.querySelectorAll<HTMLElement>("[data-draft-group-select]")) {
        expect(group.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(group.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({
        element: pane,
        path: `__screenshots__/a773-new-order-${locale}-${theme}-${width}-groups-qualified.png`,
      });

      await userEvent.click(
        el.shadowRoot!.querySelector<HTMLButtonElement>('[data-draft-group-select="fire"]')!,
      );
      await el.updateComplete;
      await userEvent.click(el.shadowRoot!.querySelector<WtButton>("[data-draft-move]")!);
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-move-dialog]")!;
      expect(dialog.checkVisibility()).toBe(true);
      expect(el.shadowRoot!.querySelectorAll("[data-draft-move-to]")).toHaveLength(4);
      for (const choice of el.shadowRoot!.querySelectorAll<WtButton>("[data-draft-move-to]")) {
        await choice.updateComplete;
        const button = choice.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
        expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(button.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
        expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      }
      await expectNoA11yViolations(host);
      await page.screenshot({
        element: dialog.shadowRoot!.querySelector("dialog")!,
        path: `__screenshots__/a773-new-order-${locale}-${theme}-${width}-move-qualified.png`,
      });
    });
  });
});
