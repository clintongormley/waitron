import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { UnservedDish } from "../api/finish-table-types.js";
import "./finish-table-dialog.js";
import type { TillFinishTableDialog } from "./finish-table-dialog.js";

const originalWidth = innerWidth,
  originalHeight = innerHeight;
afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(originalWidth, originalHeight);
});
for (const locale of ["en-GB", "es-ES"]) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      it(`Finish table is accessible and fits ${locale}/${theme}/${width}`, async () => {
        setLocale(locale);
        await page.viewport(width, 844);
        expect(innerWidth).toBe(width);
        const names =
          locale === "en-GB"
            ? [
                "Flan with cream",
                "Croquettes with roasted vegetables and homemade mushroom sauce",
                "Coffee",
              ]
            : [
                "Flan con nata",
                "Croquetas con verduras asadas y salsa de champiñones casera",
                "Café",
              ];
        const dishes: UnservedDish[] = ["held", "started", "fired"].map((stage, index) => ({
          lineId: `line-${index}`,
          billId: "bill",
          billRevision: 7,
          name: names[index]!,
          quantity: index === 1 ? "2.000" : "1.000",
          context: {
            billStatus: "settled",
            stage: stage === "started" ? "started" : "not_started",
            components: [
              {
                id: `ticket-${index}`,
                lineId: `line-${index}`,
                state: stage === "started" ? "preparing" : "queued",
                firedAt: stage === "held" ? null : "2026-10-19T12:00:00Z",
                quantity: "2.000",
                kitchenQuantity: "2.000",
                servedQuantity: "0.000",
                cancelledQuantity: "0.000",
              },
            ],
          },
        }));
        const { el, host } = await mountWidget<TillFinishTableDialog>(
          "till-finish-table-dialog",
          {
            dishes,
            refunds: { "line-0": "5.50", "line-1": "15.00", "line-2": "1.50" },
            reasons: [
              {
                id: "other",
                name: locale === "en-GB" ? "Other" : "Otro motivo",
                actions: ["cancel"],
                noteRequired: true,
                maxPercentBp: null,
                maxAmount: null,
                kind: "void",
                applyRoles: [],
                approverRoles: [],
              },
            ],
          },
          theme,
        );
        const root = el.shadowRoot!;
        const dialog = root.querySelector("wt-dialog")!;
        await dialog.updateComplete;
        expect(dialog.heading).toBe(
          locale === "en-GB" ? "4 dishes not served" : "4 platos sin servir",
        );
        await expectNoA11yViolations(host);
        const confirm = root.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-confirm]")!;
        confirm.click();
        await el.updateComplete;
        expect(root.querySelector("wt-form-actions")!.error).not.toBe("");
        await expectNoA11yViolations(host);
        await userEvent.click(
          page.elementLocator(root.querySelector<HTMLElement>('input[value="no"]')!),
        );
        root.querySelector("wt-combobox")!.dispatchEvent(
          new CustomEvent("wt-change", {
            detail: { value: "other" },
            bubbles: true,
            composed: true,
          }),
        );
        await el.updateComplete;
        const note = root.querySelector("wt-input")!;
        await note.updateComplete;
        await userEvent.fill(
          page.elementLocator(note.shadowRoot!.querySelector("input")!),
          locale === "en-GB" ? "Guests left" : "Los clientes se han ido",
        );
        await el.updateComplete;
        expect(confirm.disabled).toBe(false);
        await expectNoA11yViolations(host);
        for (const selector of ["[data-close]", "[data-confirm]"]) {
          const button = root.querySelector<HTMLElementTagNameMap["wt-button"]>(selector)!;
          await button.updateComplete;
          const bounds = button.shadowRoot!.querySelector("button")!.getBoundingClientRect();
          expect(bounds.width).toBeGreaterThan(40);
          expect(bounds.height).toBeGreaterThan(30);
          expect(bounds.left).toBeGreaterThanOrEqual(0);
          expect(bounds.right).toBeLessThanOrEqual(width);
          expect(bounds.top).toBeGreaterThanOrEqual(0);
          expect(bounds.bottom).toBeLessThanOrEqual(844);
        }
        const nativeDialog = dialog.shadowRoot!.querySelector("dialog")!;
        expect(nativeDialog.scrollWidth).toBeLessThanOrEqual(nativeDialog.clientWidth + 1);
        await page.screenshot({
          path: `__screenshots__/a773-finish/finish-${locale}-${theme}-${width}.png`,
        });
        el.busy = true;
        await el.updateComplete;
        await expectNoA11yViolations(host);
        el.busy = false;
        el.refusal = locale === "en-GB" ? "Try again" : "Vuelve a intentarlo";
        el.refunds = {};
        el.refundAtTill = true;
        await el.updateComplete;
        expect(root.querySelector('input[name="refund"]')).toBeNull();
        await expectNoA11yViolations(host);
      });
    }
  }
}
