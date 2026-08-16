import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./purchases-screen.js";
import type { PurchasesScreen } from "./purchases-screen.js";
import type { DashboardApi, PurchaseInvoice } from "../api/client.js";

/**
 * The purchases screen scanned by axe in both themes, in its two shapes: with invoices loaded (the
 * Add control + the purchase list) and with NONE (the empty prompt). Mounted by ASSIGNING the `api`
 * stub as a property — the screen loads on connect, so the stub must resolve `listPurchaseInvoices`
 * or a stray rejection pollutes the run. The purchase form is left CLOSED (its default), so its dialog
 * renders nothing to the a11y tree (the form's own dialog is scanned in `purchase-form.a11y.test.ts`).
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
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listPurchaseInvoices: vi.fn().mockResolvedValue(invoices),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: PurchasesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("purchases-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with invoices loaded", async () => {
    const { el, host } = await mountWidget<PurchasesScreen>(
      "dashboard-purchases-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly when no invoices exist yet", async () => {
    const api = stubApi({ listPurchaseInvoices: vi.fn().mockResolvedValue([]) });
    const { el, host } = await mountWidget<PurchasesScreen>(
      "dashboard-purchases-screen",
      { api },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
