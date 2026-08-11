import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./layout-screen.js";
import type { LayoutScreen } from "./layout-screen.js";
import type { DashboardApi, LayoutDef } from "../api/client.js";

/**
 * The layout screen scanned by axe in both themes, in its two shapes: the full six-widget layout (both
 * region columns populated, the picker hidden because nothing is left to add) with two config sub-forms
 * expanded — product-grid's columns field and basket's "Sin ajustes" note — and a partial layout whose
 * picker is visible. Mounted by ASSIGNING the `api` stub as a property; the screen loads on connect, so
 * the stub must resolve or a stray rejection pollutes the run (a rejection is a finding).
 */
const FULL: LayoutDef = [
  { type: "product-grid", region: "main", config: { columns: 4 } },
  { type: "basket", region: "aside", config: {} },
  { type: "total", region: "aside", config: {} },
  { type: "tender-pay", region: "aside", config: {} },
  { type: "held-orders", region: "aside", config: {} },
  { type: "prep-queue", region: "aside", config: {} },
];

const PARTIAL: LayoutDef = [
  { type: "product-grid", region: "main", config: {} },
  { type: "basket", region: "aside", config: {} },
  { type: "total", region: "aside", config: {} },
  { type: "tender-pay", region: "aside", config: {} },
];

function stubApi(layout: LayoutDef): DashboardApi {
  return {
    getLayout: vi.fn().mockResolvedValue({ definition: layout, receipt: {} }),
    putLayout: vi.fn().mockResolvedValue(undefined),
  } as unknown as DashboardApi;
}

async function flush(el: LayoutScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("layout-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with a full layout and two config sub-forms expanded", async () => {
    const { el, host } = await mountWidget<LayoutScreen>(
      "dashboard-layout-screen",
      { api: stubApi(FULL) },
      theme,
    );
    await flush(el);
    // Expand the two sub-form shapes so axe scans the columns number field and the "Sin ajustes" note.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-product-grid]")!.click();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-basket]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a partial layout (the Añadir picker visible)", async () => {
    const { el, host } = await mountWidget<LayoutScreen>(
      "dashboard-layout-screen",
      { api: stubApi(PARTIAL) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
