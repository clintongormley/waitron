import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtDataTable } from "@waitron/ui/src/components/wt-data-table.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  billOptions,
  billRow,
  findBillApi,
  json,
  listPage,
  resolvedDates,
  transactionRow,
} from "../../test/find-bill-fixtures.js";
import type { TillApi } from "../api/client.js";
const modules = import.meta.glob("./till-find-bill-screen.ts");
type Screen = HTMLElement & { api: TillApi; active: boolean; updateComplete: Promise<unknown> };
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
  sessionStorage.removeItem("waitron.find-bill.bills");
  sessionStorage.removeItem("waitron.find-bill.transactions");
  vi.restoreAllMocks();
});
async function mount(source = findBillApi()) {
  const load = modules["./till-find-bill-screen.ts"];
  expect(load, "Find a bill screen").toBeTypeOf("function");
  await load!();
  setLocale("en-GB");
  const mounted = await mountWidget<Screen>("till-find-bill-screen", {
    api: source.api,
    active: true,
  });
  return { ...mounted, ...source };
}
function table(el: Screen, tab = "bills") {
  return el.shadowRoot!.querySelector<WtDataTable<unknown>>(`wt-data-table[data-tab="${tab}"]`)!;
}
function requests(fetcher: ReturnType<typeof findBillApi>["fetcher"], path = "/api/bills") {
  return fetcher.mock.calls
    .map(([url]) => new URL(String(url), location.origin))
    .filter((url) => url.pathname === path);
}
async function ready(el: Screen, tab = "bills") {
  await vi.waitFor(() => expect(table(el, tab)?.rows.length).toBeGreaterThan(0));
  return table(el, tab);
}
async function switchTab(el: Screen, tab: string) {
  await userEvent.click(
    el
      .shadowRoot!.querySelector("wt-tabs")!
      .shadowRoot!.querySelector<HTMLElement>(`[data-key="${tab}"]`)!,
  );
}
it("opens Bills newest first using the shared table and renders all original server values without local sorting", async () => {
  const source = findBillApi(async (url) =>
    json(
      url.pathname.endsWith("options")
        ? billOptions
        : listPage([billRow(), billRow({ workingOrderId: "bill-2", label: "Alpha" })]),
    ),
  );
  const { el, fetcher } = await mount(source);
  const grid = await ready(el);
  expect(requests(fetcher).map((url) => Object.fromEntries(url.searchParams))).toEqual([
    { q: "", page: "0", sort: "openedAt", direction: "descending" },
  ]);
  expect(grid.serverPaging).toEqual({ page: 0, pageSize: 50, total: 51 });
  expect(grid.columns.map((c) => c.key)).toEqual([
    "openedAt",
    "tableName",
    "zone",
    "staff",
    "items",
    "total",
    "paid",
    "state",
  ]);
  const text = grid.shadowRoot!.textContent!;
  expect(text).toContain("Lucía");
  expect(text).toContain("Earlier day");
  expect(text).toContain("25.10");
  expect(text.indexOf("Lucía")).toBeLessThan(text.indexOf("Alpha"));
  expect(grid.shadowRoot!.querySelector('[aria-label="Filters"]')).not.toBeNull();
  expect(grid.shadowRoot!.querySelector('[aria-label="Customise columns"]')).not.toBeNull();
  expect(el.shadowRoot!.querySelector("h1")!.textContent).toContain("Find a bill");
});
it("restores the table query before its first request and maps column filters without an extra unfiltered read", async () => {
  sessionStorage.setItem(
    "waitron.find-bill.bills",
    JSON.stringify({
      sortKey: "total",
      sortDirection: "ascending",
      filters: { zone: "zone-1", staff: "staff-1", state: "part-paid" },
    }),
  );
  const { el, fetcher } = await mount();
  await ready(el);
  expect(requests(fetcher).map((url) => Object.fromEntries(url.searchParams))).toEqual([
    {
      q: "",
      page: "0",
      sort: "total",
      direction: "ascending",
      zoneId: "zone-1",
      staffId: "staff-1",
      state: "part-paid",
    },
  ]);
  expect(table(el).querySelectorAll("[data-chip]")).toHaveLength(3);
  table(el).chooseFilter("zone", []);
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
  expect(requests(fetcher)[1]!.searchParams.has("zoneId")).toBe(false);
  expect(requests(fetcher)[1]!.searchParams.get("staffId")).toBe("staff-1");
});
it("debounces typed search once, preserves its trailing space and uses only that server page", async () => {
  const { el, fetcher } = await mount();
  const grid = await ready(el);
  const input = grid.shadowRoot!.querySelector<HTMLInputElement>('input[type="search"]')!;
  input.value = "0091 ";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await grid.updateComplete;
  expect(requests(fetcher)).toHaveLength(1);
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
  expect(requests(fetcher)[1]!.searchParams.get("q")).toBe("0091 ");
  await ready(el);
  expect(grid.rows).toHaveLength(1);
  expect(grid.shadowRoot!.textContent).toContain("Lucía");
});
it("pages on the server and resets to the first page when a column filter changes", async () => {
  const { el, fetcher } = await mount();
  const grid = await ready(el);
  await userEvent.click(grid.shadowRoot!.querySelector<HTMLElement>("[data-next-page]")!);
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
  expect(requests(fetcher)[1]!.searchParams.get("page")).toBe("1");
  grid.chooseFilter("state", ["held"]);
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(3));
  expect(requests(fetcher)[2]!.searchParams.get("page")).toBe("0");
  expect(requests(fetcher)[2]!.searchParams.get("state")).toBe("held");
});
it("opens Transactions today with independent columns, card digits, dates and historical staff", async () => {
  const { el, fetcher } = await mount();
  await ready(el);
  await switchTab(el, "transactions");
  const grid = await ready(el, "transactions");
  expect(
    requests(fetcher, "/api/transactions").map((url) => Object.fromEntries(url.searchParams)),
  ).toEqual([{ q: "", page: "0", sort: "when", direction: "descending", preset: "today" }]);
  expect(grid.viewKey).toBe("waitron.find-bill.transactions");
  expect(grid.columns.map((c) => c.key)).toEqual([
    "when",
    "invoice",
    "type",
    "tableName",
    "method",
    "staff",
    "amount",
  ]);
  expect(grid.shadowRoot!.textContent).toContain("0091");
  expect(grid.shadowRoot!.textContent).toContain("F/0012");
  expect(grid.columns.find((c) => c.key === "staff")!.filter!.options).toEqual([
    { value: "staff-2", label: "Former worker" },
  ]);
  expect(grid.querySelector('[data-chip="dates"]')!.textContent).toContain("2026-10-15");
  expect(grid.externalFilterCount).toBe(1);
});
it.each(["yesterday", "business-day", "last-7-days", "this-month"])(
  "requests %s through the shared date field",
  async (preset) => {
    const { el, fetcher } = await mount();
    await ready(el);
    await switchTab(el, "transactions");
    await ready(el, "transactions");
    const control = table(el, "transactions").querySelector('wt-combobox[name="dates"]')!;
    control.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: preset }, bubbles: true, composed: true }),
    );
    await vi.waitFor(() => expect(requests(fetcher, "/api/transactions")).toHaveLength(2));
    expect(requests(fetcher, "/api/transactions")[1]!.searchParams.get("preset")).toBe(preset);
  },
);
it("aborts superseded reads and ignores answers delivered backwards", async () => {
  const pending: { resolve: (response: Response) => void; signal?: AbortSignal | null }[] = [];
  const source = findBillApi(async (url, signal) =>
    url.pathname.endsWith("options")
      ? json(billOptions)
      : new Promise((resolve) => pending.push({ resolve, signal })),
  );
  const { el } = await mount(source);
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  table(el).chooseFilter("state", ["held"]);
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[0]!.signal!.aborted).toBe(true);
  pending[1]!.resolve(json(listPage([billRow({ label: "Newest answer" })])));
  await ready(el);
  pending[0]!.resolve(json(listPage([billRow({ label: "Obsolete answer" })])));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(table(el).shadowRoot!.textContent).toContain("Newest answer");
  expect(table(el).shadowRoot!.textContent).not.toContain("Obsolete answer");
});
it("deactivation aborts reads and late responses cannot restore rows; a new visit reads afresh", async () => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  const source = findBillApi(async (url, current) =>
    url.pathname.endsWith("options")
      ? json(billOptions)
      : new Promise((resolve) => {
          finish = resolve;
          signal = current;
        }),
  );
  const { el, fetcher } = await mount(source);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  el.active = false;
  await el.updateComplete;
  expect(signal!.aborted).toBe(true);
  finish(json(listPage()));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(table(el).rows).toHaveLength(0);
  el.active = true;
  await el.updateComplete;
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
});
it("retains Transactions query and page when switching tabs, then fetches that page on return", async () => {
  const source = findBillApi(async (url) =>
    json(
      url.pathname.endsWith("options")
        ? billOptions
        : url.pathname === "/api/bills"
          ? listPage()
          : {
              ...listPage([transactionRow()], 125, Number(url.searchParams.get("page"))),
              dates: resolvedDates,
            },
    ),
  );
  const { el, fetcher } = await mount(source);
  await ready(el);
  await switchTab(el, "transactions");
  const grid = await ready(el, "transactions");
  await userEvent.click(grid.shadowRoot!.querySelector<HTMLElement>("[data-next-page]")!);
  await vi.waitFor(() => expect(requests(fetcher, "/api/transactions")).toHaveLength(2));
  await ready(el, "transactions");
  await switchTab(el, "bills");
  await ready(el);
  await switchTab(el, "transactions");
  await ready(el, "transactions");
  expect(requests(fetcher, "/api/transactions").at(-1)!.searchParams.get("page")).toBe("1");
  expect(grid.serverPaging).toEqual({ page: 1, pageSize: 50, total: 125 });
});
it("custom dates mark each field, keep the panel available, and never query until a valid range is chosen", async () => {
  const { el, fetcher } = await mount();
  await ready(el);
  await switchTab(el, "transactions");
  const grid = await ready(el, "transactions");
  await userEvent.click(grid.shadowRoot!.querySelector<HTMLElement>('[aria-label="Filters"]')!);
  const change = (name: string, value: string) =>
    grid
      .querySelector(`[name="${name}"]`)!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
  change("dates", "custom");
  await el.updateComplete;
  const from = grid.querySelector<HTMLElement>('wt-input[name="from"]')!;
  const to = grid.querySelector<HTMLElement>('wt-input[name="to"]')!;
  await (from as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  expect(from.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("true");
  expect(to.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("true");
  change("from", "2026-10-25");
  change("to", "2026-10-01");
  await el.updateComplete;
  expect(requests(fetcher, "/api/transactions")).toHaveLength(1);
  expect(
    grid.shadowRoot!.querySelector('[aria-label="Filters"]')!.getAttribute("aria-expanded"),
  ).toBe("true");
  change("to", "2026-10-25");
  await vi.waitFor(() => expect(requests(fetcher, "/api/transactions")).toHaveLength(2));
  expect(Object.fromEntries(requests(fetcher, "/api/transactions")[1]!.searchParams)).toMatchObject(
    { preset: "custom", from: "2026-10-25", to: "2026-10-25", page: "0" },
  );
});
it("date chips never show resolved dates from an older query while the replacement is loading", async () => {
  let finish!: (response: Response) => void;
  const source = findBillApi(async (url) =>
    url.pathname.endsWith("options")
      ? json(billOptions)
      : url.searchParams.get("preset") === "yesterday"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : json(
            url.pathname === "/api/bills"
              ? listPage()
              : { ...listPage([transactionRow()]), dates: resolvedDates },
          ),
  );
  const { el } = await mount(source);
  await ready(el);
  await switchTab(el, "transactions");
  const grid = await ready(el, "transactions");
  grid.querySelector('[name="dates"]')!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "yesterday" },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await el.updateComplete;
  expect(grid.querySelector('[data-chip="dates"]')!.textContent).toContain("Yesterday");
  expect(grid.querySelector('[data-chip="dates"]')!.textContent).not.toContain("2026-10-15");
  finish(
    json({
      ...listPage([transactionRow()]),
      dates: { ...resolvedDates, from: "2026-10-14", to: "2026-10-14" },
    }),
  );
  await ready(el, "transactions");
});
it("removing one chip keeps other filters; Clear all removes the date filter with a single fresh request", async () => {
  const { el, fetcher } = await mount();
  await ready(el);
  await switchTab(el, "transactions");
  const grid = await ready(el, "transactions");
  grid.chooseFilter("method", ["card"]);
  await vi.waitFor(() => expect(requests(fetcher, "/api/transactions")).toHaveLength(2));
  await ready(el, "transactions");
  await userEvent.click(
    grid.querySelector<HTMLElement>('[data-chip="dates"]')!.shadowRoot!.querySelector("button")!,
  );
  await vi.waitFor(() => expect(requests(fetcher, "/api/transactions")).toHaveLength(3));
  expect(requests(fetcher, "/api/transactions")[2]!.searchParams.get("preset")).toBe("any");
  expect(requests(fetcher, "/api/transactions")[2]!.searchParams.get("method")).toBe("card");
  await ready(el, "transactions");
  grid
    .querySelector('[name="dates"]')!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "today" }, bubbles: true, composed: true }),
    );
  await vi.waitFor(() => expect(requests(fetcher, "/api/transactions")).toHaveLength(4));
  await ready(el, "transactions");
  await userEvent.click(grid.shadowRoot!.querySelector<HTMLElement>('[aria-label="Filters"]')!);
  await userEvent.click(grid.shadowRoot!.querySelector<HTMLElement>(".filters-clear-all")!);
  await vi.waitFor(() =>
    expect(requests(fetcher, "/api/transactions").at(-1)!.searchParams.get("preset")).toBe("any"),
  );
  expect(requests(fetcher, "/api/transactions")).toHaveLength(5);
  expect(requests(fetcher, "/api/transactions").at(-1)!.searchParams.has("method")).toBe(false);
});
it("a shrinking count requests the last valid page once and replaces rather than accumulating rows", async () => {
  let calls = 0;
  const source = findBillApi(async (url) =>
    json(
      url.pathname.endsWith("options")
        ? billOptions
        : ++calls === 1
          ? listPage([billRow()], 125)
          : calls === 2
            ? listPage([], 1, 1)
            : listPage([billRow({ label: "Only remaining bill" })], 1),
    ),
  );
  const { el, fetcher } = await mount(source);
  const grid = await ready(el);
  await userEvent.click(grid.shadowRoot!.querySelector<HTMLElement>("[data-next-page]")!);
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(3));
  await ready(el);
  expect(requests(fetcher).map((u) => u.searchParams.get("page"))).toEqual(["0", "1", "0"]);
  expect(grid.serverPaging).toEqual({ page: 0, pageSize: 50, total: 1 });
  expect(grid.shadowRoot!.textContent).toContain("Only remaining bill");
  expect(grid.rows).toHaveLength(1);
});
it("an error leaves controls and Retry available and retries the same filters", async () => {
  let calls = 0;
  const source = findBillApi(async (url) =>
    url.pathname.endsWith("options")
      ? json(billOptions)
      : ++calls === 2
        ? json({ error: { code: "server.internal" } }, 500)
        : json(listPage()),
  );
  const { el, fetcher } = await mount(source);
  const grid = await ready(el);
  grid.chooseFilter("state", ["held"]);
  await vi.waitFor(() => expect(grid.errorMessage).toContain("could not be loaded"));
  expect(grid.shadowRoot!.querySelector('[aria-label="Filters"]')).not.toBeNull();
  const retry = Array.from(grid.querySelectorAll("wt-button")).find((b) =>
    b.textContent?.includes("Retry"),
  )!;
  await userEvent.click(retry.shadowRoot!.querySelector("button")!);
  await ready(el);
  expect(requests(fetcher)).toHaveLength(3);
  expect(requests(fetcher)[2]!.searchParams.get("state")).toBe("held");
});
it("row activation emits the exact selected bill or transaction once, and Back cancels a pending read", async () => {
  const { el, host } = await mount();
  const seen: unknown[] = [];
  host.addEventListener("find-bill-open", (e) => seen.push((e as CustomEvent).detail));
  const grid = await ready(el);
  const row = grid.shadowRoot!.querySelector<HTMLElement>('[data-row-key="bill-1"]');
  expect(row).not.toBeNull();
  await userEvent.click(row!);
  expect(seen).toEqual([{ row: billRow() }]);
  await switchTab(el, "transactions");
  const transactions = await ready(el, "transactions");
  const opened: unknown[] = [];
  host.addEventListener("find-transaction-open", (e) => opened.push((e as CustomEvent).detail));
  await userEvent.click(
    transactions.shadowRoot!.querySelector<HTMLElement>('[data-row-key="sale-1"]')!,
  );
  expect(opened).toEqual([{ row: transactionRow() }]);
  const back = vi.fn();
  host.addEventListener("find-bill-back", back);
  await userEvent.click(
    el.shadowRoot!.querySelector("header wt-button")!.shadowRoot!.querySelector("button")!,
  );
  expect(back).toHaveBeenCalledTimes(1);
  expect(el.active).toBe(false);
});
it("changing the API context drops old rows/options and reads the new context even for an identical query", async () => {
  const { el } = await mount();
  await ready(el);
  const replacement = findBillApi(async (url) =>
    json(
      url.pathname.endsWith("options")
        ? { ...billOptions, zones: [{ id: "new-zone", name: "New location" }] }
        : listPage([billRow({ label: "New session bill" })], 1),
    ),
  );
  el.api = replacement.api;
  await el.updateComplete;
  await vi.waitFor(() => expect(table(el).shadowRoot!.textContent).toContain("New session bill"));
  expect(table(el).shadowRoot!.textContent).not.toContain("Lucía");
  expect(table(el).columns.find((c) => c.key === "zone")!.filter!.options).toEqual([
    { value: "new-zone", label: "New location" },
  ]);
  expect(requests(replacement.fetcher)).toHaveLength(1);
});
it("removing the screen aborts options and a late options response cannot start a list request", async () => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  const source = findBillApi(
    async (_url, current) =>
      new Promise((resolve) => {
        finish = resolve;
        signal = current;
      }),
  );
  const { el, fetcher } = await mount(source);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  el.remove();
  expect(signal!.aborted).toBe(true);
  finish(json(billOptions));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(requests(fetcher)).toHaveLength(0);
});
it("options can be retried without losing the full-page Back action", async () => {
  let calls = 0;
  const source = findBillApi(async (url) =>
    url.pathname.endsWith("options") && ++calls === 1
      ? json({ error: { code: "server.internal" } }, 500)
      : json(url.pathname.endsWith("options") ? billOptions : listPage()),
  );
  const { el } = await mount(source);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull());
  const retry = Array.from(el.shadowRoot!.querySelectorAll("wt-button")).find((b) =>
    b.textContent?.includes("Retry"),
  )!;
  await userEvent.click(retry.shadowRoot!.querySelector("button")!);
  await ready(el);
  expect(el.shadowRoot!.querySelector("header wt-button")!.textContent).toContain(
    "Back to counter",
  );
});
it("a late refused list cannot overwrite the successful replacement page", async () => {
  let rejectOld!: (response: Response) => void;
  let count = 0;
  const source = findBillApi(async (url) =>
    url.pathname.endsWith("options")
      ? json(billOptions)
      : ++count === 1
        ? new Promise((resolve) => {
            rejectOld = resolve;
          })
        : json(listPage([billRow({ label: "Current bill" })])),
  );
  const { el } = await mount(source);
  await vi.waitFor(() => expect(rejectOld).toBeTypeOf("function"));
  table(el).chooseFilter("state", ["held"]);
  await ready(el);
  rejectOld(json({ error: { code: "server.internal" } }, 500));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(table(el).errorMessage).toBe("");
  expect(table(el).shadowRoot!.textContent).toContain("Current bill");
});
