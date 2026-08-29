import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./dashboard-overview-screen.js";
import type { OverviewScreen } from "./dashboard-overview-screen.js";
import type { DashboardApi, SalesOverview } from "../api/client.js";

const overview: SalesOverview = {
  businessDay: "2026-08-29",
  takings: { tenderTotal: "1234.50", tipTotal: "45.00", grossTotal: "1279.50" },
  counts: { sales: 42, corrections: 2, voids: 1 },
  openTables: { open: 3, total: 12 },
  topSellers: [
    { descriptions: { es: "Café con leche", en: "Latte" }, quantity: "18", total: "36.00" },
    { descriptions: { en: "Croissant" }, quantity: "12", total: "24.00" },
  ],
};

function stubApi(withSellers: boolean): DashboardApi {
  return {
    getSalesOverview: vi
      .fn()
      .mockResolvedValue(withSellers ? overview : { ...overview, topSellers: [] }),
  } as unknown as DashboardApi;
}
async function flush(el: OverviewScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("dashboard-overview-screen a11y (%s theme)", (theme) => {
  it("renders the populated overview accessibly", async () => {
    const { el, host } = await mountWidget<OverviewScreen>(
      "dashboard-overview-screen",
      { api: stubApi(true) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the empty top-sellers state accessibly", async () => {
    const { el, host } = await mountWidget<OverviewScreen>(
      "dashboard-overview-screen",
      { api: stubApi(false) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
