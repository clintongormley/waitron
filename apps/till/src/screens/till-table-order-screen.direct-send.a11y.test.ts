import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { beer, flan, menuOf, resized } from "./till-table-order-screen.test-helpers.js";
import type { SubmitDraftDetail, TillTableOrderScreen } from "./till-table-order-screen.js";

const fill = (button: WtButton) =>
  getComputedStyle(button.shadowRoot!.querySelector("button")!).backgroundColor;
afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});
describe.each(["en", "es"] as const)("direct actions %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])("selection, native controls and direct sending at %i", async (width) => {
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
      const fire = el.shadowRoot!.querySelector<WtButton>('[data-draft-action="fire-selected"]')!;
      const send = el.shadowRoot!.querySelector<WtButton>('[data-draft-action="send-all"]')!;
      const move = el.shadowRoot!.querySelector<WtButton>("[data-draft-move]")!;
      await Promise.all([fire.updateComplete, send.updateComplete, move.updateComplete]);
      expect(fire.shadowRoot!.querySelector("button")!.disabled).toBe(true);
      expect(fill(fire)).toBe(fill(move));
      expect(fill(send)).not.toBe(fill(move));
      expect(send.textContent!.trim()).toBe(locale === "en" ? "Send all" : "Enviar todo");
      expect(fire.textContent!.trim()).toBe(locale === "en" ? "Fire" : "Marchar");
      for (const button of [fire, send, move]) {
        const box = button.shadowRoot!.querySelector("button")!.getBoundingClientRect();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-draft-select="1"]')!);
      await el.updateComplete;
      await Promise.all([fire.updateComplete, move.updateComplete]);
      expect(fire.shadowRoot!.querySelector("button")!.disabled).toBe(false);
      expect(fill(fire)).toBe(fill(send));
      expect(fill(move)).toBe(fill(send));
      await expectNoA11yViolations(host);
      await page.screenshot({
        element: el.shadowRoot!.querySelector<HTMLElement>("[data-draft-pane]")!,
        path: `__screenshots__/a773-direct-send-${locale}-${theme}-${width}.png`,
      });
      const submitted: SubmitDraftDetail[] = [];
      el.addEventListener("submit-draft", (event) =>
        submitted.push((event as CustomEvent<SubmitDraftDetail>).detail),
      );
      await userEvent.click(fire);
      expect(submitted).toHaveLength(1);
      expect(submitted[0]!.sent).toEqual([draft.lines[1]]);
      expect(submitted[0]!.groups).toEqual([{ release: "fire", lineIndexes: [0] }]);
      expect(el.shadowRoot!.querySelector("[data-draft-preview]")).toBeNull();
    });
  });
});
