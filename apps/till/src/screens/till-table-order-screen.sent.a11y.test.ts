import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtDialog } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { current, groups, now } from "./till-table-order-screen.current-orders.test-helpers.js";
import { beer, menuOf, resized } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});
describe.each(["en", "es"] as const)("Sent on the table in %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([360, 390, 1280])(
      "keeps folds, information and native service usable at %i",
      async (width) => {
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
            currentOrders: current(),
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
        const pane = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-pane]")!;
        const toggle = panel.shadowRoot!.querySelector<HTMLElement>("[data-sent-toggle]")!;
        expect(innerWidth).toBe(width);
        expect(panel.checkVisibility()).toBe(true);
        expect(toggle.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        await expectNoA11yViolations(host);
        await page.screenshot({
          element: pane,
          path: `__screenshots__/a773-sent-integrated-${locale}-${theme}-${width}-panel.png`,
        });
        await userEvent.click(
          panel.shadowRoot!.querySelector<HTMLElement>('[data-sent-info="l-croq"]')!,
        );
        await el.updateComplete;
        const dialog = el.shadowRoot!.querySelector<WtDialog>("[data-sent-line-dialog]")!;
        await dialog.updateComplete;
        const native = dialog.shadowRoot!.querySelector<HTMLDialogElement>("dialog")!;
        const close = el.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-close]")!;
        const serve = el.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-serve]")!;
        expect(native.open).toBe(true);
        expect(close.checkVisibility()).toBe(true);
        expect(close.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(serve.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(close.textContent!.trim()).toBe(locale === "es" ? "Cerrar" : "Close");
        expect(native.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
        expect(native.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        await expectNoA11yViolations(host);
        await page.screenshot({
          element: native,
          path: `__screenshots__/a773-sent-integrated-${locale}-${theme}-${width}-line.png`,
        });
        await userEvent.click(serve);
        await el.updateComplete;
        const partial = el.shadowRoot!.querySelector<WtDialog>("[data-serve-dialog]")!;
        await partial.updateComplete;
        expect(partial.open).toBe(true);
        const calls: unknown[] = [];
        el.addEventListener("serve-lines", (event) => calls.push((event as CustomEvent).detail));
        await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-serve-dec]")!);
        await el.updateComplete;
        await expectNoA11yViolations(host);
        await page.screenshot({
          element: partial.shadowRoot!.querySelector("dialog")!,
          path: `__screenshots__/a773-sent-integrated-${locale}-${theme}-${width}-partial.png`,
        });
        await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-serve-confirm]")!);
        await el.updateComplete;
        expect(calls).toEqual([{ items: [{ lineId: "l-croq", quantity: "1" }] }]);
      },
    );
  });
});
