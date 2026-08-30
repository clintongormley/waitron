import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DailyCloseDto, DashboardApi, SalesPeriodDto } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { today } from "../date-utils.js";
import { SalesScreen } from "./dashboard-sales-screen.js";

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
  // Short language-subtag keys — the real `descriptions` shape (schema `invoiceLocales: ["es","ca"]`).
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
  // Second row has no "es" key: exercises localizedName's fallback-to-first-value arm.
  topSellers: [
    { descriptions: { es: "Croqueta", en: "Croquette" }, quantity: "40", total: "80.00" },
    { descriptions: { en: "Tortilla" }, quantity: "12", total: "36.00" },
  ],
};

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getDailyClose: vi.fn().mockResolvedValue(close),
    getSalesPeriod: vi.fn().mockResolvedValue(period),
    ...overrides,
  } as unknown as DashboardApi;
}
async function flush(el: SalesScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
function setDate(el: SalesScreen, test: string, value: string): void {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(`[data-test=${test}]`)!;
  input.value = value;
  input.dispatchEvent(new Event("change"));
}
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES"); // restore the shipped default (a test switches it)
});

describe("dashboard-sales-screen", () => {
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
    expect(cashRow.textContent).toContain("80.00");
    expect(cashRow.textContent).toContain("5.00");
    expect(root.querySelector("[data-test=tender-total]")!.textContent).toContain("176.00");
    expect(root.querySelector("[data-test=tip-total]")!.textContent).toContain("8.00");

    // VAT-by-rate table with per-rate rows and the base/tax/gross totals.
    expect(root.querySelector("[data-test=vat-table]")).not.toBeNull();
    expect(root.querySelector('[data-test="vat-row-21.00"]')!.textContent).toContain("21.00");
    expect(root.querySelector("[data-test=vat-base-total]")!.textContent).toContain("150.00");
    expect(root.querySelector("[data-test=vat-tax-total]")!.textContent).toContain("26.00");
    expect(root.querySelector("[data-test=vat-gross-total]")!.textContent).toContain("176.00");

    // Record counts.
    expect(root.querySelector("[data-test=count-sales]")!.textContent).toContain("10");
    expect(root.querySelector("[data-test=count-corrections]")!.textContent).toContain("1");
    expect(root.querySelector("[data-test=count-voids]")!.textContent).toContain("2");

    // Top sellers, rendered through the shared table widget (stable `top-sellers-table` hook), name
    // via the active locale (es).
    expect(root.querySelector("[data-test=top-sellers-table]")).not.toBeNull();
    expect(root.querySelector("[data-test=seller-name]")!.textContent).toContain("Café");

    // No per-day note in single-day mode.
    expect(root.querySelector("[data-test=period-note]")).toBeNull();
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
    expect(root.querySelector("[data-test=vat-gross-total]")!.textContent).toContain("1210.00");
    expect(root.querySelector("[data-test=period-note]")).not.toBeNull();
    expect(root.querySelector("[data-test=tender-table]")).toBeNull();
    expect(root.querySelector("[data-test=top-sellers-table]")).not.toBeNull();
    const names = [...root.querySelectorAll("[data-test=seller-name]")].map((n) =>
      n.textContent?.trim(),
    );
    expect(names).toEqual(["Croqueta", "Tortilla"]); // es hit, then first-value fallback
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

  // The next three tests mock rejections with `{ code: "report.forbidden" }` / `{ code: "report.range" }`.
  // Those are NOT real server codes — the server answers `management.request_invalid` for a bad param
  // (including `from > to`) and an authorization code (`authorization.not_permitted` and friends) for
  // an unauthorized request (see report-api.ts's STATUS map). The mocked strings are arbitrary
  // stand-ins for "any error code the server returns": the screen renders whatever `codeOf`/`codeMessage`
  // give it without inspecting the code's meaning, so what these tests actually pin down is that ANY
  // rejection reaches the `errorKey` banner and clears stale state — not which code triggers it.

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
