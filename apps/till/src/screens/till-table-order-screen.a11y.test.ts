import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-table-order-screen.js";
import type { TableServiceStatus, TillTableOrderScreen } from "./till-table-order-screen.js";
import type { TabLine, TillProduct } from "../api/client.js";
import type { TillProductGrid } from "../widgets/product-grid.js";

const products: TillProduct[] = [
  {
    id: "cafe",
    descriptions: { "es-ES": "Café" },
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
    category: null,
    allergens: null,
    // A default course so the round-course picker pre-selects it (KDS-2).
    courseId: "c1",
  },
];

const lines: TabLine[] = [
  {
    lineNo: 1,
    productId: "cafe",
    quantity: "2.000",
    unitPriceGross: "1.50",
    servedAt: null,
    // A HELD course (fired_at null) so the waiter-fire section is in the a11y scan under `waiter`.
    courseId: "c1",
    firedAt: null,
  },
  {
    lineNo: 2,
    productId: "cafe",
    quantity: "1.000",
    unitPriceGross: "1.50",
    servedAt: "2026-08-20T10:00:00.000Z",
    courseId: "c1",
    firedAt: null,
  },
];

const courses = [{ id: "c1", name: "Entrantes", displayOrder: 0 }];

const statuses: TableServiceStatus[] = [{ id: "s1", label: "Reservada", color: "#cc0000" }];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-table-order-screen a11y (%s theme)", (theme) => {
  it("has no violations with the round grid, the per-line course picker, the open tab drawer and the waiter-fire actions", async () => {
    const { el, host } = await mountWidget<TillTableOrderScreen>(
      "till-table-order-screen",
      { products, lines, statuses, courses, fireControl: "waiter", orderId: "wo-1" },
      theme,
    );
    // Ring a café into the current round so the per-line COURSE PICKER (KDS-2 §5b) renders and is scanned.
    el.shadowRoot!.querySelector<TillProductGrid>("till-product-grid")!
      .shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!
      .click();
    // Open the drawer so the full subtree — the waiter-fire actions, Servido ticks, tab total, the reused
    // pay widget and the status picker — is included in the scan, not just the grid.
    el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await el.updateComplete;
    // The reused basket re-renders on its OWN store subscription (a separate Lit update cycle), and its
    // freshly-created remove `wt-button`s render their inner focusable `<button>` on a following tick — so
    // let the nested widgets fully settle before axe runs, or it scans a half-upgraded control.
    await el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "till-basket",
    )!.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
