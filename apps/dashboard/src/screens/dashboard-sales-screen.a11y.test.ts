import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./dashboard-sales-screen.js";
import type { SalesScreen } from "./dashboard-sales-screen.js";
import type {
  CategorySalesDto,
  DailyCloseDto,
  DashboardApi,
  SalesPeriodDto,
} from "../api/client.js";

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
  topSellers: [
    {
      name: "Café",
      quantity: "5",
      total: "10.00",
      variants: [
        { name: "Café doble", quantity: "3", total: "7.50" },
        { name: "Café solo", quantity: "2", total: "2.50" },
      ],
    },
  ],
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
    {
      name: "Croqueta",
      quantity: "40",
      total: "80.00",
      variants: [{ name: "Croqueta de jamón", quantity: "40", total: "80.00" }],
    },
  ],
};

const direct = (gross: string, net: string, lines: number) => ({ gross, net, lines });

// Every row kind the table draws: a parent with a Directly-in row, a leaf, Uncategorised, and Not
// recorded with its own row and a free-text child; labels; and the incomplete note.
const categories: CategorySalesDto = {
  mode: "at_time_of_sale",
  tree: [
    {
      kind: "category",
      id: "c-drinks",
      name: "Bebidas Casa",
      depth: 0,
      gross: "20.00",
      net: "17.00",
      direct: direct("5.00", "4.50", 2),
      children: [
        {
          kind: "category",
          id: "c-softs",
          name: "Refrescos Casa",
          depth: 1,
          gross: "15.00",
          net: "12.50",
          direct: direct("15.00", "12.50", 3),
          children: [],
        },
      ],
    },
    {
      kind: "uncategorised",
      id: "uncategorised",
      name: "",
      depth: 0,
      gross: "3.00",
      net: "2.70",
      direct: direct("3.00", "2.70", 1),
      children: [],
    },
    {
      kind: "not_recorded",
      id: "not_recorded",
      name: "",
      depth: 0,
      gross: "1.00",
      net: "6.00",
      direct: direct("0.00", "2.00", 2),
      children: [
        {
          kind: "free_text",
          id: "Tapas viejas",
          name: "Tapas viejas",
          depth: 1,
          gross: "1.00",
          net: "4.00",
          direct: direct("1.00", "4.00", 3),
          children: [],
        },
      ],
    },
  ],
  labels: [{ id: "l-happy", name: "Hora feliz Casa", gross: "8.00", net: "7.00" }],
  gross: "24.00",
  net: "25.70",
  grossComplete: false,
  linesWithoutGross: 5,
};

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getDailyClose: vi.fn().mockResolvedValue(close),
    getSalesPeriod: vi.fn().mockResolvedValue(period),
    getCategorySales: vi.fn().mockResolvedValue(categories),
    getReportPrinters: vi.fn().mockResolvedValue([{ id: "p-bar", name: "Barra Casa" }]),
    printCategorySales: vi.fn().mockResolvedValue({ jobId: "job-1" }),
    ...overrides,
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

  it("renders the category report, its labels, the incomplete note and a sent print accessibly", async () => {
    const { el, host } = await mountWidget<SalesScreen>(
      "dashboard-sales-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=print-categories]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=gross-incomplete]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=label-table]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=print-status]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders a refused current report and no printers accessibly", async () => {
    const api = stubApi({
      getCategorySales: vi.fn().mockRejectedValue({ code: "sale_classification.invalid" }),
      getReportPrinters: vi.fn().mockResolvedValue([]),
    });
    const { el, host } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api }, theme);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=categories-error]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=no-printers]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders a refused print accessibly", async () => {
    const api = stubApi({
      printCategorySales: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
    });
    const { el, host } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=print-categories]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=print-error]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
