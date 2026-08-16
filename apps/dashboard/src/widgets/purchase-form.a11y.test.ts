import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./purchase-form.js";
import type { PurchaseForm } from "./purchase-form.js";
import type { PurchaseInvoice } from "../api/client.js";

/**
 * The purchase dialog only exposes anything to the accessibility tree once it is OPEN — a closed
 * <dialog> renders nothing — so it is mounted with `open = true` and its wt-dialog's first render
 * (which calls showModal) is settled before axe runs, in both themes. axe is run against the themed
 * host so a color-contrast check means what it means in the app.
 *
 * Two shapes are scanned: a CREATE (blank, one empty desglose line) and an EDIT pre-filled from an
 * invoice with two VAT lines — so axe sees the header inputs, the regime/kind selects, and the
 * add/remove-line controls of the desglose sub-editor in both states.
 */
afterEach(cleanupWidgets);

const EDIT_INVOICE: PurchaseInvoice = {
  id: "pi-1",
  supplierTaxId: "B12345678",
  supplierName: "Distribuciones García SL",
  supplierInvoiceNumber: "F-2026/001",
  issuedOn: "2026-08-10",
  receivedOn: "2026-08-12",
  total: "121.00",
  regime: "general",
  deductibleProportion: "100.00",
  note: "Compra de género",
  lines: [
    { rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" },
    { rate: "10.00", base: "50.00", tax: "5.00", kind: "capital" },
  ],
};

async function settle(el: PurchaseForm): Promise<void> {
  const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
}

describe.each(["light", "dark"] as const)("purchase-form a11y (%s theme)", (theme) => {
  it("renders accessibly when open for a create", async () => {
    const { el, host } = await mountWidget<PurchaseForm>(
      "dashboard-purchase-form",
      { open: true },
      theme,
    );
    await settle(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly when open for an edit", async () => {
    const { el, host } = await mountWidget<PurchaseForm>(
      "dashboard-purchase-form",
      { open: true, invoice: EDIT_INVOICE },
      theme,
    );
    await settle(el);
    await expectNoA11yViolations(host);
  });
});
