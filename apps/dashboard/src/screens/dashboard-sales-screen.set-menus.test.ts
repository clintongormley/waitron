import { useLocale } from "../testing/locale-setup.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { CategorySalesDto, DashboardApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import { today } from "../date-utils.js";
import type { SalesScreen } from "./dashboard-sales-screen.js";
import "./dashboard-sales-screen.js";

useLocale("es-ES");

const report: CategorySalesDto = {
  mode: "at_time_of_sale",
  tree: [
    {
      kind: "set_menus",
      id: "set_menus",
      name: "",
      depth: 0,
      gross: "68.00",
      net: "61.82",
      direct: { gross: "68.00", net: "61.82", lines: 4 },
      children: [],
    },
  ],
  gross: "68.00",
  net: "61.82",
  grossComplete: true,
  linesWithoutGross: 0,
};

function stubApi(): DashboardApi {
  const empty = { byRate: [], baseTotal: "0.00", taxTotal: "0.00", grossTotal: "0.00" };
  return {
    getSalesOverview: vi.fn().mockImplementation(async () => ({
      businessDay: today(),
      takings: { tenderTotal: "0.00", tipTotal: "0.00", grossTotal: "0.00" },
      departmentTakings: [],
      closureSummary: {
        billsClosed: { count: 0, total: "0.00" },
        deferredPayments: "0.00",
        received: "0.00",
      },
      counts: { sales: 0, corrections: 0, voids: 0 },
      openTables: { open: 0, total: 0 },
      topSellers: [],
    })),
    getDailyClose: vi.fn().mockResolvedValue({
      timeZone: "Europe/Madrid",
      outsidePayments: [],
      businessDay: "2026-08-29",
      vat: empty,
      cash: { byOrigin: [], tenderTotal: "0.00", tipTotal: "0.00" },
      departmentTakings: [],
      closureSummary: {
        billsClosed: { count: 0, total: "0.00" },
        deferredPayments: "0.00",
        received: "0.00",
      },
      counts: { sales: 0, corrections: 0, voids: 0 },
      topSellers: [],
    }),
    getSalesPeriod: vi
      .fn()
      .mockResolvedValue({ from: "2026-08-01", to: "2026-08-29", vat: empty, topSellers: [] }),
    getCategorySales: vi.fn().mockResolvedValue(report),
    getReportPrinters: vi.fn().mockResolvedValue([]),
    printCategorySales: vi.fn(),
  } as unknown as DashboardApi;
}

async function rowLabels(): Promise<[string, string, string][]> {
  const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api: stubApi() });
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=category-row]")].map(
    (row) => [
      row.querySelector("[data-test=category-label]")!.textContent!.trim(),
      row.dataset.kind!,
      String(row.querySelector("[data-test=category-path]")),
    ],
  );
}

afterEach(() => {
  cleanupWidgets();
});

describe("dashboard-sales-screen — set menus", () => {
  it("the sales screen names the Set menus group", async () => {
    expect(await rowLabels()).toEqual([[es["sales.set_menus"], "set_menus", "null"]]);
    cleanupWidgets();
    setLocale("en");
    expect(await rowLabels()).toEqual([["Set menus", "set_menus", "null"]]);
  });
});
