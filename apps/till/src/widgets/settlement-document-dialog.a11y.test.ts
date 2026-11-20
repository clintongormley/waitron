import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
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
          const print = vi.fn();
          const bar = equipmentItem("bar", "Bar", { kind: "receipt" });
          const { el, host } = await mountWidget<TillSettlementDocumentDialog>(
            "till-settlement-document-dialog",
            {
              cashChange: "30.00",
              paymentSlip: { print },
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
          const slip = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
            "[data-print-payment-slip]",
          )!;
          await slip.updateComplete;
          const printButton = slip.shadowRoot!.querySelector("button")!;
          expect(slip.textContent?.trim()).toBe(t("payment_slip.request"));
          printButton.focus();
          await userEvent.keyboard(" ");
          expect(print).toHaveBeenCalledOnce();
          const done =
            el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
              "[data-settlement-done]",
            )!;
          await done.updateComplete;
          expect(
            done.shadowRoot!.querySelector("button")!.getBoundingClientRect().width,
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
          el.cashChange = null;
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

for (const theme of ["light", "dark"] as const)
  it(`simulator payment notice is accessible in ${theme}`, async () => {
    const { host } = await mountWidget<TillSettlementDocumentDialog>(
      "till-settlement-document-dialog",
      {
        result: {
          ...invoiceOf("30.00"),
          payments: undefined,
          tender: { method: "card", charged: "30.00", tip: "0.00", reference: null },
        },
        simulated: true,
        simulatedCardPayment: true,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

for (const language of ["en-GB", "es-ES"])
  for (const theme of ["light", "dark"] as const)
    for (const [state, email] of [
      ["prints", true],
      ["prints", false],
      ["switched-off", true],
      ["no-printer", true],
      ["no-printer", false],
      ["not-allowed", true],
    ] as const)
      it(`closing line ${state}${email ? "" : " without email"} is accessible in ${language} ${theme}`, async () => {
        setLocale(language);
        const bar = equipmentItem("bar", "Bar", {
          kind: "receipt",
          available: state !== "switched-off",
        });
        const { el, host } = await mountWidget<TillSettlementDocumentDialog>(
          "till-settlement-document-dialog",
          {
            result: { ...invoiceOf("30.00"), invoiceType: "F2" },
            invoicePrintersEnabled: true,
            originalReceiptAvailable: true,
            originalReceiptPrint: { status: "not_queued" },
            canPrintReceipt: state !== "not-allowed",
            receiptEquipment:
              state === "no-printer"
                ? roleOf("receipt", null, [bar])
                : roleOf("receipt", bar, [bar]),
            deliveries: {
              current: null,
              history: [],
              originalCompleted: false,
              originalPrinterId: null,
              actions: {
                print: null,
                receiptInstead: null,
                retryOriginal: null,
                email: email ? { designation: "original" } : null,
              },
            },
          },
          theme,
        );
        await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
        expect(el.shadowRoot!.querySelector(`[data-settlement-closing="${state}"]`)).not.toBeNull();
        await expectNoA11yViolations(host);
      });
