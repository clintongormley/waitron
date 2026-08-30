import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, SalesOverview } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { OverviewScreen } from "./dashboard-overview-screen.js";

const overview: SalesOverview = {
  businessDay: "2026-08-29",
  takings: { tenderTotal: "1234.50", tipTotal: "45.00", grossTotal: "1279.50" },
  counts: { sales: 42, corrections: 2, voids: 1 },
  openTables: { open: 3, total: 12 },
  topSellers: [
    // Short language-subtag keys — the real `descriptions` shape (schema `invoiceLocales: ["es","ca"]`).
    { descriptions: { es: "Café con leche", en: "Latte" }, quantity: "18", total: "36.00" },
    // Second row has no "es" key: exercises localizedName's fallback-to-first-value arm.
    { descriptions: { en: "Croissant" }, quantity: "12", total: "24.00" },
  ],
};

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getSalesOverview: vi.fn().mockResolvedValue(overview),
    ...overrides,
  } as unknown as DashboardApi;
}
async function flush(el: OverviewScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES"); // restore the shipped default (a test switches it)
});

describe("dashboard-overview-screen", () => {
  it("loads today's overview on connect and renders the takings totals", async () => {
    const api = stubApi();
    const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
    await flush(el);
    expect(api.getSalesOverview).toHaveBeenCalledTimes(1);
    const root = el.shadowRoot!;
    expect(root.querySelector("[data-test=gross-total]")!.textContent).toContain("1279.50");
    expect(root.querySelector("[data-test=tender-total]")!.textContent).toContain("1234.50");
    expect(root.querySelector("[data-test=tip-total]")!.textContent).toContain("45.00");
  });

  it("renders the record counts", async () => {
    const api = stubApi();
    const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
    await flush(el);
    const root = el.shadowRoot!;
    expect(root.querySelector("[data-test=count-sales]")!.textContent).toContain("42");
    expect(root.querySelector("[data-test=count-corrections]")!.textContent).toContain("2");
    expect(root.querySelector("[data-test=count-voids]")!.textContent).toContain("1");
  });

  it("renders open-of-total tables", async () => {
    const api = stubApi();
    const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
    await flush(el);
    const text = el.shadowRoot!.querySelector("[data-test=open-tables]")!.textContent ?? "";
    expect(text).toContain("3");
    expect(text).toContain("12");
  });

  it("resolves each top-seller name via the current locale, falling back to the first value", async () => {
    const api = stubApi();
    const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
    await flush(el);
    // The shared table (stable `top-sellers-table` hook) sits inside the overview's `top-sellers` card.
    const card = el.shadowRoot!.querySelector("[data-test=top-sellers]")!;
    expect(card).not.toBeNull();
    expect(card.querySelector("[data-test=top-sellers-table]")).not.toBeNull();
    const names = [...el.shadowRoot!.querySelectorAll("[data-test=seller-name]")].map((n) =>
      n.textContent?.trim(),
    );
    expect(names).toEqual(["Café con leche", "Croissant"]); // es-ES hit, then first-value fallback
  });

  it("shows the empty prompt when there are no top sellers", async () => {
    const api = stubApi({
      getSalesOverview: vi.fn().mockResolvedValue({ ...overview, topSellers: [] }),
    });
    const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=empty]")).not.toBeNull();
  });

  it("shows the error banner when the load rejects", async () => {
    const api = stubApi({
      getSalesOverview: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=error]")).not.toBeNull();
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  it("falls back to server.internal when a thrown error carries no code", async () => {
    const api = stubApi({ getSalesOverview: vi.fn().mockRejectedValue(new Error("network down")) });
    const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });
});
