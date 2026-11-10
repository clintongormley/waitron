import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { invoiceOf } from "../../test/bill-pay-app.js";
import { equipmentItem, roleOf } from "../../test/pay-equipment-fixtures.js";
import { TillSettlementDocumentDialog } from "./settlement-document-dialog.js";

const originalLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

for (const language of ["en-GB", "es-ES"])
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      it(`document choice is accessible and fits ${language} ${theme} ${width}`, async () => {
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        try {
          await page.viewport(width, 900);
          setLocale(language);
          const bar = equipmentItem("bar", "Bar", { kind: "receipt" });
          const { el, host } = await mountWidget<TillSettlementDocumentDialog>(
            "till-settlement-document-dialog",
            {
              result: {
                ...invoiceOf("120.00"),
                invoiceType: "F2",
                tender: { method: "cash", change: "30.00" },
              },
              invoicePrintersEnabled: true,
              originalReceiptAvailable: true,
              originalReceiptPrint: { status: "not_queued" },
              receiptEquipment: { ...roleOf("receipt", bar, [bar]), default: bar },
            },
            theme,
          );
          const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
          await dialog.updateComplete;
          await document.fonts.ready;
          await expectNoA11yViolations(host);
          const none =
            el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
              "[data-settlement-none]",
            )!;
          await none.updateComplete;
          expect(
            none.shadowRoot!.querySelector("button")!.getBoundingClientRect().width,
          ).toBeGreaterThan(0);
          const box = dialog.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
          await page.screenshot({
            path: `../../__screenshots__/a739-documents/${language}-${theme}-${width}.png`,
          });

          el.shadowRoot!.querySelector<HTMLElement>("[data-settlement-choice=invoice]")!.click();
          await el.updateComplete;
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../../__screenshots__/a739-documents/${language}-${theme}-${width}-f2.png`,
          });
          el.result = {
            ...invoiceOf("30.00"),
            invoiceType: "F1",
            recipient: {
              legalName: "Harbour Ltd",
              taxId: "B12345678",
              address: "1 Harbour Road",
              countryCode: "ES",
            },
          };
          const office = equipmentItem("office", "Office", { kind: "a4" });
          el.invoiceEquipment = roleOf("invoice", office, [office]);
          el.deliveries = {
            current: null,
            originalCompleted: false,
            history: [],
            originalPrinterId: null,
            actions: {
              print: {
                printers: [{ id: "office", name: "Office", kind: "a4" }],
                designation: "original",
              },
              email: { designation: "original" },
              retryOriginal: null,
              receiptInstead: null,
            },
          };
          await el.updateComplete;
          el.shadowRoot!.querySelector<HTMLElement>("[data-settlement-choice=receipt]")!.click();
          await el.updateComplete;
          el.shadowRoot!.querySelector<HTMLElement>("[data-settlement-choice=invoice]")!.click();
          await el.updateComplete;
          expect(
            el.shadowRoot!.querySelector("[data-test=invoice-printer-toggle]")!.textContent,
          ).toContain("Office");
          expect(el.shadowRoot!.querySelector("[data-test=print-invoice]")!.textContent).toContain(
            "Office",
          );
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../../__screenshots__/a739-documents/${language}-${theme}-${width}-f1.png`,
          });
        } finally {
          await page.viewport(viewport.width, viewport.height);
        }
      });
