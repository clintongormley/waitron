import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { BillLookupRow } from "../api/client.js";
import "./find-bill-dialog.js";
import type { TillFindBillDialog } from "./find-bill-dialog.js";

const debt: BillLookupRow = {
  workingOrderId: "wo-1",
  orderNumber: 12,
  label: "Birthday",
  partyName: "Familia Ruiz",
  tables: ["Table 4"],
  invoiceNumber: "A/12",
  openedAt: "2026-10-01T18:00:00.000Z",
  departedAt: "2026-10-01T21:30:00.000Z",
  status: "left_without_paying",
  stillOwed: "30.00",
};

afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("Selected bill collection a11y (%s theme)", (theme) => {
  it.each([
    "cash",
    "card",
    "loading",
    "refusal",
    "unconfirmed-cash",
    "unconfirmed-card",
    "cash-only",
    "card-only",
    "neither",
  ] as const)("%s has no violations", async (stage) => {
    const { el, host } = await mountWidget<TillFindBillDialog>(
      "till-find-bill-dialog",
      {
        bill: debt,
        takesCash: stage !== "card-only" && stage !== "neither",
        takesManualCard: stage !== "cash-only" && stage !== "neither",
      },
      theme,
    );
    if (stage === "card") el.shadowRoot!.querySelector<HTMLElement>("[data-card]")!.click();
    if (stage === "unconfirmed-cash" || stage === "unconfirmed-card") {
      el.unconfirmed = true;
      el.confirmationTender =
        stage === "unconfirmed-cash"
          ? { method: "cash", amount: "40.00" }
          : { method: "card", amount: "30.00", externalRef: "original" };
      el.error = "sale.unconfirmed";
    }
    if (stage === "loading") el.busy = true;
    if (stage === "refusal") el.error = "sale.unconfirmed";
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});

for (const theme of ["light", "dark"] as const) {
  for (const locale of ["en", "es"]) {
    for (const width of [390, 1280]) {
      it.each(["cash", "card"] as const)(
        `labels and keyboard-toggles the requested slip for %s in ${locale}/${theme}/${width}`,
        async (method) => {
          const previousLocale = currentLocale();
          const viewport = { width: window.innerWidth, height: window.innerHeight };
          setLocale(locale);
          await page.viewport(width, 900);
          try {
            const { el, host } = await mountWidget<TillFindBillDialog>(
              "till-find-bill-dialog",
              { bill: debt, takesCash: true, takesManualCard: true, slipPrinterAvailable: true },
              theme,
            );
            el.shadowRoot!.querySelector<HTMLElement>(`[data-${method}]`)!.click();
            await el.updateComplete;
            const field =
              el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
                '[name="printSlip"]',
              )!;
            await field.updateComplete;
            const input = field.shadowRoot!.querySelector("input")!;
            expect(input.getAttribute("aria-label")).toBe(t("payment_slip.request"));
            input.focus();
            await userEvent.keyboard(" ");
            expect(input.checked).toBe(true);
            await expectNoA11yViolations(host);
            expect(window.innerWidth).toBe(width);
            await page.screenshot({
              path: `__screenshots__/a739-slip4-find-bill-dialog-${method}-${locale}-${theme}-${width}.png`,
            });
          } finally {
            setLocale(previousLocale);
            await page.viewport(viewport.width, viewport.height);
          }
        },
      );
    }
  }
}
