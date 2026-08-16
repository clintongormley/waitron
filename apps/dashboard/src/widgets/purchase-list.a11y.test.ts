import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./purchase-list.js";
import type { PurchaseList } from "./purchase-list.js";
import type { PurchaseInvoice } from "../api/client.js";

/**
 * The purchase list is a PURE DISPLAY widget — no `api`, so no in-flight fetch to settle. It is mounted
 * with `invoices` assigned as a property, in both themes, and axe is run against the themed host so a
 * color-contrast check means what it means in the app. The fixture carries BOTH regimes so axe sees
 * both badge renders and both rows' Edit/Delete controls.
 */
const invoices: PurchaseInvoice[] = [
  {
    id: "pi-1",
    supplierTaxId: "B12345678",
    supplierName: "Distribuciones García SL",
    supplierInvoiceNumber: "F-2026/001",
    issuedOn: "2026-08-10",
    receivedOn: "2026-08-12",
    total: "121.00",
    regime: "general",
    deductibleProportion: "100.00",
    note: null,
    lines: [{ rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" }],
  },
  {
    id: "pi-2",
    supplierTaxId: "A87654321",
    supplierName: "Suministros del Sur SA",
    supplierInvoiceNumber: "2026-0042",
    issuedOn: "2026-07-30",
    receivedOn: "2026-08-01",
    total: "48.40",
    regime: "equivalence_surcharge",
    deductibleProportion: "0.00",
    note: "Recargo de equivalencia",
    lines: [{ rate: "10.00", base: "44.00", tax: "4.40", kind: "capital" }],
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("purchase-list a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { host } = await mountWidget<PurchaseList>(
      "dashboard-purchase-list",
      { invoices },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a row's Delete armed (confirm prompt showing)", async () => {
    const { el, host } = await mountWidget<PurchaseList>(
      "dashboard-purchase-list",
      { invoices },
      theme,
    );
    // Arm the first row's Delete — its label + aria-label flip to the confirm prompt.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-pi-1]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
