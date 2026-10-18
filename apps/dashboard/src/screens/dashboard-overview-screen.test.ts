import { page } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
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
    {
      name: "Café con leche",
      quantity: "18",
      total: "36.00",
      variants: [
        { name: "Café con leche grande", quantity: "10", total: "22.00" },
        { name: "Café con leche pequeño", quantity: "8", total: "14.00" },
      ],
    },
    { name: "Croissant", quantity: "12", total: "24.00", variants: [] },
  ],
};

// Two currently-open orders past their station's overdue threshold, WORST-FIRST, as
// `/reports/overdue-orders` returns them. The screen must not re-sort these.
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
    expect(root.querySelector("[data-test=gross-total]")!.textContent).toBe("1279,50\u00a0€");
    expect(root.querySelector("[data-test=tender-total]")!.textContent).toBe("1234,50\u00a0€");
    expect(root.querySelector("[data-test=tip-total]")!.textContent).toBe("45,00\u00a0€");
  });

  it("writes the takings and the top sellers' totals as English writes euros", async () => {
    setLocale("en-GB");
    const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", {
      api: stubApi(),
    });
    await flush(el);
    const root = el.shadowRoot!;
    expect(root.querySelector("[data-test=gross-total]")!.textContent).toBe("€1,279.50");
    expect(root.querySelector("[data-test=tender-total]")!.textContent).toBe("€1,234.50");
    expect(root.querySelector("[data-test=tip-total]")!.textContent).toBe("€45.00");
    const cells = (test: string) =>
      [...root.querySelectorAll(`[data-test="${test}"] td`)].map((cell) => cell.textContent);
    expect(cells("seller-row-0")).toEqual(["18", "€36.00"]);
    expect(cells("seller-row-0-variant-1")).toEqual(["8", "€14.00"]);
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

  it("renders each top-seller row's plain staff name, in server order", async () => {
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
    expect(names).toEqual(["Café con leche", "Croissant"]);
    const variants = [...card.querySelectorAll("[data-test=variant-name]")].map(
      (n) => n.textContent,
    );
    expect(variants).toEqual(["Café con leche grande", "Café con leche pequeño"]);
    expect(card.querySelector('[data-test="seller-row-0-variant-1"]')!.textContent).toContain(
      "14,00\u00a0€",
    );
    expect(card.querySelector('[data-test="seller-row-1-variant-0"]')).toBeNull();
    // Painted by this screen's styles: the variant's name is indented past its product's.
    const parentIndent = parseFloat(
      getComputedStyle(card.querySelector("[data-test=seller-name]")!).paddingLeft,
    );
    const variantIndent = parseFloat(
      getComputedStyle(card.querySelector('[data-test="seller-row-0-variant-0"] th')!).paddingLeft,
    );
    expect(variantIndent).toBeGreaterThan(parentIndent);
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
    // A bare walk-up (no table) renders the em-dash placeholder.
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
      // Only the overdue list refetches on a tick: the sales-overview call count must stay FLAT.
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
      // An OVERDUE failure never touches the overview's OWN field, and never shows the top banner
      // (that banner is reserved for `overviewErrorKey`).
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
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      const root = el.shadowRoot!;
      const state = () =>
        el as unknown as { overviewErrorKey: string | null; overdueErrorKey: string | null };
      expect(state().overviewErrorKey).toBe("server.internal");
      expect(root.querySelector("[data-test=error]")).not.toBeNull();

      await vi.advanceTimersByTimeAsync(30_000); // an overdue poll tick — succeeds
      expect(state().overdueErrorKey).toBeNull(); // the tick itself succeeded
      // The overview's error is UNCHANGED by that unrelated success: a single shared `errorKey` would
      // have been cleared here.
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
    // The sales-overview cards render normally: the overdue failure must not blank them, and must not
    // raise the TOP banner (that's reserved for the overview's own failures).
    expect(root.querySelector("[data-test=gross-total]")!.textContent).toContain("1279,50\u00a0€");
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

it("updates today's sales cards after a sale elsewhere", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
  await vi.waitFor(() => expect(api.getSalesOverview).toHaveBeenCalledOnce());
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.mocked(api.getSalesOverview).mockResolvedValue({
    ...overview,
    counts: { ...overview.counts, sales: 101 },
  });
  liveData.invalidate([{ type: "sales", id: "new-sale" }]);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=count-sales]")?.textContent).toContain("101"),
  );
});

it.each(["floor_today_tables", "floor_zones"])(
  "refreshes open tables after %s changes",
  async (type) => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el } = await mountWidget<OverviewScreen>("dashboard-overview-screen", { api });
    await flush(el);
    vi.mocked(api.getSalesOverview).mockResolvedValue({
      ...overview,
      openTables: { open: 1, total: 5 },
    });
    liveData.invalidate([{ type, id: "changed" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=open-tables]")?.textContent).toContain(
        "1 / 5",
      ),
    );
    expect(api.getSalesOverview).toHaveBeenCalledTimes(2);
  },
);

describe.each(["light", "dark"] as const)("overview card layout (%s)", (theme) => {
  it.each([
    ["en-GB", 1280],
    ["es-ES", 1280],
    ["en-GB", 900],
    ["es-ES", 900],
    ["en-GB", 390],
    ["es-ES", 390],
  ] as const)("fills each card's grid cell in %s at %i px", async (locale, width) => {
    const previous = [innerWidth, innerHeight] as const;
    await page.viewport(width, 1000);
    try {
      setLocale(locale);
      const { el } = await mountWidget<OverviewScreen>(
        "dashboard-overview-screen",
        { api: stubApi() },
        theme,
      );
      await flush(el);
      const cards = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".cards > wt-card")];
      expect(cards).toHaveLength(4);
      await Promise.all(
        cards.map(
          (card) => (card as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete,
        ),
      );
      await document.fonts.ready;
      const painted = cards.map((card) =>
        card.shadowRoot!.querySelector(".card")!.getBoundingClientRect(),
      );
      if (width >= 900) {
        const firstRow = width === 900 ? painted.slice(0, 3) : painted;
        for (const box of firstRow) {
          expect(box.top).toBeCloseTo(painted[0]!.top, 1);
          expect(box.bottom).toBeCloseTo(painted[0]!.bottom, 1);
        }
        if (width === 900) expect(painted[3]!.top).toBeGreaterThan(painted[0]!.bottom);
      } else {
        for (let i = 1; i < painted.length; i++) {
          expect(painted[i]!.top).toBeGreaterThan(painted[i - 1]!.bottom);
        }
      }
      for (const [index, card] of cards.entries()) {
        const host = card.getBoundingClientRect();
        expect(painted[index]!.height).toBeGreaterThan(0);
        expect(painted[index]!.bottom).toBeCloseTo(host.bottom, 1);
        expect(painted[index]!.right).toBeLessThanOrEqual(innerWidth);
      }
    } finally {
      await page.viewport(...previous);
    }
  });
});

describe.each(["light", "dark"] as const)("top-seller name overflow (%s)", (theme) => {
  it.each([
    ["en-GB", 1280],
    ["es-ES", 1280],
    ["en-GB", 390],
    ["es-ES", 390],
  ] as const)("truncates names and retains hover text in %s at %i px", async (locale, width) => {
    const previous = [innerWidth, innerHeight] as const;
    await page.viewport(width, 1000);
    try {
      setLocale(locale);
      const productName = "SupercalifragilisticexpialidociousChocolate";
      const variantName = "SupercalifragilisticexpialidociousChocolateGrande";
      const { el } = await mountWidget<OverviewScreen>(
        "dashboard-overview-screen",
        {
          api: stubApi({
            getSalesOverview: vi.fn().mockResolvedValue({
              ...overview,
              topSellers: [
                {
                  name: productName,
                  quantity: "99999",
                  total: "99999.99",
                  variants: [{ name: variantName, quantity: "88888", total: "88888.88" }],
                },
                {
                  name: "Croquetas de jamón artesanas",
                  quantity: "55555",
                  total: "55555.55",
                  variants: [],
                },
              ],
            }),
          }),
        },
        theme,
      );
      await flush(el);
      const card = el.shadowRoot!.querySelector<HTMLElement>("[data-test=top-sellers]")!;
      await (card as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
      await document.fonts.ready;
      expect(innerWidth).toBe(width);
      const surface = card.shadowRoot!.querySelector<HTMLElement>(".card")!;
      const cardBox = surface.getBoundingClientRect();
      const padding = getComputedStyle(surface);
      const table = card.querySelector("table")!;
      const tableBox = table.getBoundingClientRect();
      expect(tableBox.left).toBeGreaterThanOrEqual(cardBox.left + parseFloat(padding.paddingLeft));
      expect(tableBox.right).toBeLessThanOrEqual(cardBox.right - parseFloat(padding.paddingRight));
      expect(cardBox.right).toBeLessThanOrEqual(innerWidth);
      const ordinaryName = card.querySelector<HTMLElement>("[data-test=seller-row-1] th")!;
      expect(ordinaryName.textContent).toBe("Croquetas de jamón artesanas");
      expect(ordinaryName.title).toBe("Croquetas de jamón artesanas");
      const range = document.createRange();
      range.selectNodeContents(ordinaryName);
      const tops = [...range.getClientRects()].map((box) => box.top);
      expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(0);
      expect(ordinaryName.scrollWidth).toBeLessThanOrEqual(ordinaryName.clientWidth);
      const names = [
        card.querySelector<HTMLElement>("[data-test=seller-name]")!,
        card.querySelector<HTMLElement>("[data-test=variant-name]")!,
      ];
      for (const [index, name] of names.entries()) {
        expect(name.textContent).toBe([productName, variantName][index]);
        expect(name.title).toBe([productName, variantName][index]);
        const word = name.querySelector<HTMLElement>(".seller-word")!;
        const style = getComputedStyle(word);
        expect(style.textOverflow).toBe("ellipsis");
        expect(style.whiteSpace).toBe("nowrap");
        expect(style.overflowX).toBe("hidden");
        expect(word.clientWidth).toBeGreaterThan(0);
        expect(word.scrollWidth).toBeGreaterThan(word.clientWidth);
      }
      const numbers = [...table.querySelectorAll<HTMLElement>("td")];
      expect(numbers.map((cell) => cell.textContent)).toEqual(
        locale === "en-GB"
          ? ["99999", "€99,999.99", "88888", "€88,888.88", "55555", "€55,555.55"]
          : ["99999", "99.999,99\u00a0€", "88888", "88.888,88\u00a0€", "55555", "55.555,55\u00a0€"],
      );
      for (const number of numbers) {
        expect(number.scrollWidth).toBeLessThanOrEqual(number.clientWidth);
      }
    } finally {
      await page.viewport(...previous);
    }
  });
});
