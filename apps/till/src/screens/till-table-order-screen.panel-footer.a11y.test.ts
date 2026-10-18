import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { DraftStore } from "../state/draft-sync.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations } from "../widgets/test-helpers.js";
import type { TillTenderPay } from "../widgets/tender-pay.js";
import { beer, resized } from "./till-table-order-screen.test-helpers.js";
import {
  footerBalance,
  footerBill,
  mountFooter,
} from "./till-table-order-screen.panel-footer.test-helpers.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each(["en", "es"] as const)("the bill footer in %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s theme", (theme) => {
    describe.each([360, 390, 1280])("at %i px", (width) => {
      it.each([false, true])(
        "keeps payment below the amount and reachable without the drawer (partial %s)",
        async (partial) => {
          await page.viewport(width, 1400);
          setLocale(locale);
          const draft = new DraftStore();
          if (!partial) draft.appendLines([{ product: beer, quantity: "2" }]);
          const { el, host } = await mountFooter(
            {
              draftStore: draft,
              bills: [
                { ...footerBill, hasPayments: partial, outstanding: partial ? "8.00" : "10.00" },
              ],
              billBalance: partial ? footerBalance : null,
              fullInvoices: true,
              receiptLanguages: ["es-ES", "en-GB"],
            },
            theme,
          );
          host.style.width = "100%";
          await resized(el);
          if (width < 1280) {
            await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!);
            await el.updateComplete;
          }
          const q = (selector: string) => el.shadowRoot!.querySelector<HTMLElement>(selector);
          expect(q("[data-bill-actions]")).not.toBeNull();
          expect(q("[data-drawer]")).toBeNull();
          const footer = q("[data-bill-actions]")!;
          const summary = q("[data-order-summary]")!;
          const discount = q("[data-discount-bill]")!;
          expect(discount.textContent).toContain(t("table.discount_bill"));
          expect(summary.getBoundingClientRect().bottom).toBeLessThanOrEqual(
            footer.getBoundingClientRect().top,
          );
          const tender = el.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay");
          const controls = partial
            ? [q("[data-pay-rest]")!, q("[data-open-bill-pay]")!]
            : await (async () => {
                await tender!.updateComplete;
                return [
                  tender!.shadowRoot!.querySelector<HTMLElement>(".pay")!,
                  tender!.shadowRoot!.querySelector<HTMLElement>(".pay-card")!,
                ];
              })();
          for (const control of [
            discount,
            ...controls,
            q("[data-choose-bill-invoice]")!,
            q("[data-choose-bill-language]")!,
          ]) {
            expect(control.checkVisibility()).toBe(true);
            const rect = control.getBoundingClientRect();
            expect(rect.height).toBeGreaterThanOrEqual(44);
            expect(rect.left).toBeGreaterThanOrEqual(0);
            expect(rect.right).toBeLessThanOrEqual(width);
          }
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          await expectNoA11yViolations(host);
          await page.screenshot({
            element: q("[data-draft-pane]")!,
            path: `__screenshots__/a773-footer-${partial ? "partial" : "whole"}-${locale}-${theme}-${width}.png`,
          });
          const events: CustomEvent[] = [];
          el.addEventListener(partial ? "bill-pay" : "adjust", (event) =>
            events.push(event as CustomEvent),
          );
          await userEvent.click(partial ? controls[0]! : discount);
          expect(events).toHaveLength(1);
          expect(events[0]!.detail).toMatchObject(
            partial
              ? { way: "contribution", amount: "8.00" }
              : { kind: "discount", target: { total: "10.00" } },
          );
          expect(events[0]!.bubbles && events[0]!.composed).toBe(true);
        },
      );
    });
  });
});
