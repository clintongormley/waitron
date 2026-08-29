import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./dashboard-sales-screen.js";
import type { SalesScreen } from "./dashboard-sales-screen.js";
import type { DailyCloseDto, DashboardApi, SalesPeriodDto } from "../api/client.js";

const close: DailyCloseDto = {
  businessDay: "2026-08-29",
  vat: {
    byRate: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
    baseTotal: "100.00",
    taxTotal: "21.00",
    grossTotal: "121.00",
  },
  cash: {
    byTill: [
      {
        tillId: "till-1",
        byMethod: [
          { method: "cash", amount: "50.00", tip: "5.00" },
          { method: "card", amount: "71.00", tip: "0.00" },
        ],
        cashTakings: "50.00",
      },
    ],
    tenderTotal: "121.00",
    tipTotal: "5.00",
  },
  counts: { sales: 8, corrections: 0, voids: 1 },
  topSellers: [{ descriptions: { es: "Café", en: "Coffee" }, quantity: "5", total: "10.00" }],
};

const period: SalesPeriodDto = {
  from: "2026-08-01",
  to: "2026-08-29",
  vat: {
    byRate: [{ rate: "21.00", base: "1000.00", tax: "210.00" }],
    baseTotal: "1000.00",
    taxTotal: "210.00",
    grossTotal: "1210.00",
  },
  topSellers: [
    { descriptions: { es: "Croqueta", en: "Croquette" }, quantity: "40", total: "80.00" },
  ],
};

function stubApi(): DashboardApi {
  return {
    getDailyClose: vi.fn().mockResolvedValue(close),
    getSalesPeriod: vi.fn().mockResolvedValue(period),
  } as unknown as DashboardApi;
}
async function flush(el: SalesScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("dashboard-sales-screen a11y (%s theme)", (theme) => {
  it("renders the single-day close accessibly", async () => {
    const { el, host } = await mountWidget<SalesScreen>(
      "dashboard-sales-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the period roll-up accessibly", async () => {
    const { el, host } = await mountWidget<SalesScreen>(
      "dashboard-sales-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    const to = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=to-picker]")!;
    to.value = "2030-06-15";
    to.dispatchEvent(new Event("change"));
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
