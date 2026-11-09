import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons, DROPDOWN_ICONS } from "@waitron/ui";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { equipmentItem, roleOf } from "../../test/pay-equipment-fixtures.js";
import { TillTicketView } from "./till-ticket-view.js";

registerIcons(DROPDOWN_ICONS);
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

for (const language of ["en-GB", "es-ES"])
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      it(`Invoice printer row fits ${language} ${theme} ${width}`, async () => {
        const incoming = { width: window.innerWidth, height: window.innerHeight };
        try {
          await page.viewport(width, 1000);
          expect(window.innerWidth).toBe(width);
          setLocale(language);
          const office = equipmentItem("office", "Office printer beside the main dining room", {
            kind: "a4",
          });
          const bar = equipmentItem("bar", "Bar", { kind: "receipt" });
          const { el } = await mountWidget<TillTicketView>(
            "till-ticket-view",
            {
              issuer: { venueName: "Dining Room Ltd", nif: "B12345678" },
              result: {
                receiptTrim: {},
                venueAddress: [],
                receiptSettings: { printAddress: false },
                orderLabel: "Table 6",
                orderNumber: 41,
                invoiceType: "F1",
                invoiceNumber: "A/1",
                issuedAt: "2026-08-05T12:34:56.000Z",
                total: "12.00",
                vatBreakdown: [],
                lines: [
                  { descriptions: { en: "Coffee", es: "Café" }, quantity: "2", gross: "12.00" },
                ],
                tender: { method: "cash", change: "0.00" },
                qr: "",
              },
              originalReceiptPrint: { status: "not_queued" },
              deliveries: {
                current: null,
                originalCompleted: false,
                originalPrinterId: null,
                history: [],
                actions: {
                  print: {
                    printers: [{ id: "office", name: office.name, kind: "a4" }],
                    designation: "original",
                  },
                  retryOriginal: null,
                  receiptInstead: null,
                  email: null,
                },
              },
              invoicePrintersEnabled: true,
              invoiceEquipment: { ...roleOf("invoice", office, [office, bar]), default: office },
              receiptEquipment: { ...roleOf("receipt", bar, [bar]), default: bar },
            },
            theme,
          );
          await userEvent.click(
            el.shadowRoot!.querySelector<HTMLElement>("[data-test=document-print-toggle]")!,
          );
          await userEvent.click(
            el.shadowRoot!.querySelector<HTMLElement>("[data-test=document-invoice]")!,
          );
          await el.updateComplete;
          await document.fonts.ready;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const row = el.shadowRoot!.querySelector<HTMLElement>("section.invoice-printer")!;
          const delivery = el.shadowRoot!.querySelector<HTMLElement>(".original-delivery")!;
          expect(row.getBoundingClientRect().width).toBeLessThanOrEqual(
            delivery.getBoundingClientRect().width + 1,
          );
          expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
          for (const control of row.querySelectorAll<HTMLElement>("wt-button, wt-combobox")) {
            expect(control.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
            expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(width);
          }
          await page.screenshot({
            path: `../../__screenshots__/a790-invoice-printer/${language}-${theme}-${width}.png`,
          });
          await userEvent.click(
            el.shadowRoot!.querySelector<HTMLElement>("[data-test=document-back]")!,
          );
          await el.updateComplete;
          await page.screenshot({
            path: `../../__screenshots__/a790-invoice-printer/${language}-${theme}-${width}-documents.png`,
          });
          await userEvent.click(
            el.shadowRoot!.querySelector<HTMLElement>("[data-test=document-receipt]")!,
          );
          await el.updateComplete;
          expect(
            el.shadowRoot!.querySelector<HTMLElement>("[data-test=print-receipt]")!.textContent,
          ).toContain("Bar");
          expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
          await page.screenshot({
            path: `../../__screenshots__/a790-invoice-printer/${language}-${theme}-${width}-receipt.png`,
          });
        } finally {
          await page.viewport(incoming.width, incoming.height);
        }
      });
