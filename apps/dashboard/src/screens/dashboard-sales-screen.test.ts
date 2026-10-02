import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DailyCloseDto, DashboardApi, SalesOverview, SalesPeriodDto } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { today } from "../date-utils.js";
import { SalesScreen } from "./dashboard-sales-screen.js";
import type { WtInput } from "@waitron/ui";

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
    byTill: [
      {
        tillId: "till-1",
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
  counts: { sales: 10, corrections: 1, voids: 2 },
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
    { name: "Croqueta", quantity: "40", total: "80.00", variants: [] },
    { name: "Tortilla", quantity: "12", total: "36.00", variants: [] },
  ],
};

function overview(businessDay: string): SalesOverview {
  return {
    businessDay,
    takings: { tenderTotal: "0.00", tipTotal: "0.00", grossTotal: "0.00" },
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

  it("renders the per-till tender table, VAT-by-rate table, counts and top sellers on a single day", async () => {
    const api = stubApi();
    const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
    await flush(el);
    const root = el.shadowRoot!;

    // Tender table: a per-till row per method, with the tender + tip totals.
    expect(root.querySelector("[data-test=tender-table]")).not.toBeNull();
    const cashRow = root.querySelector("[data-test=tender-row-till-1-cash]")!;
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
    expect(root.querySelector("[data-test=seller-name]")!.textContent).toContain("Café");
    // Its variants follow as their own rows, each under its own name and figures.
    const variant0 = root.querySelector('[data-test="seller-row-0-variant-0"]')!;
    expect(variant0.querySelector("[data-test=variant-name]")!.textContent).toBe("Café doble");
    expect(variant0.textContent).toContain("7,50\u00a0€");
    const variant1 = root.querySelector('[data-test="seller-row-0-variant-1"]')!;
    expect(variant1.querySelector("[data-test=variant-name]")!.textContent).toBe("Café solo");
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
    expect(cells("[data-test=tender-row-till-1-cash]")).toEqual([
      "till-1",
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
    expect(cells('[data-test="seller-row-0-variant-0"]')).toEqual([
      "Café, Café doble",
      "3",
      "€7.50",
    ]);
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
    expect(names).toEqual(["Croqueta", "Tortilla"]); // each row's plain staff name, in server order
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
