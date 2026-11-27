import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtDataTable } from "@waitron/ui/src/components/wt-data-table.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
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
type Screen = HTMLElement & {
  api: TillApi;
  active: boolean;
  busy: boolean;
  updateComplete: Promise<unknown>;
  requestUpdate(): void;
};
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
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
function table(el: Screen) {
  return el.shadowRoot!.querySelector<WtDataTable<unknown>>("wt-data-table")!;
}
function requests(fetcher: ReturnType<typeof findBillApi>["fetcher"], path = "/api/transactions") {
  return fetcher.mock.calls
    .map(([url]) => new URL(String(url), location.origin))
    .filter((url) => url.pathname === path);
}
async function ready(el: Screen) {
  await vi.waitFor(() => {
    expect(table(el)?.loading).toBe(false);
    expect(table(el)?.rows.length).toBeGreaterThan(0);
  });
  await table(el).updateComplete;
  return table(el);
}
it("formats both lists in the venue time zone even when the browser uses another day", async () => {
  const at = "2026-10-15T09:30:00.000Z";
  const source = findBillApi(async (url) =>
    json(
      url.pathname.endsWith("options")
        ? { ...billOptions, timeZone: "Pacific/Honolulu" }
        : url.pathname === "/api/bills"
          ? listPage([billRow({ partyId: "party-1", departedAt: at })])
          : { ...listPage([transactionRow({ issuedAt: at })]), dates: resolvedDates },
    ),
  );
  const { el } = await mount(source);
  const transactions = await ready(el);
  expect(transactions.shadowRoot!.textContent).toContain("14/10/2026, 23:30:00");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-owed]")?.textContent).toContain("14/10/2026"),
  );
});
it("a declined Back leaves the page active and able to search again", async () => {
  const { el, fetcher } = await mount();
  await ready(el);
  const backs = vi.fn();
  el.addEventListener("find-bill-back", backs);
  await userEvent.click(el.shadowRoot!.querySelector("header wt-button")!);
  expect(backs).toHaveBeenCalledTimes(1);
  expect(el.active).toBe(true);
  table(el).dispatchEvent(
    new CustomEvent("wt-query-change", {
      detail: {
        search: "after Stay",
        sortKey: "when",
        sortDirection: "descending",
        filters: {},
      },
    }),
  );
  await vi.waitFor(() =>
    expect(requests(fetcher).at(-1)?.searchParams.get("q")).toBe("after Stay"),
  );
});
it("restores the table query before its first request and maps column filters without an extra unfiltered read", async () => {
  sessionStorage.setItem(
    "waitron.find-bill.transactions",
    JSON.stringify({
      sortKey: "amount",
      sortDirection: "ascending",
      filters: { method: "card", staff: "staff-2", type: "full-invoice" },
    }),
  );
  const { el, fetcher } = await mount();
  await ready(el);
  expect(requests(fetcher).map((url) => Object.fromEntries(url.searchParams))).toEqual([
    {
      q: "",
      page: "0",
      sort: "amount",
      direction: "ascending",
      preset: "today",
      method: "card",
      staffId: "staff-2",
      type: "full-invoice",
    },
  ]);
  expect(table(el).querySelectorAll('[data-chip]:not([data-chip="dates"])')).toHaveLength(3);
  table(el).chooseFilter("method", []);
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
  expect(requests(fetcher)[1]!.searchParams.has("method")).toBe(false);
  expect(requests(fetcher)[1]!.searchParams.get("staffId")).toBe("staff-2");
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
  expect(grid.shadowRoot!.textContent).toContain("F/0012");
});
it("pages on the server and resets to the first page when a column filter changes", async () => {
  const { el, fetcher } = await mount();
  const grid = await ready(el);
  await userEvent.click(grid.shadowRoot!.querySelector<HTMLElement>("[data-next-page]")!);
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
  expect(requests(fetcher)[1]!.searchParams.get("page")).toBe("1");
  grid.chooseFilter("method", ["card"]);
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(3));
  expect(requests(fetcher)[2]!.searchParams.get("page")).toBe("0");
  expect(requests(fetcher)[2]!.searchParams.get("method")).toBe("card");
});
it("opens Transactions today with independent columns, card digits, dates and historical staff", async () => {
  const { el, fetcher } = await mount();
  const grid = await ready(el);
  expect(requests(fetcher).map((url) => Object.fromEntries(url.searchParams))).toEqual([
    { q: "", page: "0", sort: "when", direction: "descending", preset: "today" },
  ]);
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
  expect(grid.shadowRoot!.querySelector('[aria-label="Filters 1"]')).not.toBeNull();
  expect(grid.shadowRoot!.querySelector('[aria-label="Customise columns"]')).not.toBeNull();
  expect(el.shadowRoot!.querySelector("h1")!.textContent).toContain("Find a bill");
});
it.each(["yesterday", "business-day", "last-7-days", "this-month"])(
  "requests %s through the shared date field",
  async (preset) => {
    const { el, fetcher } = await mount();
    await ready(el);
    const control = table(el).querySelector('wt-combobox[name="dates"]')!;
    control.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: preset }, bubbles: true, composed: true }),
    );
    await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
    expect(requests(fetcher)[1]!.searchParams.get("preset")).toBe(preset);
  },
);
it("aborts superseded reads and ignores answers delivered backwards", async () => {
  const pending: { resolve: (response: Response) => void; signal?: AbortSignal | null }[] = [];
  const source = findBillApi(async (url, signal) =>
    url.pathname.endsWith("options")
      ? json(billOptions)
      : url.pathname === "/api/bills"
        ? json(listPage([]))
        : new Promise((resolve) => pending.push({ resolve, signal })),
  );
  const page = (tableName: string) =>
    json({ ...listPage([transactionRow({ tableName })]), dates: resolvedDates });
  const { el } = await mount(source);
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  table(el).chooseFilter("method", ["card"]);
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[0]!.signal!.aborted).toBe(true);
  pending[1]!.resolve(page("Newest answer"));
  await ready(el);
  const obsolete = page("Obsolete answer");
  let consumed = false;
  const read = obsolete.text.bind(obsolete);
  vi.spyOn(obsolete, "text").mockImplementation(async () => {
    const result = await read();
    consumed = true;
    return result;
  });
  pending[0]!.resolve(obsolete);
  await vi.waitFor(() => expect(consumed).toBe(true));
  el.requestUpdate();
  await el.updateComplete;
  await table(el).updateComplete;
  expect(table(el).shadowRoot!.textContent).toContain("Newest answer");
  expect(table(el).shadowRoot!.textContent).not.toContain("Obsolete answer");
});
it("deactivation aborts reads and late responses cannot restore rows; a new visit reads afresh", async () => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  const source = findBillApi(async (url, current) =>
    url.pathname.endsWith("options")
      ? json(billOptions)
      : url.pathname === "/api/bills"
        ? json(listPage([]))
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
  finish(json({ ...listPage([transactionRow()]), dates: resolvedDates }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(table(el).rows).toHaveLength(0);
  el.active = true;
  await el.updateComplete;
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
});
it("a row opens on a click only while the screen is active and not busy", async () => {
  const { el } = await mount();
  const row = (await ready(el)).rows[0];
  expect(table(el).rowActivation!(row)).toBe("click");
  el.busy = true;
  await el.updateComplete;
  expect(table(el).rowActivation!(row)).toBe("none");
  el.busy = false;
  await el.updateComplete;
  expect(table(el).rowActivation!(row)).toBe("click");
  el.active = false;
  await el.updateComplete;
  expect(table(el).rowActivation!(row)).toBe("none");
});
it("custom dates mark each field, keep the panel available, and never query until a valid range is chosen", async () => {
  const { el, fetcher } = await mount();
  const grid = await ready(el);
  await userEvent.click(grid.shadowRoot!.querySelector<HTMLElement>('[aria-label="Filters 1"]')!);
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
  expect(requests(fetcher)).toHaveLength(1);
  expect(
    grid.shadowRoot!.querySelector('[aria-label="Filters 1"]')!.getAttribute("aria-expanded"),
  ).toBe("true");
  change("to", "2026-10-25");
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
  expect(Object.fromEntries(requests(fetcher)[1]!.searchParams)).toMatchObject({
    preset: "custom",
    from: "2026-10-25",
    to: "2026-10-25",
    page: "0",
  });
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
  const grid = await ready(el);
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
  await ready(el);
});
it("removing one chip keeps other filters; Clear all removes the date filter with a single fresh request", async () => {
  const { el, fetcher } = await mount();
  const grid = await ready(el);
  grid.chooseFilter("method", ["card"]);
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
  await ready(el);
  await userEvent.click(
    grid.querySelector<HTMLElement>('[data-chip="dates"]')!.shadowRoot!.querySelector("button")!,
  );
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(3));
  expect(requests(fetcher)[2]!.searchParams.get("preset")).toBe("any");
  expect(requests(fetcher)[2]!.searchParams.get("method")).toBe("card");
  await ready(el);
  grid
    .querySelector('[name="dates"]')!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "today" }, bubbles: true, composed: true }),
    );
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(4));
  await ready(el);
  await userEvent.click(grid.shadowRoot!.querySelector<HTMLElement>('[aria-label="Filters 2"]')!);
  await userEvent.click(grid.shadowRoot!.querySelector<HTMLElement>(".filters-clear-all")!);
  await vi.waitFor(() => expect(requests(fetcher).at(-1)!.searchParams.get("preset")).toBe("any"));
  expect(requests(fetcher)).toHaveLength(5);
  expect(requests(fetcher).at(-1)!.searchParams.has("method")).toBe(false);
});
it("a shrinking count requests the last valid page once and replaces rather than accumulating rows", async () => {
  let calls = 0;
  const source = findBillApi(async (url) =>
    json(
      url.pathname.endsWith("options")
        ? billOptions
        : url.pathname === "/api/bills"
          ? listPage([])
          : {
              dates: resolvedDates,
              ...(++calls === 1
                ? listPage([transactionRow()], 125)
                : calls === 2
                  ? listPage([], 1, 1)
                  : listPage([transactionRow({ tableName: "Only remaining bill" })], 1)),
            },
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
      : url.pathname === "/api/bills"
        ? json(listPage([]))
        : ++calls === 2
          ? json({ error: { code: "server.internal" } }, 500)
          : json({ ...listPage([transactionRow()]), dates: resolvedDates }),
  );
  const { el, fetcher } = await mount(source);
  const grid = await ready(el);
  grid.chooseFilter("method", ["card"]);
  await vi.waitFor(() => expect(grid.errorMessage).toContain("could not be loaded"));
  expect(grid.shadowRoot!.querySelector('[aria-label="Filters 2"]')).not.toBeNull();
  const retry = Array.from(grid.querySelectorAll("wt-button")).find((b) =>
    b.textContent?.includes("Retry"),
  )!;
  await userEvent.click(retry.shadowRoot!.querySelector("button")!);
  await ready(el);
  expect(requests(fetcher)).toHaveLength(3);
  expect(requests(fetcher)[2]!.searchParams.get("method")).toBe("card");
});
it.each([390, 800, 1280, 2560])(
  "row activation at %i emits the exact selected transaction once, and Back asks its parent to leave",
  async (width) => {
    const previous = { width: innerWidth, height: innerHeight };
    await page.viewport(width, 844);
    try {
      const { el, host } = await mount();
      const transactions = await ready(el);
      const opened: unknown[] = [];
      host.addEventListener("find-transaction-open", (e) => opened.push((e as CustomEvent).detail));
      await userEvent.click(
        transactions.shadowRoot!.querySelector<HTMLElement>('[data-row-key="sale-1"] td')!,
      );
      expect(opened).toEqual([{ row: transactionRow() }]);
      const back = vi.fn(() => {
        el.active = false;
      });
      host.addEventListener("find-bill-back", back);
      await userEvent.click(
        el.shadowRoot!.querySelector("header wt-button")!.shadowRoot!.querySelector("button")!,
      );
      expect(back).toHaveBeenCalledTimes(1);
      expect(el.active).toBe(false);
    } finally {
      await page.viewport(previous.width, previous.height);
    }
  },
);
it("changing the API context drops old rows/options and reads the new context even for an identical query", async () => {
  const { el } = await mount();
  await ready(el);
  const replacement = findBillApi(async (url) =>
    json(
      url.pathname.endsWith("options")
        ? { ...billOptions, transactionStaff: [{ id: "new-staff", name: "New staff" }] }
        : url.pathname === "/api/bills"
          ? listPage([])
          : {
              ...listPage([transactionRow({ tableName: "New session bill" })], 1),
              dates: resolvedDates,
            },
    ),
  );
  el.api = replacement.api;
  await el.updateComplete;
  await vi.waitFor(() => expect(table(el).shadowRoot!.textContent).toContain("New session bill"));
  expect(table(el).shadowRoot!.textContent).not.toContain("T3");
  expect(table(el).columns.find((c) => c.key === "staff")!.filter!.options).toEqual([
    { value: "new-staff", label: "New staff" },
  ]);
  expect(requests(replacement.fetcher)).toHaveLength(1);
});
it("reconnecting the retained page refreshes its rows without reloading its options", async () => {
  let calls = 0;
  const source = findBillApi(async (url) =>
    json(
      url.pathname.endsWith("options")
        ? billOptions
        : url.pathname === "/api/bills"
          ? listPage([])
          : {
              ...listPage([
                transactionRow({ tableName: ++calls === 1 ? "Before leaving" : "After returning" }),
              ]),
              dates: resolvedDates,
            },
    ),
  );
  const { el, host, fetcher } = await mount(source);
  await ready(el);
  el.remove();
  host.appendChild(el);
  await vi.waitFor(() => expect(table(el).shadowRoot!.textContent).toContain("After returning"));
  expect(table(el).shadowRoot!.textContent).not.toContain("Before leaving");
  expect(requests(fetcher)).toHaveLength(2);
  expect(requests(fetcher, "/api/find-bill/options")).toHaveLength(1);
});
it("reconnecting during the options read requests fresh options and ignores the detached visit", async () => {
  let finishOld!: (response: Response) => void;
  let optionsCalls = 0;
  const source = findBillApi(async (url) =>
    url.pathname.endsWith("options")
      ? ++optionsCalls === 1
        ? new Promise((resolve) => {
            finishOld = resolve;
          })
        : json({ ...billOptions, transactionStaff: [{ id: "new-staff", name: "Returned venue" }] })
      : url.pathname === "/api/bills"
        ? json(listPage([]))
        : json({
            ...listPage([transactionRow({ tableName: "Returned order" })]),
            dates: resolvedDates,
          }),
  );
  const { el, host, fetcher } = await mount(source);
  await vi.waitFor(() => expect(finishOld).toBeTypeOf("function"));
  el.remove();
  host.appendChild(el);
  await ready(el);
  finishOld(json(billOptions));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await el.updateComplete;
  expect(table(el).shadowRoot!.textContent).toContain("Returned order");
  expect(table(el).columns.find((column) => column.key === "staff")!.filter!.options).toEqual([
    { value: "new-staff", label: "Returned venue" },
  ]);
  expect(requests(fetcher, "/api/find-bill/options")).toHaveLength(2);
  expect(requests(fetcher)).toHaveLength(1);
});
it("names a filter chip by its drawn text, then what tapping it does", async () => {
  const { el } = await mount();
  await ready(el);
  const grid = table(el);
  grid.chooseFilter("method", ["card"]);
  await el.updateComplete;
  await ready(el);
  await vi.waitFor(() =>
    expect(
      grid.querySelector('[data-chip="method"]')?.shadowRoot?.querySelector("button"),
    ).toBeInstanceOf(HTMLButtonElement),
  );
  const chip = grid.querySelector('[data-chip="method"]')!;
  const drawn = chip.textContent!.replace("×", "").trim();
  expect(drawn).toMatch(/^Method: \S/);
  await expect
    .element(page.elementLocator(chip.shadowRoot!.querySelector("button")!))
    .toHaveAccessibleName(`${drawn}, Remove Method filter`);
});
it("removing a sale's method chip keeps its type filter and the resulting query does not repeat", async () => {
  const { el, fetcher } = await mount();
  await ready(el);
  const grid = table(el);
  grid.chooseFilter("type", ["full-invoice"]);
  grid.chooseFilter("method", ["card"]);
  await el.updateComplete;
  await ready(el);
  await vi.waitFor(() =>
    expect(
      grid.querySelector('[data-chip="method"]')?.shadowRoot?.querySelector("button"),
    ).toBeInstanceOf(HTMLButtonElement),
  );
  await userEvent.click(
    grid.querySelector('[data-chip="method"]')!.shadowRoot!.querySelector("button")!,
  );
  await ready(el);
  const query = requests(fetcher).at(-1)!.searchParams;
  expect(query.get("type")).toBe("full-invoice");
  expect(query.has("method")).toBe(false);
  expect(grid.querySelector('[data-chip="type"]')).not.toBeNull();
  expect(grid.querySelector('[data-chip="method"]')).toBeNull();
  const count = requests(fetcher).length;
  grid.dispatchEvent(
    new CustomEvent("wt-query-change", {
      detail: {
        search: "",
        sortKey: "when",
        sortDirection: "descending",
        filters: { type: "full-invoice" },
      },
    }),
  );
  await el.updateComplete;
  expect(requests(fetcher)).toHaveLength(count);
  expect(grid.shadowRoot!.textContent).toContain("F/0012");
});
it("removing the screen aborts options and a late options response cannot start a list request", async () => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  const source = findBillApi(async (url, current) =>
    url.pathname === "/api/bills"
      ? json(listPage([]))
      : new Promise((resolve) => {
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
      : json(
          url.pathname.endsWith("options")
            ? billOptions
            : url.pathname === "/api/bills"
              ? listPage()
              : { ...listPage([transactionRow()]), dates: resolvedDates },
        ),
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
it.each([
  ["en-GB", "find_page.back", "Back to counter"],
  ["es-ES", "find_page.back", "Volver al mostrador"],
  ["en-GB", "action.back", "Back"],
  ["es-ES", "action.back", "Atrás"],
] as const)("in %s, the back button given %s reads %s", async (language, backKey, words) => {
  const { el } = await mount();
  (el as Screen & { backKey: string }).backKey = backKey;
  setLocale(language);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("header wt-button")!.textContent!.trim()).toBe(words);
});
it("a late refused list cannot overwrite the successful replacement page", async () => {
  let rejectOld!: (response: Response) => void;
  let count = 0;
  const source = findBillApi(async (url) =>
    url.pathname.endsWith("options")
      ? json(billOptions)
      : url.pathname === "/api/bills"
        ? json(listPage([]))
        : ++count === 1
          ? new Promise((resolve) => {
              rejectOld = resolve;
            })
          : json({
              ...listPage([transactionRow({ tableName: "Current bill" })]),
              dates: resolvedDates,
            }),
  );
  const { el } = await mount(source);
  await vi.waitFor(() => expect(rejectOld).toBeTypeOf("function"));
  table(el).chooseFilter("method", ["card"]);
  await ready(el);
  rejectOld(json({ error: { code: "server.internal" } }, 500));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(table(el).errorMessage).toBe("");
  expect(table(el).shadowRoot!.textContent).toContain("Current bill");
});

it("filters actual completed refund rows without changing their identity, sign or original invoice", async () => {
  const source = findBillApi(async (url) =>
    json(
      url.pathname.endsWith("options")
        ? billOptions
        : url.pathname === "/api/bills"
          ? listPage()
          : {
              ...listPage([
                transactionRow({
                  transactionId: "refund:refund-1",
                  refundId: "refund-1",
                  type: "refund",
                  amount: "-13.75",
                }),
              ]),
              dates: resolvedDates,
            },
    ),
  );
  const { el, fetcher } = await mount(source);
  const grid = await ready(el);
  expect(grid.columns.find((c) => c.key === "type")!.filter!.options).toContainEqual({
    value: "refund",
    label: "Refund",
  });
  grid.chooseFilter("type", ["refund"]);
  await vi.waitFor(() => expect(requests(fetcher).at(-1)?.searchParams.get("type")).toBe("refund"));
  await vi.waitFor(() => expect(grid.loading).toBe(false));
  expect(grid.shadowRoot!.querySelector('[data-row-key="refund:refund-1"]')!.textContent).toContain(
    "F/0012",
  );
  expect(grid.shadowRoot!.textContent).toContain("-€13.75");
});

it.each([
  ["en-GB", "Corrective receipt", "Replacement corrective receipt"],
  ["es-ES", t("find_page.correction", "es-ES"), t("find_page.replacement", "es-ES")],
] as const)(
  "in %s, names a corrective receipt %s and a replacement %s",
  async (language, correction, replacement) => {
    const { el } = await mount(
      findBillApi(async (url) =>
        json(
          url.pathname.endsWith("options")
            ? billOptions
            : url.pathname === "/api/bills"
              ? listPage()
              : { ...listPage([transactionRow()]), dates: resolvedDates },
        ),
      ),
    );
    setLocale(language);
    const grid = await ready(el);
    await el.updateComplete;
    const options = grid.columns.find((c) => c.key === "type")!.filter!.options;
    expect(options).toContainEqual({ value: "replacement", label: replacement });
    expect(options).toContainEqual({ value: "correction", label: correction });
    expect(options).toContainEqual({ value: "refund", label: t("find_page.refund", language) });
    if (language === "en-GB") expect(t("find_page.refund", language)).toBe("Refund");
  },
);

it.each([
  ["en-GB", "Corrective invoice"],
  ["es-ES", "Factura rectificativa"],
] as const)("in %s, names a full invoice's corrective %s", async (language, label) => {
  const { el } = await mount(
    findBillApi(async (url) =>
      json(
        url.pathname.endsWith("options")
          ? billOptions
          : url.pathname === "/api/bills"
            ? listPage()
            : {
                ...listPage([transactionRow({ type: "full-correction", amount: "-4.00" })]),
                dates: resolvedDates,
              },
      ),
    ),
  );
  setLocale(language);
  const grid = await ready(el);
  await el.updateComplete;
  await grid.updateComplete;
  const options = grid.columns.find((c) => c.key === "type")!.filter!.options;
  expect(options).toContainEqual({ value: "full-correction", label });
  expect(grid.shadowRoot!.querySelector('[data-row-key="sale-1"]')!.textContent).toContain(label);
});

const openCorrection = (patch: Record<string, unknown> = {}) => ({
  id: "correction-1",
  saleId: "sale-1",
  state: "open",
  gross: "6.05",
  moneyBack: "2.00",
  pending: "0.00",
  left: "4.05",
  reason: "Overcharged",
  openedAt: "2026-10-15T12:00:00Z",
  correctiveSaleId: null,
  legs: [],
  invoiceNumber: "T/0012",
  ...patch,
});

it("lists the corrections under way and opens the one chosen", async () => {
  const correction = {
    id: "correction-1",
    saleId: "sale-1",
    state: "open",
    gross: "6.05",
    moneyBack: "2.00",
    pending: "0.00",
    left: "4.05",
    reason: "Overcharged",
    openedAt: "2026-10-15T12:00:00Z",
    correctiveSaleId: null,
    legs: [],
    invoiceNumber: "T/0012",
  };
  const { el, fetcher } = await mount(findBillApi(undefined, [correction]));
  await ready(el);
  const button = await vi.waitFor(() => {
    const found = el.shadowRoot!.querySelector<HTMLElement>('[data-correction="correction-1"]');
    expect(found).not.toBeNull();
    return found!;
  });
  expect(el.shadowRoot!.querySelector("[data-corrections] h2")!.textContent).toBe(
    "Refunds under way",
  );
  expect(button.textContent!.replace(/\s+/g, " ").trim()).toBe(
    "T/0012 · 15/10/2026, 14:00:00 · Overcharged · €4.05 of €6.05 left to refund",
  );
  expect(requests(fetcher, "/api/invoice-corrections")).toHaveLength(1);
  const opened = vi.fn();
  el.addEventListener("find-correction-open", opened);
  await userEvent.click(button);
  expect(opened.mock.calls[0]![0].detail).toEqual({ correction });
});

it("shows no corrections section when none is under way", async () => {
  const { el, fetcher } = await mount();
  await ready(el);
  await vi.waitFor(() => expect(requests(fetcher, "/api/invoice-corrections")).toHaveLength(1));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-corrections]")).toBeNull();
});

it("writes a reason exactly as typed, even one holding replacement patterns", async () => {
  const reason = "Paid $& twice {left}";
  const { el } = await mount(findBillApi(undefined, [openCorrection({ reason })]));
  await ready(el);
  const button = await vi.waitFor(() => {
    const found = el.shadowRoot!.querySelector<HTMLElement>('[data-correction="correction-1"]');
    expect(found).not.toBeNull();
    return found!;
  });
  expect(button.textContent!.replace(/\s+/g, " ").trim()).toBe(
    `T/0012 · 15/10/2026, 14:00:00 · ${reason} · €4.05 of €6.05 left to refund`,
  );
});

it("draws the corrections as rows of the section's full width, a long one cut short at phone width", async () => {
  const previous = { width: innerWidth, height: innerHeight };
  await page.viewport(390, 844);
  try {
    const long = openCorrection({
      id: "correction-2",
      reason: "Dish sent back cold, customer asked for the whole table's mains refunded",
    });
    const { el } = await mount(findBillApi(undefined, [openCorrection(), long]));
    await ready(el);
    const rows = await vi.waitFor(() => {
      const found = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-correction]")];
      expect(found).toHaveLength(2);
      return found;
    });
    const section = el.shadowRoot!.querySelector("[data-corrections]")!.getBoundingClientRect();
    for (const row of rows) {
      const box = row.getBoundingClientRect();
      expect([box.left, box.width]).toEqual([section.left, section.width]);
    }
    const text = rows[1]!.querySelector<HTMLElement>("[data-correction-text]")!;
    expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);
    expect(getComputedStyle(text).textOverflow).toBe("ellipsis");
    expect(rows[1]!.shadowRoot!.querySelector("button")!.getBoundingClientRect().right).toBe(
      section.right,
    );
  } finally {
    await page.viewport(previous.width, previous.height);
  }
});

it("offers Retry when the corrections cannot be read, still loading the bills", async () => {
  let fail = true;
  const source = findBillApi(async (url) =>
    json(
      url.pathname.endsWith("options")
        ? billOptions
        : url.pathname === "/api/bills"
          ? listPage()
          : { ...listPage([transactionRow()]), dates: resolvedDates },
    ),
  );
  const answer = source.fetcher.getMockImplementation()!;
  source.fetcher.mockImplementation(async (url, init) =>
    new URL(String(url), location.origin).pathname === "/api/invoice-corrections"
      ? fail
        ? json({ error: { code: "server.internal" } }, 500)
        : json({ corrections: [openCorrection()] })
      : answer(url, init),
  );
  const { el, fetcher } = await mount(source);
  const bills = await ready(el);
  expect(bills.rows).toHaveLength(1);
  const section = () => el.shadowRoot!.querySelector("[data-corrections]")!;
  await vi.waitFor(() =>
    expect(section().querySelector('[role="alert"]')!.textContent).toBe(
      "The list could not be loaded. Try again.",
    ),
  );
  fail = false;
  await userEvent.click(section().querySelector<HTMLElement>("[data-corrections-retry]")!);
  await vi.waitFor(() =>
    expect(section().querySelector('[data-correction="correction-1"]')).not.toBeNull(),
  );
  expect(section().querySelector('[role="alert"]')).toBeNull();
  expect(requests(fetcher, "/api/invoice-corrections")).toHaveLength(2);
});

const untilAborted = (signal?: AbortSignal | null) =>
  new Promise<Response>((_, reject) =>
    signal?.addEventListener("abort", () => reject(signal.reason)),
  );
const owedSource = (rows: unknown[], fail = () => false) =>
  findBillApi(async (url) =>
    url.pathname === "/api/bills" && fail()
      ? json({ error: { code: "server.internal" } }, 500)
      : json(
          url.pathname.endsWith("options")
            ? billOptions
            : url.pathname === "/api/bills"
              ? listPage(rows, rows.length)
              : { ...listPage([transactionRow()]), dates: resolvedDates },
        ),
  );
const departed = billRow({
  workingOrderId: "bill-owed",
  partyId: "party-1",
  partyName: "Ana",
  tables: ["T4"],
  label: null,
  orderStatus: "placed",
  state: "unpaid",
  paid: "0.00",
  stillOwed: "30.00",
  invoiceNumber: "A/12",
  departedAt: "2026-10-15T21:30:00Z",
  collectionStatus: "left_without_paying",
});
const counterRow = (state: "held" | "unpaid" | "paid-not-handed-over") =>
  billRow({
    workingOrderId: `counter-${state}`,
    tables: [],
    label: "Riley",
    state,
    orderStatus: state === "held" ? "open" : state === "unpaid" ? "placed" : "settled",
  });

it("shows one list of finished sales with no tabs, and reads unpaid bills and counter orders once", async () => {
  const { el, fetcher } = await mount(owedSource([]));
  await ready(el);
  expect(el.shadowRoot!.querySelector("wt-tabs")).toBeNull();
  expect(el.shadowRoot!.querySelectorAll("wt-data-table")).toHaveLength(1);
  await vi.waitFor(() => expect(requests(fetcher, "/api/bills")).toHaveLength(1));
  expect(Object.fromEntries(requests(fetcher, "/api/bills")[0]!.searchParams)).toEqual({
    q: "",
    page: "0",
    sort: "openedAt",
    direction: "descending",
    owed: "true",
    counter: "true",
  });
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-owed]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-counter-orders]")).toBeNull();
});

it.each([
  [
    "a bill guests left owing",
    departed,
    "[data-owed]",
    "Unpaid bills",
    "T4 · Ana · Left without paying on 15/10/2026 · €30.00 owed",
  ],
  [
    "a parked counter order",
    counterRow("held"),
    "[data-counter-orders]",
    "Counter orders",
    "#42 · Counter · Riley · Parked · €25.10",
  ],
  [
    "a presented counter order",
    counterRow("unpaid"),
    "[data-counter-orders]",
    "Counter orders",
    "#42 · Counter · Riley · Unpaid · €25.10",
  ],
  [
    "a paid counter order not handed over",
    counterRow("paid-not-handed-over"),
    "[data-counter-orders]",
    "Counter orders",
    "#42 · Counter · Riley · Paid, not handed over · €25.10",
  ],
] as const)(
  "lists %s above the sales and opens it as a bill",
  async (_, row, section, heading, words) => {
    const { el } = await mount(owedSource([row]));
    await ready(el);
    const button = await vi.waitFor(() => {
      const found = el.shadowRoot!.querySelector<HTMLElement>(
        `${section} [data-bill="${row.workingOrderId}"]`,
      );
      expect(found).not.toBeNull();
      return found!;
    });
    expect(el.shadowRoot!.querySelector(`${section} h2`)!.textContent).toBe(heading);
    expect(button.textContent!.replace(/\s+/g, " ").trim()).toBe(words);
    const opened = vi.fn();
    el.addEventListener("find-bill-open", opened);
    el.busy = true;
    await el.updateComplete;
    expect((button as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    el.busy = false;
    await el.updateComplete;
    await userEvent.click(button);
    expect(opened).toHaveBeenCalledOnce();
    expect(opened.mock.calls[0]![0].detail).toEqual({ row });
  },
);

it("names the unpaid bills and counter orders in Spanish", async () => {
  const { el } = await mount(owedSource([departed, counterRow("held")]));
  setLocale("es-ES");
  await ready(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-counter-orders]")).not.toBeNull(),
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-owed] h2")!.textContent).toBe("Cuentas sin pagar");
  expect(el.shadowRoot!.querySelector("[data-counter-orders] h2")!.textContent).toBe(
    "Pedidos de mostrador",
  );
});

it.each([
  ["en-GB", "Unpaid bills and counter orders", "The list could not be loaded. Try again."],
  [
    "es-ES",
    "Cuentas sin pagar y pedidos de mostrador",
    "No se pudo cargar la lista. Inténtalo de nuevo.",
  ],
])(
  "offers one Retry under one heading when the unpaid bills and counter orders cannot be read (%s)",
  async (language, heading, words) => {
    let fail = true;
    const { el, fetcher } = await mount(owedSource([departed, counterRow("held")], () => fail));
    setLocale(language);
    expect((await ready(el)).rows).toHaveLength(1);
    const alerts = () => el.shadowRoot!.querySelectorAll('[data-owed-error] [role="alert"]');
    await vi.waitFor(() => expect(alerts()).toHaveLength(1));
    await el.updateComplete;
    expect(alerts()[0]!.textContent).toBe(words);
    expect(el.shadowRoot!.querySelector("[data-owed-error] h2")!.textContent).toBe(heading);
    expect(el.shadowRoot!.querySelectorAll("[data-owed-retry]")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("[data-owed]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-counter-orders]")).toBeNull();
    fail = false;
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-owed-retry]")!);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector('[data-owed] [data-bill="bill-owed"]')).not.toBeNull(),
    );
    expect(
      el.shadowRoot!.querySelector('[data-counter-orders] [data-bill="counter-held"]'),
    ).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-owed-error]")).toBeNull();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    expect(requests(fetcher, "/api/bills")).toHaveLength(2);
  },
);

it("shows no earlier row once a refresh of the unpaid bills and counter orders fails, nor while its Retry waits", async () => {
  let bills: "answer" | "fail" | "wait" = "answer";
  const { el } = await mount(
    findBillApi(async (url, signal) => {
      if (url.pathname === "/api/bills" && bills === "fail")
        return json({ error: { code: "server.internal" } }, 500);
      if (url.pathname === "/api/bills" && bills === "wait") return untilAborted(signal);
      return json(
        url.pathname.endsWith("options")
          ? billOptions
          : url.pathname === "/api/bills"
            ? listPage([departed, counterRow("held")], 2)
            : { ...listPage([transactionRow()]), dates: resolvedDates },
      );
    }),
  );
  await ready(el);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelectorAll("[data-bill]")).toHaveLength(2));
  bills = "fail";
  el.active = false;
  await el.updateComplete;
  el.active = true;
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-owed-error]")).not.toBeNull());
  expect(el.shadowRoot!.querySelectorAll("[data-bill]")).toHaveLength(0);
  expect(el.shadowRoot!.querySelectorAll("[data-owed-retry]")).toHaveLength(1);
  bills = "wait";
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-owed-retry]")!);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-owed-error]")).toBeNull();
  expect(el.shadowRoot!.querySelectorAll("[data-bill]")).toHaveLength(0);
});

it("shows none of the old API's rows once the API is replaced, while the new reads wait or fail", async () => {
  const { el } = await mount(
    findBillApi(
      async (url) =>
        json(
          url.pathname.endsWith("options")
            ? billOptions
            : url.pathname === "/api/bills"
              ? listPage([departed, counterRow("held")], 2)
              : { ...listPage([transactionRow()]), dates: resolvedDates },
        ),
      [openCorrection()],
    ),
  );
  await ready(el);
  await vi.waitFor(() => {
    expect(el.shadowRoot!.querySelectorAll("[data-bill]")).toHaveLength(2);
    expect(el.shadowRoot!.querySelectorAll("[data-correction]")).toHaveLength(1);
  });
  const next = findBillApi(async (url, signal) =>
    url.pathname === "/api/bills"
      ? untilAborted(signal)
      : json(
          url.pathname.endsWith("options")
            ? billOptions
            : { ...listPage([transactionRow()]), dates: resolvedDates },
        ),
  );
  const answer = next.fetcher.getMockImplementation()!;
  next.fetcher.mockImplementation(async (url, init) =>
    new URL(String(url), location.origin).pathname === "/api/invoice-corrections"
      ? json({ error: { code: "server.internal" } }, 500)
      : answer(url, init),
  );
  el.api = next.api;
  await vi.waitFor(() => {
    expect(requests(next.fetcher, "/api/bills")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("[data-corrections-retry]")).not.toBeNull();
  });
  await el.updateComplete;
  expect(el.shadowRoot!.querySelectorAll("[data-bill]")).toHaveLength(0);
  expect(el.shadowRoot!.querySelectorAll("[data-correction]")).toHaveLength(0);
});

it("tells two unnamed counter orders apart by their order numbers", async () => {
  const unnamed = (orderNumber: number) =>
    billRow({
      workingOrderId: `counter-${orderNumber}`,
      orderNumber,
      tables: [],
      label: null,
      state: "held",
    });
  const { el } = await mount(owedSource([unnamed(41), unnamed(43)]));
  await ready(el);
  const texts = await vi.waitFor(() => {
    const found = [...el.shadowRoot!.querySelectorAll("[data-counter-orders] [data-bill]")];
    expect(found).toHaveLength(2);
    return found.map((button) => button.textContent!.replace(/\s+/g, " ").trim());
  });
  expect(texts).toEqual(["#41 · Counter · Parked · €25.10", "#43 · Counter · Parked · €25.10"]);
});

const counterOrder = (index: number) =>
  billRow({
    workingOrderId: `counter-${index}`,
    orderNumber: index,
    tables: [],
    label: null,
    state: "held",
  });
const pagedSource = (nextPage: () => boolean | Promise<boolean> = () => true) => {
  const first = Array.from({ length: 50 }, (_, index) => counterOrder(index + 1));
  const last = billRow({
    workingOrderId: "counter-51",
    orderNumber: 51,
    tables: [],
    label: null,
    state: "paid-not-handed-over",
    orderStatus: "settled",
  });
  return findBillApi(async (url) => {
    if (url.pathname.endsWith("options")) return json(billOptions);
    if (url.pathname !== "/api/bills")
      return json({ ...listPage([transactionRow()]), dates: resolvedDates });
    if (url.searchParams.get("page") === "0") return json(listPage(first, 51, 0));
    return (await nextPage())
      ? json(listPage([first[49], last], 51, 1))
      : json({ error: { code: "server.internal" } }, 500);
  });
};

it("reads the next page of unpaid bills and counter orders when more exist than are shown", async () => {
  let failMore = true;
  const { el, fetcher } = await mount(pagedSource(() => !failMore));
  await ready(el);
  const bills = () => el.shadowRoot!.querySelectorAll("[data-bill]");
  await vi.waitFor(() => expect(bills()).toHaveLength(50));
  expect(el.shadowRoot!.querySelector('[data-bill="counter-51"]')).toBeNull();
  const more = el.shadowRoot!.querySelector<HTMLElement>("[data-owed-more]")!;
  expect(more.textContent!.trim()).toBe("Show more");
  await userEvent.click(more);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull());
  expect(bills()).toHaveLength(50);
  expect(el.shadowRoot!.querySelector("[data-owed-error]")).toBeNull();
  failMore = false;
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-owed-retry]")!);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-bill="counter-51"]')).not.toBeNull(),
  );
  expect(bills()).toHaveLength(51);
  expect(el.shadowRoot!.querySelector("[data-owed-more]")).toBeNull();
  expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  expect(requests(fetcher, "/api/bills").map((url) => url.searchParams.get("page"))).toEqual([
    "0",
    "1",
    "1",
  ]);
});

it("offers no Show more when every unpaid bill and counter order is shown", async () => {
  const { el } = await mount(owedSource([departed, counterRow("held")]));
  await ready(el);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelectorAll("[data-bill]")).toHaveLength(2));
  expect(el.shadowRoot!.querySelector("[data-owed-more]")).toBeNull();
});

it("starts again at the first page of unpaid bills and counter orders on a refresh after Show more", async () => {
  const { el, fetcher } = await mount(pagedSource());
  await ready(el);
  const bills = () => el.shadowRoot!.querySelectorAll("[data-bill]");
  await vi.waitFor(() => expect(bills()).toHaveLength(50));
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-owed-more]")!);
  await vi.waitFor(() => expect(bills()).toHaveLength(51));
  el.active = false;
  await el.updateComplete;
  el.active = true;
  await vi.waitFor(() => expect(requests(fetcher, "/api/bills")).toHaveLength(3));
  await vi.waitFor(() => expect(bills()).toHaveLength(50));
  expect(el.shadowRoot!.querySelector("[data-owed-more]")).not.toBeNull();
  expect(requests(fetcher, "/api/bills").map((url) => url.searchParams.get("page"))).toEqual([
    "0",
    "1",
    "0",
  ]);
});

it("marks Show more busy while unpaid bills and counter orders are read, and reads the next page once", async () => {
  let release!: () => void;
  const held = new Promise<boolean>((done) => (release = () => done(true)));
  const { el, fetcher } = await mount(pagedSource(() => held));
  await ready(el);
  const bills = () => el.shadowRoot!.querySelectorAll("[data-bill]");
  await vi.waitFor(() => expect(bills()).toHaveLength(50));
  const more = el.shadowRoot!.querySelector<HTMLElement>("[data-owed-more]")!;
  expect(more.hasAttribute("loading")).toBe(false);
  await userEvent.click(more);
  await el.updateComplete;
  expect(more.hasAttribute("loading")).toBe(true);
  more.shadowRoot!.querySelector("button")!.click();
  more.shadowRoot!.querySelector("button")!.click();
  release();
  await vi.waitFor(() => expect(bills()).toHaveLength(51));
  expect(requests(fetcher, "/api/bills").map((url) => url.searchParams.get("page"))).toEqual([
    "0",
    "1",
  ]);
});

it("keeps the unpaid bills and counter orders shown when the screen is moved while a read waits", async () => {
  let bills: "answer" | "wait" = "answer";
  const { el, fetcher } = await mount(
    findBillApi(async (url, signal) =>
      url.pathname === "/api/bills" && bills === "wait"
        ? untilAborted(signal)
        : json(
            url.pathname.endsWith("options")
              ? billOptions
              : url.pathname === "/api/bills"
                ? listPage([departed, counterRow("held")], 2)
                : { ...listPage([transactionRow()]), dates: resolvedDates },
          ),
    ),
  );
  await ready(el);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelectorAll("[data-bill]")).toHaveLength(2));
  bills = "wait";
  el.active = false;
  await el.updateComplete;
  el.active = true;
  await vi.waitFor(() => expect(requests(fetcher, "/api/bills")).toHaveLength(2));
  const parent = el.parentNode!;
  el.remove();
  await new Promise((done) => setTimeout(done));
  parent.appendChild(el);
  await vi.waitFor(() => expect(requests(fetcher, "/api/bills")).toHaveLength(3));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelectorAll("[data-bill]")).toHaveLength(2);
  expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
});
