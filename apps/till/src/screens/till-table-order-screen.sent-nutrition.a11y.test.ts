import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtDialog } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import {
  current,
  groups,
  now,
  row,
} from "./till-table-order-screen.current-orders.test-helpers.js";
import { beer, menuOf, resized } from "./till-table-order-screen.test-helpers.js";
import { DraftStore } from "../state/draft-sync.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

function snapshot() {
  const data = structuredClone(current());
  data.groups[0]!.rows[0]!.nutrition = {
    allergens: { milk: {} },
    dietaryDeclarations: ["no_fish"],
  };
  data.groups[0]!.rows[1]!.nutrition = {
    allergens: { eggs: {} },
    dietaryDeclarations: ["halal"],
  };
  data.groups[2]!.rows[0]!.nutrition = {
    allergens: { gluten: { kinds: ["rye"] } },
    dietaryDeclarations: ["kosher"],
  };
  data.groups[2]!.rows.push(
    row("companion", "Another bill's dish", "1.000", {
      workingOrderId: "wo-check",
      released: false,
      nutrition: { allergens: { nuts: { kinds: ["hazelnuts"] } }, dietaryDeclarations: ["halal"] },
    }),
  );
  return data;
}
afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});
describe.each(["en", "es"] as const)("stored nutrition on the table in %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])("keeps native Sent rows readable at %i", async (width) => {
      await page.viewport(width, 1000);
      setLocale(locale);
      const draft = new DraftStore();
      draft.addProduct(beer, "1");
      const { el, host } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        {
          orderId: "wo-4",
          products: [beer],
          menus: menuOf([beer]),
          draftStore: draft,
          groups,
          currentOrders: snapshot(),
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
      for (const kind of ["served", "held"]) {
        await userEvent.click(
          panel.shadowRoot!.querySelector<HTMLElement>(`[data-${kind}-toggle]`)!,
        );
        await panel.updateComplete;
      }
      const checks = [
        ['[data-fired-line="l-croq"]', "allergen-milk", "diet-no_fish"],
        ['[data-served-line="l-salad"]', "allergen-eggs", "diet-halal"],
        ['[data-held-line="l-flan"]', "allergen-gluten", "diet-kosher"],
        ['[data-companion="companion"]', "allergen-nuts", "diet-halal"],
      ];
      for (const [selector, allergen, diet] of checks) {
        const dish = panel.shadowRoot!.querySelector<HTMLElement>(selector!)!;
        for (const name of [allergen, diet]) {
          const icon = dish.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
            `wt-icon[name="${name}"]`,
          )!;
          await icon.updateComplete;
          expect(icon.shadowRoot!.querySelector("svg")).not.toBeNull();
          const box = icon.getBoundingClientRect();
          expect(box.width).toBeGreaterThan(0);
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
        }
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({
        element: panel,
        path: `__screenshots__/a773-sent-nutrition-${locale}-${theme}-${width}.png`,
      });
      await userEvent.click(
        panel.shadowRoot!.querySelector<HTMLElement>('[data-held-line="l-flan"] [data-sent-info]')!,
      );
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector<WtDialog>("[data-sent-line-dialog]")!;
      await dialog.updateComplete;
      const icon = dialog.querySelector('wt-icon[name="allergen-gluten"]')!;
      expect(icon.getAttribute("label")).toMatch(locale === "en" ? /rye/i : /centeno/i);
      expect(dialog.querySelector('wt-icon[name="diet-kosher"]')).not.toBeNull();
      const nutrition = dialog.querySelector("[data-line-nutrition]");
      expect(nutrition).not.toBeNull();
      expect(nutrition!.textContent).toMatch(locale === "en" ? /rye/i : /centeno/i);
      expect(nutrition!.textContent).toContain("Kosher");
      await expectNoA11yViolations(host);
      await userEvent.click(dialog.querySelector<HTMLElement>("[data-sent-line-close]")!);
      await expect.poll(() => dialog.open).toBe(false);
    });
  });
});
