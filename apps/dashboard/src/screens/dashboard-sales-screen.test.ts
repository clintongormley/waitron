import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DailyCloseDto, DashboardApi, SalesOverview, SalesPeriodDto } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import { codeMessage } from "../i18n/codes.js";
import { today } from "../date-utils.js";
import { SalesScreen } from "./dashboard-sales-screen.js";
import type { WtButton, WtInput } from "@waitron/ui";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const close: DailyCloseDto = {
  businessDay: "2026-08-29",
  vat: {
    byRate: [
      { rate: "21.00", base: "100.00", tax: "21.00" },
      { rate: "10.00", base: "50.00", tax: "5.00" },
    ],
    baseTotal: "150.00",
    taxTotal: "26.00",
    grossTotal: "176.00",
  },
  cash: {
    byOrigin: [
      {
        source: "device",
        deviceId: "device-1",
        deviceName: "Bar 1",
        byMethod: [
          { method: "cash", amount: "80.00", tip: "5.00" },
          { method: "card", amount: "96.00", tip: "3.00" },
        ],
        cashTakings: "80.00",
      },
    ],
    tenderTotal: "176.00",
    tipTotal: "8.00",
  },
  departmentTakings: [],
  closureSummary: {
    billsClosed: { count: 10, total: "176.00" },
    deferredPayments: "0.00",
    received: "176.00",
  },
  counts: { sales: 10, corrections: 1, voids: 2 },
  topSellers: [
    {
      name: "Coffee",
      quantity: "5",
      total: "10.00",
      variants: [
        { name: "Double", quantity: "3", total: "7.50" },
        { name: "Single", quantity: "2", total: "2.50" },
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
    { name: "Croquette", quantity: "40", total: "80.00", variants: [] },
    { name: "Omelette", quantity: "12", total: "36.00", variants: [] },
  ],
};

function overview(businessDay: string): SalesOverview {
  return {
    businessDay,
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
  };
}

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getSalesOverview: vi.fn().mockResolvedValue(overview(today())),
    getDailyClose: vi.fn().mockResolvedValue(close),
    getSalesPeriod: vi.fn().mockResolvedValue(period),
    getCategorySales: vi.fn().mockResolvedValue({
      mode: "at_time_of_sale",
      tree: [],
      gross: "0.00",
      net: "0.00",
      grossComplete: true,
      linesWithoutGross: 0,
    }),
    getReportPrinters: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as DashboardApi;
}
async function flush(el: SalesScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
function setDate(el: SalesScreen, test: string, value: string): void {
  const input = el.shadowRoot!.querySelector<WtInput>(`[data-test=${test}]`)!;
  input.value = value;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES"); // restore the shipped default (a test switches it)
  vi.useRealTimers();
});

describe("dashboard-sales-screen", () => {
  it("shows department subtotals beside the retained till breakdown", async () => {
    setLocale("en-GB");
    const api = stubApi({
      getDailyClose: vi.fn().mockResolvedValue({
        ...close,
        departmentTakings: [
          {
            departmentId: "dining",
            departmentName: "Dining",
            active: true,
            byMethod: [
              { method: "cash", amount: "80.00", tip: "5.00" },
              { method: "card", amount: "96.00", tip: "3.00" },
            ],
            billsClosed: { count: 10, total: "176.00" },
          },
        ],
      }),
    });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    const root = el.shadowRoot!;
    const row = root.querySelector('[data-test="department-row-dining"]');
    expect(row).not.toBeNull();
    expect([...row!.querySelectorAll("td")].map((td) => td.textContent?.trim())).toEqual([
      "€80.00",
      "€96.00",
      "€0.00",
      "10 · €176.00",
    ]);
    expect(root.querySelector('[data-test="tender-row-device-1-cash"]')!.textContent).toContain(
      "Bar 1",
    );
    expect(root.querySelector('[data-test="tender-total"]')!.textContent).toBe("€176.00");
  });

  it("opens on Overview's business day when it differs from the UTC date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T01:00:00Z"));
    const api = stubApi({
      getSalesOverview: vi.fn().mockResolvedValue(overview("2026-09-26")),
    });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);

    expect(api.getSalesOverview).toHaveBeenCalledOnce();
    expect(api.getDailyClose).toHaveBeenCalledWith("2026-09-26");
    expect(api.getCategorySales).toHaveBeenCalledWith(
      "2026-09-26",
      "2026-09-26",
      "at_time_of_sale",
      false,
    );
    expect(el.shadowRoot!.querySelector<WtInput>("[data-test=from-picker]")!.value).toBe(
      "2026-09-26",
    );
    expect(el.shadowRoot!.querySelector<WtInput>("[data-test=to-picker]")!.value).toBe(
      "2026-09-26",
    );
  });

  it("uses Overview's business day at noon rather than assuming the UTC date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    const api = stubApi({
      getSalesOverview: vi.fn().mockResolvedValue(overview("2026-09-26")),
    });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);

    expect(api.getDailyClose).toHaveBeenCalledWith("2026-09-26");
    expect(el.shadowRoot!.querySelector<WtInput>("[data-test=from-picker]")!.value).toBe(
      "2026-09-26",
    );
    expect(el.shadowRoot!.querySelector<WtInput>("[data-test=to-picker]")!.value).toBe(
      "2026-09-26",
    );
  });

  it("keeps today's business day at noon when Overview reports today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    const api = stubApi({
      getSalesOverview: vi.fn().mockResolvedValue(overview("2026-09-27")),
    });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);

    expect(api.getSalesOverview).toHaveBeenCalledOnce();
    expect(api.getDailyClose).toHaveBeenCalledTimes(1);
    expect(api.getDailyClose).toHaveBeenCalledWith("2026-09-27");
    expect(el.shadowRoot!.querySelector<WtInput>("[data-test=from-picker]")!.value).toBe(
      "2026-09-27",
    );
    expect(el.shadowRoot!.querySelector<WtInput>("[data-test=to-picker]")!.value).toBe(
      "2026-09-27",
    );
  });

  it("keeps the daily close available when Overview refuses", async () => {
    const api = stubApi({
      getSalesOverview: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);

    expect(api.getDailyClose).toHaveBeenCalledWith(today());
    expect(api.getCategorySales).toHaveBeenCalledWith(today(), today(), "at_time_of_sale", false);
    expect(el.shadowRoot!.querySelector("[data-test=tender-table]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=error]")).not.toBeNull();
  });

  it("keeps reports available while Overview has not answered", async () => {
    const api = stubApi({ getSalesOverview: vi.fn().mockReturnValue(new Promise(() => {})) });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);

    expect(api.getDailyClose).toHaveBeenCalledWith(today());
    expect(api.getCategorySales).toHaveBeenCalledWith(today(), today(), "at_time_of_sale", false);
    expect(el.shadowRoot!.querySelector("[data-test=tender-table]")).not.toBeNull();
  });

  it("keeps an operator's range if Overview answers after the operator changes it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T01:00:00Z"));
    let answerOverview!: (value: SalesOverview) => void;
    const pendingOverview = new Promise<SalesOverview>((resolve) => {
      answerOverview = resolve;
    });
    const api = stubApi({ getSalesOverview: vi.fn().mockReturnValue(pendingOverview) });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);

    setDate(el, "to-picker", "2030-06-15");
    await flush(el);
    answerOverview(overview("2026-09-26"));
    await flush(el);

    expect(api.getSalesOverview).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.querySelector<WtInput>("[data-test=from-picker]")!.value).toBe(
      "2026-09-27",
    );
    expect(el.shadowRoot!.querySelector<WtInput>("[data-test=to-picker]")!.value).toBe(
      "2030-06-15",
    );
    expect(api.getSalesPeriod).toHaveBeenLastCalledWith("2026-09-27", "2030-06-15");
  });

  it("defaults to a single-day close for today, calling getDailyClose(today)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    expect(api.getDailyClose).toHaveBeenCalledTimes(1);
    expect(api.getDailyClose).toHaveBeenCalledWith(today());
    expect(api.getSalesPeriod).not.toHaveBeenCalled();
  });

  it("renders the per-device tender table, VAT-by-rate table, counts and top sellers on a single day", async () => {
    const api = stubApi();
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    const root = el.shadowRoot!;

    // Tender table: a per-device row per method, with the tender + tip totals.
    expect(root.querySelector("[data-test=tender-table]")).not.toBeNull();
    const cashRow = root.querySelector("[data-test=tender-row-device-1-cash]")!;
    expect(cashRow.textContent).toContain("80,00\u00a0€");
    expect(cashRow.textContent).toContain("5,00\u00a0€");
    expect(root.querySelector("[data-test=tender-total]")!.textContent).toContain("176,00\u00a0€");
    expect(root.querySelector("[data-test=tip-total]")!.textContent).toContain("8,00\u00a0€");

    // VAT-by-rate table with per-rate rows and the base/tax/gross totals.
    expect(root.querySelector("[data-test=vat-table]")).not.toBeNull();
    expect(root.querySelector('[data-test="vat-row-21.00"]')!.textContent).toContain("21.00");
    expect(root.querySelector("[data-test=vat-base-total]")!.textContent).toContain(
      "150,00\u00a0€",
    );
    expect(root.querySelector("[data-test=vat-tax-total]")!.textContent).toContain("26,00\u00a0€");
    expect(root.querySelector("[data-test=vat-gross-total]")!.textContent).toContain(
      "176,00\u00a0€",
    );

    // Record counts.
    expect(root.querySelector("[data-test=count-sales]")!.textContent).toContain("10");
    expect(root.querySelector("[data-test=count-corrections]")!.textContent).toContain("1");
    expect(root.querySelector("[data-test=count-voids]")!.textContent).toContain("2");

    // Top sellers, rendered through the shared table widget (stable `top-sellers-table` hook), with
    // the row's plain staff name — no locale lookup.
    expect(root.querySelector("[data-test=top-sellers-table]")).not.toBeNull();
    expect(root.querySelector("[data-test=seller-name]")!.textContent).toContain("Coffee");
    // Its variants follow as their own rows, each under its own name and figures.
    const variant0 = root.querySelector('[data-test="seller-row-0-variant-0"]')!;
    expect(variant0.querySelector("[data-test=variant-name]")!.textContent).toBe("Double");
    expect(variant0.textContent).toContain("7,50\u00a0€");
    const variant1 = root.querySelector('[data-test="seller-row-0-variant-1"]')!;
    expect(variant1.querySelector("[data-test=variant-name]")!.textContent).toBe("Single");
    // Painted by this screen's styles: the variant's name is indented past its product's, and the
    // product name repeated for screen readers takes no room on screen.
    const parentIndent = parseFloat(
      getComputedStyle(root.querySelector("[data-test=seller-name]")!).paddingLeft,
    );
    const variantIndent = parseFloat(getComputedStyle(variant0.querySelector("th")!).paddingLeft);
    expect(variantIndent).toBeGreaterThan(parentIndent);
    expect(
      variant0.querySelector<HTMLElement>(".visually-hidden")!.offsetWidth,
    ).toBeLessThanOrEqual(1);

    // No per-day note in single-day mode.
    expect(root.querySelector("[data-test=period-note]")).toBeNull();
  });

  it("writes every amount of a day's tables as English writes euros, and each VAT rate as it is", async () => {
    setLocale("en-GB");
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api: stubApi() });
    await flush(el);
    const root = el.shadowRoot!;
    const cells = (selector: string) =>
      [...root.querySelectorAll(`${selector} th, ${selector} td`)].map((cell) =>
        cell.textContent!.trim(),
      );
    expect(cells("[data-test=tender-row-device-1-cash]")).toEqual([
      "Bar 1",
      "cash",
      "€80.00",
      "€5.00",
    ]);
    expect(cells("[data-test=tender-table] tfoot")).toEqual(["Tender total", "€176.00", "€8.00"]);
    expect(cells('[data-test="vat-row-21.00"]')).toEqual(["21.00", "€100.00", "€21.00"]);
    expect(cells("[data-test=vat-table] tfoot")).toEqual([
      "Base total",
      "€150.00",
      "€26.00",
      "Gross total",
      "€176.00",
    ]);
    expect(cells('[data-test="seller-row-0-variant-0"]')).toEqual(["Coffee, Double", "3", "€7.50"]);
  });

  it("leaves a deferred payment out of the tender table and shows it, and the bills closed, on their own lines", async () => {
    const deferredDay: DailyCloseDto = {
      ...close,
      cash: {
        byOrigin: [
          {
            source: "device",
            deviceId: "device-1",
            deviceName: "Bar 1",
            byMethod: [
              { method: "cash", amount: "10.00", tip: "0.00" },
              { method: "deferred", amount: "220.00", tip: "0.00" },
            ],
            cashTakings: "10.00",
          },
        ],
        tenderTotal: "230.00",
        tipTotal: "0.00",
      },
      departmentTakings: [],
      closureSummary: {
        billsClosed: { count: 2, total: "320.00" },
        deferredPayments: "220.00",
        received: "110.00",
      },
    };
    const api = stubApi({ getDailyClose: vi.fn().mockResolvedValue(deferredDay) });
    setLocale("en-GB");
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    const root = el.shadowRoot!;
    const text = (test: string) => root.querySelector(`[data-test=${test}]`)!.textContent;
    expect(root.querySelector("[data-test=tender-row-device-1-cash]")).not.toBeNull();
    expect(root.querySelector("[data-test=tender-row-device-1-deferred]")).toBeNull();
    expect(text("tender-total")).toBe("€110.00");
    expect(text("deferred-total")).toBe("€220.00");
    expect(text("bills-closed")).toBe("2 · €320.00");

    setLocale("es-ES");
    const spanish = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(spanish.el);
    const label = (test: string) =>
      spanish.el
        .shadowRoot!.querySelector(`[data-test=${test}]`)!
        .parentElement!.querySelector(".label")!.textContent;
    expect(label("deferred-total")).toBe(es["sales.deferred_payments"]);
    expect(label("bills-closed")).toBe("Cuentas cerradas");
  });

  it("heads each device's rows with its name, and a job's rows with the job's name", async () => {
    setLocale("en-GB");
    const api = stubApi({
      getDailyClose: vi.fn().mockResolvedValue({
        ...close,
        cash: {
          ...close.cash,
          byOrigin: [
            ...close.cash.byOrigin,
            {
              source: "demo_seed",
              deviceId: null,
              deviceName: null,
              byMethod: [{ method: "cash", amount: "15.00", tip: "0.00" }],
              cashTakings: "15.00",
            },
          ],
        },
      }),
    });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    const headings = [
      ...el.shadowRoot!.querySelectorAll("[data-test=tender-table] tbody th[scope=row]"),
    ].map((cell) => cell.textContent!.trim());
    expect(headings).toEqual(["Bar 1", "Bar 1", t("source.demo_seed")]);
    expect(headings).not.toContain("device-1");
  });

  it("groups thousands in a period's English totals, and not in its Spanish ones", async () => {
    const period = async () => {
      const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api: stubApi() });
      await flush(el);
      setDate(el, "to-picker", "2030-06-15");
      await flush(el);
      return el.shadowRoot!.querySelector("[data-test=vat-gross-total]")!.textContent!.trim();
    };
    expect(await period()).toBe("1210,00\u00a0€");
    setLocale("en-GB");
    expect(await period()).toBe("€1,210.00");
  });

  it("switches to a period roll-up when `to` is a later date, calling getSalesPeriod(from, to)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    setDate(el, "to-picker", "2030-06-15");
    await flush(el);
    expect(api.getSalesPeriod).toHaveBeenCalledTimes(1);
    expect(api.getSalesPeriod).toHaveBeenLastCalledWith(
      expect.stringMatching(DATE_RE),
      "2030-06-15",
    );
    const root = el.shadowRoot!;
    // Period mode: VAT + top sellers + the per-day note, and NO tender table.
    expect(root.querySelector("[data-test=vat-table]")).not.toBeNull();
    expect(root.querySelector("[data-test=vat-gross-total]")!.textContent).toContain(
      "1210,00\u00a0€",
    );
    expect(root.querySelector("[data-test=period-note]")).not.toBeNull();
    expect(root.querySelector("[data-test=tender-table]")).toBeNull();
    expect(root.querySelector("[data-test=top-sellers-table]")).not.toBeNull();
    const names = [...root.querySelectorAll("[data-test=seller-name]")].map((n) =>
      n.textContent?.trim(),
    );
    expect(names).toEqual(["Croquette", "Omelette"]); // each row's plain staff name, in server order
  });

  it("switches to a period roll-up when `from` is an earlier date", async () => {
    const api = stubApi();
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    setDate(el, "from-picker", "2020-01-01");
    await flush(el);
    expect(api.getSalesPeriod).toHaveBeenLastCalledWith("2020-01-01", today());
    expect(el.shadowRoot!.querySelector("[data-test=tender-table]")).toBeNull();
  });

  it("returns to a single-day close when the range collapses back to one day", async () => {
    const api = stubApi();
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    setDate(el, "to-picker", "2030-06-15"); // period
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=tender-table]")).toBeNull();
    setDate(el, "from-picker", "2030-06-15"); // from === to again → daily close
    await flush(el);
    expect(api.getDailyClose).toHaveBeenLastCalledWith("2030-06-15");
    expect(el.shadowRoot!.querySelector("[data-test=tender-table]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=period-note]")).toBeNull();
  });

  // The next three tests mock codes the server never sends. The screen renders whatever code it gets
  // without inspecting it, so these pin that ANY rejection reaches the `errorKey` banner and clears
  // stale state, not which code triggers it.

  it("shows the error banner when the daily-close load rejects", async () => {
    const api = stubApi({ getDailyClose: vi.fn().mockRejectedValue({ code: "report.forbidden" }) });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=error]")).not.toBeNull();
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("report.forbidden");
  });

  it("shows the error banner when the period load rejects (e.g. from > to → 400 management.request_invalid)", async () => {
    const api = stubApi({ getSalesPeriod: vi.fn().mockRejectedValue({ code: "report.range" }) });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    setDate(el, "to-picker", "2030-06-15");
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("report.range");
    // The previous single-day view must NOT survive the rejection beside the banner: #load clears
    // both branches up-front, so no stale close (tender/VAT tables) renders on the error path.
    const root = el.shadowRoot!;
    expect(root.querySelector("[data-test=daily-close]")).toBeNull();
    expect(root.querySelector("[data-test=tender-table]")).toBeNull();
    expect(root.querySelector("[data-test=vat-table]")).toBeNull();
  });

  it("leaves no stale period view when a single-day load rejects after a successful period", async () => {
    // Symmetric direction: successful period → collapse to one day → getDailyClose rejects. The
    // period content must be gone, not lingering beside the error banner.
    const api = stubApi({
      getDailyClose: vi
        .fn()
        .mockResolvedValueOnce(close) // the initial single-day connect load succeeds
        .mockRejectedValue({ code: "report.forbidden" }), // the collapse-back single-day load rejects
    });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    setDate(el, "to-picker", "2030-06-15"); // → period (success)
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=period]")).not.toBeNull();
    setDate(el, "from-picker", "2030-06-15"); // from === to → single-day load rejects
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("report.forbidden");
    const root = el.shadowRoot!;
    expect(root.querySelector("[data-test=period]")).toBeNull();
    expect(root.querySelector("[data-test=period-note]")).toBeNull();
    expect(root.querySelector("[data-test=vat-table]")).toBeNull();
  });

  it("falls back to server.internal when a thrown error carries no code", async () => {
    const api = stubApi({ getDailyClose: vi.fn().mockRejectedValue(new Error("network down")) });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  it("ignores a cleared date input (Invalid Date) without reloading", async () => {
    const api = stubApi();
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    expect(api.getDailyClose).toHaveBeenCalledTimes(1);
    setDate(el, "to-picker", ""); // cleared → Date.parse NaN → the handler bails
    await flush(el);
    expect(api.getDailyClose).toHaveBeenCalledTimes(1);
    expect(api.getSalesPeriod).not.toHaveBeenCalled();
  });
});

it("refreshes the selected daily report after a sale", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<HTMLElement & { api: DashboardApi }>("dashboard-sales-screen", {
    api,
  });
  await vi.waitFor(() => expect((el as unknown as { close: unknown }).close).toEqual(close));
  const updated = { ...close, businessDay: "2030-01-01" };
  vi.mocked(api.getDailyClose).mockResolvedValue(updated);
  liveData.invalidate([{ type: "sales", id: "new-sale" }]);
  await vi.waitFor(() => expect((el as unknown as { close: unknown }).close).toEqual(updated));
});

describe("dashboard-sales-screen after the server comes back", () => {
  const down = { code: "connection.failed" };

  it("clears the could-not-connect messages and shows the reports once the server answers again", async () => {
    const api = Object.assign(
      stubApi({
        getSalesOverview: vi.fn().mockRejectedValue(down),
        getDailyClose: vi.fn().mockRejectedValue(down),
        getCategorySales: vi.fn().mockRejectedValue(down),
        getReportPrinters: vi.fn().mockRejectedValue(down),
      }),
      { liveData: new LiveData() },
    );
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    const root = el.shadowRoot!;
    await vi.waitFor(() =>
      expect(root.querySelector("[data-test=error]")?.textContent?.trim()).toBe(
        codeMessage("connection.failed"),
      ),
    );
    expect(root.querySelector("[data-test=categories-error]")).not.toBeNull();
    expect(root.querySelector("[data-test=printers-error]")).not.toBeNull();

    vi.mocked(api.getSalesOverview).mockResolvedValue(overview(today()));
    vi.mocked(api.getDailyClose).mockResolvedValue(close);
    vi.mocked(api.getCategorySales).mockResolvedValue({
      mode: "at_time_of_sale",
      tree: [],
      gross: "0.00",
      net: "0.00",
      grossComplete: true,
      linesWithoutGross: 0,
    });
    vi.mocked(api.getReportPrinters).mockResolvedValue([]);
    api.liveData.refresh();

    await vi.waitFor(() => expect(root.querySelector("[data-test=error]")).toBeNull());
    expect(root.querySelector("[data-test=tender-table]")).not.toBeNull();
    expect(root.querySelector("[data-test=categories-error]")).toBeNull();
    expect(root.querySelector("[data-test=printers-error]")).toBeNull();
  });

  it("opens on Overview's business day once the server answers again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T01:00:00Z"));
    const api = Object.assign(
      stubApi({
        getSalesOverview: vi.fn().mockRejectedValue(down),
        getDailyClose: vi.fn().mockRejectedValue(down),
      }),
      { liveData: new LiveData() },
    );
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=error]")).not.toBeNull(),
    );

    vi.mocked(api.getSalesOverview).mockResolvedValue(overview("2026-09-26"));
    vi.mocked(api.getDailyClose).mockResolvedValue(close);
    api.liveData.refresh();

    await vi.waitFor(() => expect(api.getDailyClose).toHaveBeenLastCalledWith("2026-09-26"));
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=error]")).toBeNull());
    expect(el.shadowRoot!.querySelector("[data-test=tender-table]")).not.toBeNull();
  });

  it("moves to Overview's business day once the server answers again when only Overview failed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T01:00:00Z"));
    const api = Object.assign(stubApi({ getSalesOverview: vi.fn().mockRejectedValue(down) }), {
      liveData: new LiveData(),
    });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    const root = el.shadowRoot!;
    await vi.waitFor(() =>
      expect(root.querySelector("[data-test=error]")?.textContent?.trim()).toBe(
        codeMessage("connection.failed"),
      ),
    );
    expect(api.getDailyClose).toHaveBeenLastCalledWith("2026-09-27");

    vi.mocked(api.getSalesOverview).mockResolvedValue(overview("2026-09-26"));
    api.liveData.refresh();

    await vi.waitFor(() => expect(api.getDailyClose).toHaveBeenLastCalledWith("2026-09-26"));
    expect(api.getCategorySales).toHaveBeenLastCalledWith(
      "2026-09-26",
      "2026-09-26",
      "at_time_of_sale",
      false,
    );
    expect(root.querySelector<WtInput>("[data-test=from-picker]")!.value).toBe("2026-09-26");
    await vi.waitFor(() => expect(root.querySelector("[data-test=error]")).toBeNull());
    expect(root.querySelector("[data-test=tender-table]")).not.toBeNull();
  });

  it("clears Overview's message once it answers again with the day already shown", async () => {
    const api = Object.assign(stubApi({ getSalesOverview: vi.fn().mockRejectedValue(down) }), {
      liveData: new LiveData(),
    });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    const root = el.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector("[data-test=error]")).not.toBeNull());

    vi.mocked(api.getSalesOverview).mockResolvedValue(overview(today()));
    api.liveData.refresh();

    await vi.waitFor(() => expect(root.querySelector("[data-test=error]")).toBeNull());
    expect(api.getDailyClose).toHaveBeenLastCalledWith(today());
    expect(root.querySelector("[data-test=tender-table]")).not.toBeNull();
  });

  it("stops reading Overview once it has answered after a failure", async () => {
    const api = Object.assign(stubApi({ getSalesOverview: vi.fn().mockRejectedValue(down) }), {
      liveData: new LiveData(),
    });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=error]")).not.toBeNull(),
    );
    vi.mocked(api.getSalesOverview).mockResolvedValue(overview(today()));
    api.liveData.refresh();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=error]")).toBeNull());
    const reads = vi.mocked(api.getSalesOverview).mock.calls.length;

    api.liveData.refresh();
    await flush(el);

    expect(api.getSalesOverview).toHaveBeenCalledTimes(reads);
  });
});

describe("dashboard-sales-screen date fields", () => {
  it("picks the range from two labelled date fields, and ignores one until its date is complete", async () => {
    const api = stubApi();
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    type Field = HTMLElement & { type: string; name: string; label: string; value: string };
    const from = el.shadowRoot!.querySelector("wt-input[data-test=from-picker]") as Field | null;
    const to = el.shadowRoot!.querySelector("wt-input[data-test=to-picker]") as Field | null;
    expect([from!.type, from!.name, from!.label, from!.value]).toEqual([
      "date",
      "from",
      t("sales.from"),
      today(),
    ]);
    expect([to!.type, to!.name, to!.label, to!.value]).toEqual([
      "date",
      "to",
      t("sales.to"),
      today(),
    ]);
    const send = (field: Field, value: string) =>
      field.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
    send(to!, "");
    await flush(el);
    expect(api.getSalesPeriod).not.toHaveBeenCalled();
    send(to!, "2030-06-15");
    await flush(el);
    expect(api.getSalesPeriod).toHaveBeenLastCalledWith(today(), "2030-06-15");
    send(from!, "2030-06-01");
    await flush(el);
    expect(api.getSalesPeriod).toHaveBeenLastCalledWith("2030-06-01", "2030-06-15");
  });
});

describe("dashboard-sales-screen deferred-payments file", () => {
  const FILE = new Blob(["﻿header\r\n"]);
  const exportButton = (el: SalesScreen) =>
    el.shadowRoot!.querySelector<WtButton>("[data-test=export-deferred]");
  const exportError = (el: SalesScreen) =>
    el.shadowRoot!.querySelector("[data-test=export-error]")?.textContent?.trim() ?? null;
  const fieldValue = (el: SalesScreen, test: string) =>
    el.shadowRoot!.querySelector<WtInput>(`[data-test=${test}]`)!.value;
  async function mount(api: DashboardApi, canExport: boolean): Promise<SalesScreen> {
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api, canExport });
    await flush(el);
    return el;
  }
  function catchDownloads(): { clicked: HTMLAnchorElement[] } {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    return { clicked };
  }
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers no deferred-payments file to a session that may not export reports", async () => {
    const el = await mount(stubApi({ downloadDeferredPayments: vi.fn() }), false);
    expect(exportButton(el)).toBeNull();
  });

  it("calls the action Export deferred payments in English", async () => {
    setLocale("en-GB");
    const english = await mount(stubApi(), true);
    expect(exportButton(english)!.textContent!.trim()).toBe("Export deferred payments (CSV)");
  });

  it("downloads the range the fields show, named for that range", async () => {
    const downloadDeferredPayments = vi.fn().mockResolvedValue(FILE);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:deferred");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const { clicked } = catchDownloads();
    const el = await mount(stubApi({ downloadDeferredPayments }), true);
    setDate(el, "from-picker", "2030-06-01");
    setDate(el, "to-picker", "2030-06-15");
    await flush(el);

    expect(exportButton(el)!.textContent!.trim()).toBe(t("sales.export_deferred"));
    exportButton(el)!.click();
    await flush(el);

    expect(downloadDeferredPayments).toHaveBeenCalledWith({ from: "2030-06-01", to: "2030-06-15" });
    expect(createObjectURL).toHaveBeenCalledWith(FILE);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]!.download).toBe("deferred-payments-2030-06-01-2030-06-15.csv");
    expect(clicked[0]!.href).toBe("blob:deferred");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:deferred");
    expect(exportError(el)).toBeNull();
  });

  it("names the file for the range it asked for, even when the fields change before the answer", async () => {
    let answer!: (file: Blob) => void;
    const downloadDeferredPayments = vi.fn(() => new Promise<Blob>((r) => (answer = r)));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:deferred");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const { clicked } = catchDownloads();
    const el = await mount(stubApi({ downloadDeferredPayments }), true);
    setDate(el, "from-picker", "2030-06-01");
    setDate(el, "to-picker", "2030-06-15");
    await flush(el);
    exportButton(el)!.click();
    await flush(el);

    setDate(el, "to-picker", "2030-06-20");
    answer(FILE);
    await flush(el);

    expect(clicked).toHaveLength(1);
    expect(clicked[0]!.download).toBe("deferred-payments-2030-06-01-2030-06-15.csv");
  });

  it("shows the action busy while the file is asked for, and sends one request however often it is pressed", async () => {
    const downloadDeferredPayments = vi.fn(() => new Promise<Blob>(() => {}));
    const el = await mount(stubApi({ downloadDeferredPayments }), true);

    exportButton(el)!.click();
    await flush(el);
    exportButton(el)!.click();
    await flush(el);

    expect(exportButton(el)!.loading).toBe(true);
    expect(downloadDeferredPayments).toHaveBeenCalledOnce();
  });

  it("shows a refusal under the action, keeps both dates, and asks again when pressed again", async () => {
    const downloadDeferredPayments = vi
      .fn()
      .mockRejectedValue({ code: "authorization.not_permitted" });
    const el = await mount(stubApi({ downloadDeferredPayments }), true);
    setDate(el, "from-picker", "2030-06-01");
    setDate(el, "to-picker", "2030-06-15");
    await flush(el);

    exportButton(el)!.click();
    await flush(el);

    expect(exportError(el)).toBe(codeMessage("authorization.not_permitted"));
    expect(fieldValue(el, "from-picker")).toBe("2030-06-01");
    expect(fieldValue(el, "to-picker")).toBe("2030-06-15");
    expect(exportButton(el)!.loading).toBe(false);
    expect(exportButton(el)!.disabled).toBe(false);

    exportButton(el)!.click();
    await flush(el);

    expect(downloadDeferredPayments).toHaveBeenCalledTimes(2);
    expect(downloadDeferredPayments).toHaveBeenLastCalledWith({
      from: "2030-06-01",
      to: "2030-06-15",
    });
  });

  it("is disabled while a date field is cleared, and downloads what the fields show once it holds a date again", async () => {
    const downloadDeferredPayments = vi.fn().mockResolvedValue(FILE);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:deferred");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    catchDownloads();
    const el = await mount(stubApi({ downloadDeferredPayments }), true);
    setDate(el, "from-picker", "2030-06-01");
    setDate(el, "to-picker", "2030-06-15");
    await flush(el);
    const nativeTo = el
      .shadowRoot!.querySelector<WtInput>("[data-test=to-picker]")!
      .shadowRoot!.querySelector<HTMLInputElement>("input[type=date]")!;

    await userEvent.clear(nativeTo);
    await flush(el);

    expect(fieldValue(el, "to-picker")).toBe("");
    expect(exportButton(el)!.disabled).toBe(true);
    exportButton(el)!.click();
    await flush(el);
    expect(downloadDeferredPayments).not.toHaveBeenCalled();

    await userEvent.fill(nativeTo, "2030-06-20");
    await flush(el);

    expect(exportButton(el)!.disabled).toBe(false);
    exportButton(el)!.click();
    await flush(el);
    expect(downloadDeferredPayments).toHaveBeenCalledExactlyOnceWith({
      from: "2030-06-01",
      to: "2030-06-20",
    });
  });

  it("is enabled again when the business day fills a field cleared before it arrived", async () => {
    let answer!: (value: SalesOverview) => void;
    const getSalesOverview = vi.fn(() => new Promise<SalesOverview>((r) => (answer = r)));
    const downloadDeferredPayments = vi.fn(() => new Promise<Blob>(() => {}));
    const el = await mount(stubApi({ getSalesOverview, downloadDeferredPayments }), true);
    setDate(el, "to-picker", "");
    await flush(el);
    expect(exportButton(el)!.disabled).toBe(true);

    answer(overview("2030-06-15"));
    await flush(el);

    expect(fieldValue(el, "to-picker")).toBe("2030-06-15");
    expect(exportButton(el)!.disabled).toBe(false);
    exportButton(el)!.click();
    await flush(el);
    expect(downloadDeferredPayments).toHaveBeenCalledWith({ from: "2030-06-15", to: "2030-06-15" });
  });

  it("takes a refusal away once the dates change", async () => {
    const downloadDeferredPayments = vi
      .fn()
      .mockRejectedValue({ code: "authorization.not_permitted" });
    const el = await mount(stubApi({ downloadDeferredPayments }), true);
    exportButton(el)!.click();
    await flush(el);
    expect(exportError(el)).toBe(codeMessage("authorization.not_permitted"));

    setDate(el, "to-picker", "2030-06-15");
    await flush(el);

    expect(exportError(el)).toBeNull();
  });

  it("shows no refusal for a range the fields no longer hold", async () => {
    let refuse!: (reason: unknown) => void;
    const downloadDeferredPayments = vi.fn(() => new Promise<Blob>((_, r) => (refuse = r)));
    const el = await mount(stubApi({ downloadDeferredPayments }), true);
    exportButton(el)!.click();
    await flush(el);

    setDate(el, "to-picker", "2030-06-15");
    refuse({ code: "authorization.not_permitted" });
    await flush(el);

    expect(exportError(el)).toBeNull();
    expect(exportButton(el)!.loading).toBe(false);
  });

  it("takes a refusal away once the business day replaces both dates", async () => {
    let answer!: (value: SalesOverview) => void;
    const getSalesOverview = vi.fn(() => new Promise<SalesOverview>((r) => (answer = r)));
    const downloadDeferredPayments = vi
      .fn()
      .mockRejectedValue({ code: "authorization.not_permitted" });
    const el = await mount(stubApi({ getSalesOverview, downloadDeferredPayments }), true);
    exportButton(el)!.click();
    await flush(el);
    expect(exportError(el)).toBe(codeMessage("authorization.not_permitted"));

    answer(overview("2030-06-15"));
    await flush(el);

    expect(fieldValue(el, "from-picker")).toBe("2030-06-15");
    expect(fieldValue(el, "to-picker")).toBe("2030-06-15");
    expect(exportError(el)).toBeNull();
  });

  it("is disabled while the range runs backwards", async () => {
    const downloadDeferredPayments = vi.fn().mockResolvedValue(FILE);
    const el = await mount(stubApi({ downloadDeferredPayments }), true);
    expect(exportButton(el)!.disabled).toBe(false);

    setDate(el, "from-picker", "2030-06-15");
    setDate(el, "to-picker", "2030-06-01");
    await flush(el);

    expect(exportButton(el)!.disabled).toBe(true);
  });
});

describe("dashboard-sales-screen accountant workbook", () => {
  const button = (el: SalesScreen) =>
    el.shadowRoot!.querySelector<WtButton>("[data-test=export-accountant]");
  const error = (el: SalesScreen) =>
    el.shadowRoot!.querySelector("[data-test=accountant-error]")?.textContent?.trim() ?? null;
  afterEach(() => vi.restoreAllMocks());

  it("drops a refusal arriving after the dates change", async () => {
    let refuse!: (reason: unknown) => void;
    const downloadAccountantExport = vi.fn(
      () => new Promise<Blob>((_, reject) => (refuse = reject)),
    );
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", {
      api: stubApi({ downloadAccountantExport }),
      canExport: true,
    });
    await flush(el);
    button(el)!.click();
    await flush(el);
    setDate(el, "to-picker", "2030-06-20");
    refuse({ code: "authorization.not_permitted" });
    await flush(el);
    expect(error(el)).toBeNull();
    expect(button(el)!.loading).toBe(false);
  });

  it("offers no accountant download without report export permission", async () => {
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api: stubApi() });
    await flush(el);
    expect(button(el)).toBeNull();
  });

  it("downloads the selected calendar range even if the dates change while it is being prepared", async () => {
    let answer!: (file: Blob) => void;
    const downloadAccountantExport = vi.fn(() => new Promise<Blob>((r) => (answer = r)));
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:accountant");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", {
      api: stubApi({ downloadAccountantExport }),
      canExport: true,
    });
    await flush(el);
    setDate(el, "from-picker", "2030-06-01");
    setDate(el, "to-picker", "2030-06-15");
    await flush(el);
    expect(button(el)).not.toBeNull();
    button(el)!.click();
    await flush(el);
    expect(button(el)!.loading).toBe(true);
    button(el)!.click();
    expect(downloadAccountantExport).toHaveBeenCalledExactlyOnceWith({
      from: "2030-06-01",
      to: "2030-06-15",
    });
    setDate(el, "to-picker", "2030-06-20");
    const file = new Blob(["workbook"]);
    answer(file);
    await flush(el);
    expect(create).toHaveBeenCalledWith(file);
    expect(clicked.map((link) => [link.download, link.href])).toEqual([
      ["accountant-2030-06-01-2030-06-15.xlsx", "blob:accountant"],
    ]);
    expect(revoke).toHaveBeenCalledWith("blob:accountant");
    expect(button(el)!.loading).toBe(false);
  });

  it("blocks missing and backwards dates, then retries a refusal without a report refresh erasing it", async () => {
    let refuseRetry!: (reason: unknown) => void;
    const downloadAccountantExport = vi
      .fn()
      .mockRejectedValueOnce({ code: "authorization.not_permitted" })
      .mockImplementationOnce(() => new Promise<Blob>((_, reject) => (refuseRetry = reject)));
    const liveData = new LiveData();
    const api = stubApi({ downloadAccountantExport, liveData } as Partial<DashboardApi>);
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", {
      api,
      canExport: true,
    });
    await flush(el);
    expect(button(el)).not.toBeNull();
    setDate(el, "to-picker", "");
    await flush(el);
    expect(button(el)!.disabled).toBe(true);
    button(el)!.click();
    expect(downloadAccountantExport).not.toHaveBeenCalled();
    setDate(el, "from-picker", "2030-06-15");
    setDate(el, "to-picker", "2030-06-01");
    await flush(el);
    expect(button(el)!.disabled).toBe(true);
    setDate(el, "to-picker", "2030-06-20");
    await flush(el);
    button(el)!.click();
    await flush(el);
    expect(error(el)).toBe(codeMessage("authorization.not_permitted"));
    const reads = vi.mocked(api.getSalesPeriod).mock.calls.length;
    liveData.refresh();
    await vi.waitFor(() => expect(api.getSalesPeriod).toHaveBeenCalledTimes(reads + 1));
    await flush(el);
    expect(error(el)).toBe(codeMessage("authorization.not_permitted"));
    expect(el.shadowRoot!.querySelector("[data-test=error]")).toBeNull();
    expect(button(el)!.disabled).toBe(false);
    button(el)!.click();
    await flush(el);
    expect(downloadAccountantExport).toHaveBeenCalledTimes(2);
    expect(downloadAccountantExport).toHaveBeenLastCalledWith({
      from: "2030-06-15",
      to: "2030-06-20",
    });
    expect(error(el)).toBeNull();
    expect(button(el)!.loading).toBe(true);
    refuseRetry({ code: "authorization.not_permitted" });
    await flush(el);
    expect(error(el)).toBe(codeMessage("authorization.not_permitted"));
    setDate(el, "to-picker", "2030-06-21");
    await flush(el);
    expect(error(el)).toBeNull();
  });
});

it("places handover status before the sales and cash-up reports without loading full inventory", async () => {
  const fullRead = vi.fn().mockRejectedValue(new Error("A report must not load inventory receipt"));
  const api = Object.assign(stubApi(), {
    getHandoverWarning: async () => ({ hasEmergencyHandover: true }),
    listHandoverIntervals: fullRead,
  });
  const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
  const notice = el.shadowRoot!.querySelector<HTMLElement & { api: DashboardApi }>(
    "dashboard-handover-report-warning",
  );
  expect(notice).not.toBeNull();
  expect(notice!.api).toBe(api);
  await vi.waitFor(() => expect(notice!.shadowRoot!.querySelector("a")).not.toBeNull());
  expect(fullRead).not.toHaveBeenCalled();
});
