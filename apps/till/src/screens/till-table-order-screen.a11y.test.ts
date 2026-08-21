import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-table-order-screen.js";
import type { TableServiceStatus, TillTableOrderScreen } from "./till-table-order-screen.js";
import type { TabLine, TillProduct } from "../api/client.js";

const products: TillProduct[] = [
  {
    id: "cafe",
    descriptions: { "es-ES": "Café" },
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
    category: null,
    allergens: null,
  },
];

const lines: TabLine[] = [
  { lineNo: 1, productId: "cafe", quantity: "2.000", unitPriceGross: "1.50", servedAt: null },
  {
    lineNo: 2,
    productId: "cafe",
    quantity: "1.000",
    unitPriceGross: "1.50",
    servedAt: "2026-08-20T10:00:00.000Z",
  },
];

const statuses: TableServiceStatus[] = [{ id: "s1", label: "Reservada", color: "#cc0000" }];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-table-order-screen a11y (%s theme)", (theme) => {
  it("has no violations with the round grid and the open tab drawer (pending + served + pay + status)", async () => {
    const { el, host } = await mountWidget<TillTableOrderScreen>(
      "till-table-order-screen",
      { products, lines, statuses, orderId: "wo-1" },
      theme,
    );
    // Open the drawer so the full subtree — Servido ticks, tab total, the reused pay widget and the
    // status picker — is included in the scan, not just the grid.
    el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
