import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, OverdueOrder, SalesOverview } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { OverviewScreen } from "./dashboard-overview-screen.js";

const overview: SalesOverview = {
  businessDay: "2026-08-29",
  takings: { tenderTotal: "1234.50", tipTotal: "45.00", grossTotal: "1279.50" },
  counts: { sales: 42, corrections: 2, voids: 1 },
  openTables: { open: 3, total: 12 },
  topSellers: [
    // FULL invoice-locale-tag keys — the shape the `/reports/overview` sale-line snapshot produces
    // (its seed writes `{ "es-ES": … }`); localizedName resolves it via the full-tag arm.
    {
      descriptions: { "es-ES": "Café con leche", "en-GB": "Latte" },
      quantity: "18",
      total: "36.00",
    },
    // Second row carries neither "es-ES" nor "es": exercises localizedName's fallback-to-first-value arm.
    { descriptions: { en: "Croissant" }, quantity: "12", total: "24.00" },
  ],
};

// Two currently-open orders past their station's overdue threshold, WORST-FIRST — the shape
// `computeOverdueOrders` (Task 6) returns from `/reports/overdue-orders`. The screen must not
// re-sort these; it renders whatever order the server sends.
const overdueOrders: OverdueOrder[] = [
  {
    orderId: "o-1",
    orderNumber: 101,
    tableLabel: "T4",
    stationName: "Grill",
    ageMinutes: 22,
    band: "forgotten",
  },
  {
    orderId: "o-2",
    orderNumber: 102,
    tableLabel: null,
    stationName: "Bar",
    ageMinutes: 11,
    band: "overdue",
  },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getSalesOverview: vi.fn().mockResolvedValue(overview),
    getOverdueOrders: vi.fn().mockResolvedValue({ orders: [] }),
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
    expect((el as unknown as { overviewErrorKey: string | null }).overviewErrorKey).toBe(
      "server.internal",
    );
  });

  it("falls back to server.internal when a thrown error carries no code", async () => {
    const api = stubApi({ getSalesOverview: vi.fn().mockRejectedValue(new Error("network down")) });
    const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
    await flush(el);
    expect((el as unknown as { overviewErrorKey: string | null }).overviewErrorKey).toBe(
      "server.internal",
    );
  });
});

describe("dashboard-overview-screen — overdue orders (KDS order-timing alerts, design §7.4)", () => {
  it("fetches overdue orders on load and renders the count tile + a worst-first list", async () => {
    setLocale("en"); // asserts the literal English copy; afterEach restores es-ES
    const api = stubApi({ getOverdueOrders: vi.fn().mockResolvedValue({ orders: overdueOrders }) });
    const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
    await flush(el);
    expect(api.getOverdueOrders).toHaveBeenCalledTimes(1);

    const root = el.shadowRoot!;
    expect(root.querySelector("[data-test=overdue-count]")!.textContent).toContain(
      "2 orders overdue",
    );
    expect(root.querySelector("[data-test=overdue-empty]")).toBeNull();

    const rows = [...root.querySelectorAll("[data-test^=overdue-row-]")];
    expect(rows).toHaveLength(2);
    // Worst-first, preserved AS THE SERVER SENT IT — row 0 is the "forgotten" order (o-1), even
    // though it has a lower orderNumber than row 1; the screen must not re-sort by age or number.
    expect(rows[0]!.textContent).toContain("T4");
    expect(rows[0]!.textContent).toContain("Grill");
    expect(rows[0]!.textContent).toContain("22");
    expect(rows[0]!.querySelector("[data-test=overdue-band]")!.textContent).toContain("Forgotten");
    // A bare walk-up (no table) renders the em-dash placeholder the roster screen's email column
    // already uses (staff-list.ts), not a hardcoded string.
    expect(rows[1]!.textContent).toContain("—");
    expect(rows[1]!.textContent).toContain("Bar");
    expect(rows[1]!.textContent).toContain("11");
    expect(rows[1]!.querySelector("[data-test=overdue-band]")!.textContent).toContain("Overdue");
  });

  it("shows a calm zero-state when there are no overdue orders", async () => {
    const api = stubApi({ getOverdueOrders: vi.fn().mockResolvedValue({ orders: [] }) });
    const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
    await flush(el);
    const root = el.shadowRoot!;
    expect(root.querySelector("[data-test=overdue-empty]")).not.toBeNull();
    expect(root.querySelector("[data-test=overdue-count]")).toBeNull();
    expect(root.querySelector("[data-test=overdue-table]")).toBeNull();
  });

  it("polls getOverdueOrders every ~30s while connected and stops after disconnect — the sales overview is NOT re-fetched on the tick", async () => {
    vi.useFakeTimers();
    try {
      const getOverdueOrders = vi.fn().mockResolvedValue({ orders: [] });
      const api = stubApi({ getOverdueOrders });
      const { host } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
      // The initial connect-time load calls it once, synchronously with connectedCallback.
      expect(getOverdueOrders).toHaveBeenCalledTimes(1);
      expect(api.getSalesOverview).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(getOverdueOrders).toHaveBeenCalledTimes(2);
      // Pins "only the overdue list refetches on tick" (design §7.4) — the sales-overview call count
      // must stay FLAT across ticks, not grow alongside getOverdueOrders'.
      expect(api.getSalesOverview).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(getOverdueOrders).toHaveBeenCalledTimes(3);
      expect(api.getSalesOverview).toHaveBeenCalledTimes(1);

      host.remove(); // disconnects the element — must clear the interval
      const callsAtDisconnect = getOverdueOrders.mock.calls.length;

      await vi.advanceTimersByTimeAsync(120_000); // several more intervals' worth
      expect(getOverdueOrders).toHaveBeenCalledTimes(callsAtDisconnect);
      expect(api.getSalesOverview).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("single-flights the polled refetch — a tick during a still-pending request does not call getOverdueOrders again until it resolves", async () => {
    vi.useFakeTimers();
    try {
      // The initial connect-time load resolves normally; the FIRST poll tick then hangs until the
      // deferred is resolved by hand, so a second tick can fire while it is still in flight.
      let resolveSecondCall: ((v: { orders: OverdueOrder[] }) => void) | undefined;
      const getOverdueOrders = vi
        .fn()
        .mockResolvedValueOnce({ orders: [] }) // initial connect-time load
        .mockImplementationOnce(
          () =>
            new Promise<{ orders: OverdueOrder[] }>((resolve) => {
              resolveSecondCall = resolve;
            }),
        )
        .mockResolvedValue({ orders: [] });
      const api = stubApi({ getOverdueOrders });
      await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
      expect(getOverdueOrders).toHaveBeenCalledTimes(1); // the initial load

      await vi.advanceTimersByTimeAsync(30_000); // first tick: starts the still-pending request
      expect(getOverdueOrders).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(30_000); // second tick fires while the first is still in flight
      expect(getOverdueOrders).toHaveBeenCalledTimes(2); // must NOT have started a third call

      resolveSecondCall!({ orders: [] }); // let the in-flight request resolve
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(30_000); // now a further tick is free to fetch again
      expect(getOverdueOrders).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("(b) sets the OVERDUE note when a polled refetch rejects, then CLEARS it once a later tick recovers — the overview is unaffected throughout", async () => {
    vi.useFakeTimers();
    try {
      const getOverdueOrders = vi
        .fn()
        .mockResolvedValueOnce({ orders: [] }) // the initial connect-time load succeeds
        .mockRejectedValueOnce({ code: "server.internal" }) // the first poll tick fails
        .mockResolvedValue({ orders: [] }); // every poll tick after that recovers
      const api = stubApi({ getOverdueOrders });
      const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
      const root = el.shadowRoot!;
      const state = () =>
        el as unknown as { overviewErrorKey: string | null; overdueErrorKey: string | null };
      expect(state().overdueErrorKey).toBeNull();
      expect(state().overviewErrorKey).toBeNull();

      await vi.advanceTimersByTimeAsync(30_000); // first tick: fails
      expect(state().overdueErrorKey).toBe("server.internal");
      expect(root.querySelector("[data-test=overdue-error]")).not.toBeNull();
      // Fix round 2's whole point: an OVERDUE failure never touches the overview's OWN field, and
      // never shows the top banner (that banner is reserved for `overviewErrorKey`).
      expect(state().overviewErrorKey).toBeNull();
      expect(root.querySelector("[data-test=error]")).toBeNull();

      await vi.advanceTimersByTimeAsync(30_000); // second tick: recovers
      expect(state().overdueErrorKey).toBeNull();
      expect(root.querySelector("[data-test=overdue-error]")).toBeNull();
      expect(state().overviewErrorKey).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("(a) an overview error is NOT cleared by a later overdue poll tick that succeeds", async () => {
    vi.useFakeTimers();
    try {
      const api = stubApi({
        getSalesOverview: vi.fn().mockRejectedValue({ code: "server.internal" }),
        getOverdueOrders: vi.fn().mockResolvedValue({ orders: overdueOrders }),
      });
      const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
      const root = el.shadowRoot!;
      const state = () =>
        el as unknown as { overviewErrorKey: string | null; overdueErrorKey: string | null };
      expect(state().overviewErrorKey).toBe("server.internal");
      expect(root.querySelector("[data-test=error]")).not.toBeNull();

      await vi.advanceTimersByTimeAsync(30_000); // an overdue poll tick — succeeds
      expect(state().overdueErrorKey).toBeNull(); // the tick itself succeeded
      // The overview's error is UNCHANGED by that unrelated success — this is the exact regression
      // fix round 2 closes: a single shared `errorKey` would have been cleared here.
      expect(state().overviewErrorKey).toBe("server.internal");
      expect(root.querySelector("[data-test=error]")).not.toBeNull();
      expect(root.querySelectorAll("[data-test^=overdue-row-]")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("(b-init) a failing overdue-orders fetch on initial load leaves the sales-overview tiles rendered, with its OWN inline note", async () => {
    const api = stubApi({
      getOverdueOrders: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
    await flush(el);
    const root = el.shadowRoot!;
    // The stable sales-overview cards render normally — a less-proven new endpoint's failure must
    // not blank them, and must not raise the TOP banner (that's reserved for the overview's own
    // failures).
    expect(root.querySelector("[data-test=gross-total]")!.textContent).toContain("1279.50");
    expect(root.querySelector("[data-test=count-sales]")!.textContent).toContain("42");
    expect(root.querySelector("[data-test=top-sellers]")).not.toBeNull();
    expect(root.querySelector("[data-test=error]")).toBeNull();
    // The overdue tile itself never got data (neither the list nor the calm zero-state) — instead it
    // shows its OWN inline error note, distinct from "no overdue orders".
    expect(root.querySelector("[data-test=overdue-count]")).toBeNull();
    expect(root.querySelector("[data-test=overdue-table]")).toBeNull();
    expect(root.querySelector("[data-test=overdue-empty]")).toBeNull();
    expect(root.querySelector("[data-test=overdue-error]")).not.toBeNull();
    expect((el as unknown as { overviewErrorKey: string | null }).overviewErrorKey).toBeNull();
    expect((el as unknown as { overdueErrorKey: string | null }).overdueErrorKey).toBe(
      "server.internal",
    );
  });

  it("(vice versa) a failing sales-overview fetch on initial load leaves the overdue tile rendered, with NO inline note of its own", async () => {
    const api = stubApi({
      getSalesOverview: vi.fn().mockRejectedValue({ code: "server.internal" }),
      getOverdueOrders: vi.fn().mockResolvedValue({ orders: overdueOrders }),
    });
    const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
    await flush(el);
    const root = el.shadowRoot!;
    // The overdue tile still renders its full list, even though the sales overview failed — and
    // carries no error note of its own, since ITS fetch succeeded.
    expect(root.querySelectorAll("[data-test^=overdue-row-]")).toHaveLength(2);
    expect(root.querySelector("[data-test=overdue-empty]")).toBeNull();
    expect(root.querySelector("[data-test=overdue-error]")).toBeNull();
    // The sales-overview cards never got data to show — but the OVERALL screen doesn't crash and
    // the failure is surfaced via the TOP banner (the overview's own error).
    expect(root.querySelector("[data-test=takings]")).toBeNull();
    expect(root.querySelector("[data-test=error]")).not.toBeNull();
    expect((el as unknown as { overviewErrorKey: string | null }).overviewErrorKey).toBe(
      "server.internal",
    );
    expect((el as unknown as { overdueErrorKey: string | null }).overdueErrorKey).toBeNull();
  });

  it("(c) the two error fields are fully independent — neither fetch's outcome ever touches the other's error key", async () => {
    // Direction 1: overdue fails, overview succeeds → the overview error key is NEVER set.
    {
      const api = stubApi({
        getOverdueOrders: vi.fn().mockRejectedValue({ code: "server.internal" }),
      });
      const { el, host } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
      await flush(el);
      expect((el as unknown as { overviewErrorKey: string | null }).overviewErrorKey).toBeNull();
      expect((el as unknown as { overdueErrorKey: string | null }).overdueErrorKey).toBe(
        "server.internal",
      );
      host.remove();
    }
    // Direction 2: overview fails, overdue succeeds → the overdue error key is NEVER set.
    {
      const api = stubApi({
        getSalesOverview: vi.fn().mockRejectedValue({ code: "server.internal" }),
      });
      const { el, host } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
      await flush(el);
      expect((el as unknown as { overdueErrorKey: string | null }).overdueErrorKey).toBeNull();
      expect((el as unknown as { overviewErrorKey: string | null }).overviewErrorKey).toBe(
        "server.internal",
      );
      host.remove();
    }
  });
});
