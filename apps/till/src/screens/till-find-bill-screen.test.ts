import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  cleanupWidgets,
  loadPhoneFont,
  mountWidget,
  pageAt,
  PHONE_FONT,
  resetPage,
  textRects,
} from "../widgets/test-helpers.js";
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
import type { TransactionRow } from "../api/find-bill-types.js";
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
  vi.useRealTimers();
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
function requests(fetcher: ReturnType<typeof findBillApi>["fetcher"], path = "/api/transactions") {
  return fetcher.mock.calls
    .map(([url]) => new URL(String(url), location.origin))
    .filter((url) => url.pathname === path);
}
const shown = (el: Screen) => [
  ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button[data-transaction]"),
];
const row = (el: Screen, id = "sale-1") =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(`button[data-transaction="${id}"]`)!;
const words = (node: Element | null | undefined) => node!.textContent!.replace(/\s+/g, " ").trim();
async function ready(el: Screen) {
  await vi.waitFor(() => {
    expect(el.shadowRoot!.querySelector("[data-list-loading]")).toBeNull();
    expect(shown(el).length).toBeGreaterThan(0);
  });
  return shown(el);
}
const topBar = (el: Screen) =>
  el.shadowRoot!.querySelector<
    HTMLElement & { heading: string; subtitle: string; backLabel: string }
  >("wt-top-bar")!;
const backButton = (el: Screen) =>
  topBar(el).shadowRoot!.querySelector("wt-button")!.shadowRoot!.querySelector("button")!;
const searchField = (el: Screen) =>
  el.shadowRoot!.querySelector<HTMLElement>('wt-input[name="search"]')!;
async function type(el: Screen, value: string) {
  const field = searchField(el);
  await (field as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}
const daysMenu = (el: Screen) =>
  el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "wt-row-actions[data-days]",
  )!;
async function choose(el: Screen, preset: string) {
  const menu = daysMenu(el);
  await menu.updateComplete;
  await userEvent.click(menu.shadowRoot!.querySelector<HTMLElement>('[part="trigger"]')!);
  await vi.waitFor(() =>
    expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true),
  );
  await userEvent.click(menu.querySelector<HTMLElement>(`[data-preset="${preset}"]`)!);
}
const answering = (rows: TransactionRow[], total = rows.length) =>
  findBillApi(async (url) =>
    json(
      url.pathname.endsWith("options")
        ? billOptions
        : url.pathname === "/api/bills"
          ? listPage([])
          : { ...listPage(rows, total), dates: resolvedDates },
    ),
  );

it("formats both lists in the venue time zone even when the browser uses another day", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T09:45:00.000Z"));
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
  await ready(el);
  expect(words(row(el).querySelector("[data-time]"))).toBe("23:30");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-owed]")?.textContent).toContain("14/10/2026"),
  );
});
it.each([
  ["2026-10-15T20:58:00.000Z", "22:58"],
  ["2026-10-13T20:58:00.000Z", "Tue"],
  ["2026-10-09T20:58:00.000Z", "Fri"],
  ["2026-10-08T20:58:00.000Z", "08/10"],
])("a sale issued at %s shows %s as its time", async (issuedAt, time) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T21:30:00.000Z"));
  const { el } = await mount(answering([transactionRow({ issuedAt })]));
  await ready(el);
  expect(words(row(el).querySelector("[data-time]"))).toBe(time);
});
it("a declined Back leaves the page active and able to search again", async () => {
  const { el, fetcher } = await mount();
  await ready(el);
  const backs = vi.fn();
  el.addEventListener("find-bill-back", backs);
  await userEvent.click(backButton(el));
  expect(backs).toHaveBeenCalledTimes(1);
  expect(el.active).toBe(true);
  await type(el, "after Stay");
  await vi.waitFor(() =>
    expect(requests(fetcher).at(-1)?.searchParams.get("q")).toBe("after Stay"),
  );
});
it("debounces typed search once, preserves its trailing space and shows only that answer", async () => {
  const source = findBillApi(async (url) =>
    json(
      url.pathname.endsWith("options")
        ? billOptions
        : url.pathname === "/api/bills"
          ? listPage([])
          : {
              ...listPage(
                url.searchParams.get("q")
                  ? [transactionRow({ transactionId: "sale-9", tableName: "Matched" })]
                  : [transactionRow()],
                1,
              ),
              dates: resolvedDates,
            },
    ),
  );
  const { el, fetcher } = await mount(source);
  await ready(el);
  await type(el, "0");
  await type(el, "0091 ");
  await el.updateComplete;
  expect(requests(fetcher)).toHaveLength(1);
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
  expect(requests(fetcher)[1]!.searchParams.get("q")).toBe("0091 ");
  await vi.waitFor(() => expect(shown(el).map((b) => b.dataset.transaction)).toEqual(["sale-9"]));
  expect(topBar(el).subtitle).toBe("1 found");
});
it("counts a search only once its own answer arrives, never while it waits or after it fails", async () => {
  const waiting: { resolve: (response: Response) => void }[] = [];
  const source = findBillApi(async (url) => {
    if (url.pathname.endsWith("options")) return json(billOptions);
    if (url.pathname === "/api/bills") return json(listPage([]));
    if (!url.searchParams.get("q"))
      return json({ ...listPage([transactionRow()], 125), dates: resolvedDates });
    return new Promise((resolve) => waiting.push({ resolve }));
  });
  const { el } = await mount(source);
  await ready(el);
  expect(topBar(el).subtitle).toBe("Paid today");
  await type(el, "fish");
  await el.updateComplete;
  expect(topBar(el).subtitle).toBe("Paid today");
  await vi.waitFor(() => expect(waiting).toHaveLength(1));
  await el.updateComplete;
  expect(topBar(el).subtitle).toBe("Paid today");
  waiting[0]!.resolve(json({ error: { code: "server.internal" } }, 500));
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-list-error]")).not.toBeNull());
  expect(topBar(el).subtitle).toBe("Paid today");
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-list-retry]")!);
  await vi.waitFor(() => expect(waiting).toHaveLength(2));
  waiting[1]!.resolve(
    json({ ...listPage([transactionRow({ transactionId: "sale-9" })], 2), dates: resolvedDates }),
  );
  await vi.waitFor(() => expect(topBar(el).subtitle).toBe("2 found"));
});
it("opens on today's finished sales, newest first, under a top bar and a search band", async () => {
  const { el, fetcher } = await mount();
  await ready(el);
  expect(requests(fetcher).map((url) => Object.fromEntries(url.searchParams))).toEqual([
    { q: "", page: "0", preset: "today" },
  ]);
  expect(el.shadowRoot!.querySelector("wt-data-table")).toBeNull();
  expect(el.shadowRoot!.querySelector("h1")).toBeNull();
  expect(
    el.shadowRoot!.querySelector("wt-full-screen-panel > [slot='header'] wt-top-bar"),
  ).not.toBeNull();
  expect(topBar(el).heading).toBe("Find a bill");
  expect(topBar(el).subtitle).toBe("Paid today");
  const field = searchField(el);
  expect(field.getAttribute("variant")).toBe("outlined");
  expect(field.getAttribute("placeholder")).toBe("Number, table, name, card digits or amount");
  expect(field.querySelector('wt-icon[slot="start"]')!.getAttribute("name")).toBe("search");
  expect(words(daysMenu(el).querySelector('[slot="trigger"]'))).toBe("Today");
  expect(words(el.shadowRoot!.querySelector("[data-order-label]"))).toBe("Newest first");
});
it.each([
  ["yesterday", "Yesterday", "Paid yesterday"],
  ["business-day", "This business day", "Paid this business day"],
  ["last-7-days", "Last 7 days", "Paid in the last 7 days"],
  ["this-month", "This month", "Paid this month"],
  ["any", "Any date", "Paid on any date"],
])("the Days sheet's %s reads the list again once", async (preset, chip, subtitle) => {
  const { el, fetcher } = await mount();
  await ready(el);
  await choose(el, preset);
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
  await ready(el);
  expect(requests(fetcher)[1]!.searchParams.get("preset")).toBe(preset);
  expect(words(daysMenu(el).querySelector('[slot="trigger"]'))).toBe(chip);
  expect(topBar(el).subtitle).toBe(subtitle);
  expect(daysMenu(el).shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
  const rows = [...daysMenu(el).querySelectorAll<HTMLElement>("[data-preset]")];
  expect(rows.map((r) => r.dataset.preset)).toEqual([
    "today",
    "yesterday",
    "business-day",
    "last-7-days",
    "this-month",
    "custom",
    "any",
  ]);
  expect(rows.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
  const checked = rows.find((r) => r.dataset.preset === preset)!;
  expect(checked.getAttribute("aria-checked")).toBe("true");
  expect((checked.querySelector("wt-menu-row") as HTMLElement & { check: boolean }).check).toBe(
    true,
  );
  await choose(el, preset);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(requests(fetcher)).toHaveLength(2);
});
it("aborts superseded reads and ignores answers delivered backwards", async () => {
  const pending: { resolve: (response: Response) => void; signal?: AbortSignal | null }[] = [];
  const source = findBillApi(async (url, signal) =>
    url.pathname.endsWith("options")
      ? json(billOptions)
      : url.pathname === "/api/bills"
        ? json(listPage([]))
        : new Promise((resolve) => pending.push({ resolve, signal })),
  );
  const answer = (tableName: string) =>
    json({ ...listPage([transactionRow({ tableName })]), dates: resolvedDates });
  const { el } = await mount(source);
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  await choose(el, "yesterday");
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[0]!.signal!.aborted).toBe(true);
  pending[1]!.resolve(answer("Newest answer"));
  await ready(el);
  const obsolete = answer("Obsolete answer");
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
  expect(el.shadowRoot!.textContent).toContain("Newest answer");
  expect(el.shadowRoot!.textContent).not.toContain("Obsolete answer");
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
  await el.updateComplete;
  expect(shown(el)).toHaveLength(0);
  el.active = true;
  await el.updateComplete;
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
});
it("a row opens on a click only while the screen is active and not busy", async () => {
  const { el } = await mount();
  await ready(el);
  const opened = vi.fn();
  el.addEventListener("find-transaction-open", opened);
  el.busy = true;
  await el.updateComplete;
  expect(row(el).disabled).toBe(true);
  row(el).dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  el.busy = false;
  await el.updateComplete;
  expect(row(el).disabled).toBe(false);
  el.active = false;
  await el.updateComplete;
  expect(row(el)?.disabled ?? true).toBe(true);
  expect(opened).not.toHaveBeenCalled();
});
it("custom dates mark each field and never query until a valid range is chosen", async () => {
  const { el, fetcher } = await mount();
  await ready(el);
  await choose(el, "custom");
  await el.updateComplete;
  const change = (name: string, value: string) =>
    el
      .shadowRoot!.querySelector(`wt-input[name="${name}"]`)!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
  const from = el.shadowRoot!.querySelector<HTMLElement>('wt-input[name="from"]')!;
  const to = el.shadowRoot!.querySelector<HTMLElement>('wt-input[name="to"]')!;
  await (from as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  expect(from.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("true");
  expect(to.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("true");
  expect(words(daysMenu(el).querySelector('[slot="trigger"]'))).toBe("From / To");
  change("from", "2026-10-25");
  change("to", "2026-10-01");
  await el.updateComplete;
  expect(requests(fetcher)).toHaveLength(1);
  expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe(
    "Choose valid dates, with From on or before To.",
  );
  change("to", "2026-10-26");
  await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
  expect(Object.fromEntries(requests(fetcher)[1]!.searchParams)).toMatchObject({
    preset: "custom",
    from: "2026-10-25",
    to: "2026-10-26",
    page: "0",
  });
  expect(topBar(el).subtitle).toBe("Paid 25/10/2026 – 26/10/2026");
});
it("an error keeps the search and Days chip and Retry reads the same days again", async () => {
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
  await ready(el);
  await choose(el, "yesterday");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-list-error] [role='alert']")?.textContent).toBe(
      "The list could not be loaded. Try again.",
    ),
  );
  expect(searchField(el)).not.toBeNull();
  expect(daysMenu(el)).not.toBeNull();
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-list-retry]")!);
  await ready(el);
  expect(requests(fetcher)).toHaveLength(3);
  expect(requests(fetcher)[2]!.searchParams.get("preset")).toBe("yesterday");
  expect(el.shadowRoot!.querySelector("[data-list-error]")).toBeNull();
});
it.each([390, 1280])(
  "a tapped row at %i emits the exact transaction once, and Back asks its parent to leave",
  async (width) => {
    const previous = { width: innerWidth, height: innerHeight };
    await page.viewport(width, 844);
    try {
      const { el, host } = await mount();
      await ready(el);
      const opened: unknown[] = [];
      host.addEventListener("find-transaction-open", (e) => opened.push((e as CustomEvent).detail));
      await userEvent.click(row(el));
      expect(opened).toEqual([{ row: transactionRow() }]);
      const back = vi.fn(() => {
        el.active = false;
      });
      host.addEventListener("find-bill-back", back);
      await userEvent.click(backButton(el));
      expect(back).toHaveBeenCalledTimes(1);
      expect(el.active).toBe(false);
    } finally {
      await page.viewport(previous.width, previous.height);
    }
  },
);
it("changing the API context drops old rows and reads the new context even for an identical query", async () => {
  const { el } = await mount();
  await ready(el);
  const replacement = answering([
    transactionRow({ transactionId: "sale-new", tableName: "New session bill" }),
  ]);
  el.api = replacement.api;
  await el.updateComplete;
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("New session bill"));
  expect(row(el, "sale-1")).toBeNull();
  expect(requests(replacement.fetcher)).toHaveLength(1);
  expect(requests(replacement.fetcher, "/api/find-bill/options")).toHaveLength(1);
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
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("After returning"));
  expect(el.shadowRoot!.textContent).not.toContain("Before leaving");
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
        : json(billOptions)
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
  expect(el.shadowRoot!.textContent).toContain("Returned order");
  expect(requests(fetcher, "/api/find-bill/options")).toHaveLength(2);
  expect(requests(fetcher)).toHaveLength(1);
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
  expect(topBar(el).backLabel).toBe("Back to counter");
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-options-retry]")!);
  await ready(el);
  expect(topBar(el).backLabel).toBe("Back to counter");
});
it.each([
  ["en-GB", "find_page.back", "Back to counter"],
  ["es-ES", "find_page.back", "Volver al mostrador"],
  ["en-GB", "action.back", "Back"],
  ["es-ES", "action.back", "Atrás"],
] as const)("in %s, the back button given %s reads %s", async (language, backKey, text) => {
  const { el } = await mount();
  (el as Screen & { backKey: string }).backKey = backKey;
  setLocale(language);
  await el.updateComplete;
  await (topBar(el) as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  expect(topBar(el).backLabel).toBe(text);
  expect(words(topBar(el).shadowRoot!.querySelector('[part="back-label"]'))).toBe(text);
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
  await choose(el, "yesterday");
  await ready(el);
  rejectOld(json({ error: { code: "server.internal" } }, 500));
  await new Promise((resolve) => setTimeout(resolve, 30));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-list-error]")).toBeNull();
  expect(el.shadowRoot!.textContent).toContain("Current bill");
});
it("draws each part of a card sale's row", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T21:30:00.000Z"));
  const { el } = await mount(
    answering([
      transactionRow({
        type: "sale",
        issuedAt: "2026-10-15T20:58:00.000Z",
        tableName: "Table 4",
        customerName: null,
        methods: [{ method: "card", last4: "4821" }],
        staff: { id: "staff-1", name: "Ana" },
        amount: "80.52",
        invoiceNumber: "T-0412",
      }),
    ]),
  );
  await ready(el);
  const sale = row(el);
  expect(sale.getAttribute("type")).toBe("button");
  expect(words(sale.querySelector("[data-time]"))).toBe("22:58");
  expect(words(sale.querySelector("[data-place]"))).toBe("Table 4");
  expect(sale.querySelector("[data-way] wt-icon")!.getAttribute("name")).toBe("card");
  expect(sale.querySelector("[data-way] wt-icon")!.getAttribute("size")).toBe("lg");
  expect(sale.querySelector("[data-way] [data-tag]")).toBeNull();
  expect(words(sale.querySelector("[data-way]"))).toBe("Card ··4821 · Ana");
  expect(words(sale.querySelector("[data-amount]"))).toBe("€80.52");
  expect(words(sale.querySelector("[data-number]"))).toBe("T-0412");
  expect(sale.querySelector("[data-amount] .hl")).toBeNull();
});
it("sets a row's time on its first line beside the place, pads its label and draws a 16 px Days chevron, as the frame does", async () => {
  const { el } = await mount(answering([transactionRow({ type: "full-invoice" })]));
  await ready(el);
  const sale = row(el);
  const middle = (part: Element) => {
    const rect = part.getBoundingClientRect();
    return (rect.top + rect.bottom) / 2;
  };
  const time = sale.querySelector("[data-time]")!;
  const place = sale.querySelector("[data-place]")!;
  const way = sale.querySelector("[data-way]")!;
  expect(Math.abs(middle(time) - middle(place))).toBeLessThanOrEqual(1);
  expect(time.getBoundingClientRect().bottom).toBeLessThanOrEqual(way.getBoundingClientRect().top);
  const tag = getComputedStyle(sale.querySelector("[data-tag]")!);
  expect([tag.paddingTop, tag.paddingBottom]).toEqual(["1px", "1px"]);
  const chevron = el
    .shadowRoot!.querySelector("[data-days]")!
    .querySelector('wt-icon[name="chevron-down"]')!
    .getBoundingClientRect();
  expect([chevron.width, chevron.height]).toEqual([16, 16]);
});
const LONG_NUMBER = "A-0CNNY/9007199254740993";
const overlap = (a: DOMRect, b: DOMRect) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
const box = (rect: DOMRect) => `${rect.left}–${rect.right} × ${rect.top}–${rect.bottom}`;
/** The words under `node` drawn across more than one line, which only a column too narrow for them causes. */
function brokenWords(node: Node): string[] {
  const broken: string[] = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode())
    for (const word of text.textContent!.matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(text, word.index);
      range.setEnd(text, word.index + word[0].length);
      const tops = new Set(
        [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
      );
      if (tops.size > 1) broken.push(word[0]);
    }
  return broken;
}
/** The text under `node` on each line it is drawn across, top to bottom. */
function linesOf(node: Node): string[] {
  const lines = new Map<number, string>();
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode())
    for (let at = 0; at < text.textContent!.length; at++) {
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + 1);
      const rect = [...range.getClientRects()].find((r) => r.width > 0);
      if (!rect) continue;
      const top = Math.round(rect.top);
      lines.set(top, (lines.get(top) ?? "") + text.textContent![at]);
    }
  return [...lines.entries()].sort(([a], [b]) => a - b).map(([, line]) => line);
}
it.each([
  [320, ["A-0CNNY/", "9007199254740993"]],
  [390, ["A-0CNNY/9007199254740993"]],
])(
  "at %i px in Spanish, a long receipt number breaks only after its series' slash, as %j, and never overlaps a row's place, amount, label or way paid",
  async (width, numberLines) => {
    const face = await loadPhoneFont();
    try {
      await pageAt(width, 844);
      const { el, host } = await mount(
        answering([
          transactionRow({
            transactionId: "refund:refund-1",
            refundId: "refund-1",
            type: "refund",
            invoiceNumber: LONG_NUMBER,
            tableName: "Terraza 3",
            amount: "-1234.50",
            methods: [{ method: "card", last4: "7710" }],
            staff: { id: "staff-1", name: "Marta" },
          }),
          transactionRow({
            transactionId: "sale-2",
            type: "full-correction",
            invoiceNumber: LONG_NUMBER,
            customerName: "Garcia Lopez SL",
          }),
          transactionRow({
            transactionId: "sale-3",
            type: "sale",
            invoiceNumber: LONG_NUMBER,
            customerName: null,
            methods: [{ method: "card", last4: "4821" }],
          }),
        ]),
      );
      host.style.setProperty("--wt-font-family", PHONE_FONT);
      setLocale("es-ES");
      await ready(el);
      await el.updateComplete;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(words(row(el, "refund:refund-1").querySelector("[data-tag]"))).toBe("Devolución");
      for (const sale of shown(el)) {
        expect(getComputedStyle(sale).fontFamily).toBe(PHONE_FONT);
        const number = sale.querySelector<HTMLElement>("[data-number]")!;
        const detail = sale.querySelector<HTMLElement>("[data-way] .detail")!;
        const parts = [
          sale.querySelector<HTMLElement>("[data-place]")!,
          sale.querySelector<HTMLElement>("[data-amount]")!,
          sale.querySelector<HTMLElement>("[data-way] wt-icon"),
          sale.querySelector<HTMLElement>("[data-tag]"),
          detail,
        ].filter((part) => part !== null);
        const button = sale.getBoundingClientRect();
        expect(detail.getBoundingClientRect().width).toBeGreaterThan(0);
        expect(detail.scrollWidth, words(detail)).toBeLessThanOrEqual(detail.clientWidth);
        for (const part of parts) expect(brokenWords(part), part.className).toEqual([]);
        expect(linesOf(number)).toEqual(numberLines);
        for (const part of [...parts, number]) {
          const rect = part.getBoundingClientRect();
          expect(rect.left, `${part.className} ${box(rect)}`).toBeGreaterThanOrEqual(button.left);
          expect(rect.right, `${part.className} ${box(rect)}`).toBeLessThanOrEqual(button.right);
        }
        for (const text of textRects(number))
          for (const part of parts)
            for (const drawn of [part.getBoundingClientRect(), ...textRects(part)])
              expect(
                overlap(text, drawn),
                `number ${box(text)} and ${part.className || part.tagName} ${box(drawn)}`,
              ).toBe(false);
      }
    } finally {
      document.fonts.delete(face);
      await resetPage();
    }
  },
);
it("keeps an ordinary receipt number and way paid on one line each at 390 px", async () => {
  const face = await loadPhoneFont();
  try {
    await pageAt(390, 844);
    const { el, host } = await mount(
      answering([
        transactionRow({
          type: "sale",
          tableName: "Table 4",
          customerName: null,
          methods: [{ method: "card", last4: "4821" }],
          staff: { id: "staff-1", name: "Ana" },
          amount: "80.52",
          invoiceNumber: "T-0412",
        }),
      ]),
    );
    host.style.setProperty("--wt-font-family", PHONE_FONT);
    await ready(el);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const lines = (node: Element) =>
      new Set(textRects(node).map((rect) => Math.round(rect.top))).size;
    expect(lines(row(el).querySelector("[data-number]")!)).toBe(1);
    expect(lines(row(el).querySelector("[data-way] .detail")!)).toBe(1);
  } finally {
    document.fonts.delete(face);
    await resetPage();
  }
});
it("names a counter sale by its zone and order number, and a cash payment by its way", async () => {
  const { el } = await mount(
    answering([
      transactionRow({
        type: "sale",
        tableName: null,
        customerName: null,
        zoneName: "Bar",
        orderNumber: 44,
        methods: [{ method: "cash", last4: null }],
        staff: { id: "staff-2", name: "Luis" },
      }),
    ]),
  );
  await ready(el);
  expect(words(row(el).querySelector("[data-place]"))).toBe("Bar · No. 44");
  expect(row(el).querySelector("[data-way] wt-icon")!.getAttribute("name")).toBe("cash");
  expect(words(row(el).querySelector("[data-way]"))).toBe("Cash · Luis");
});
it("labels a full invoice and shows its customer", async () => {
  const { el } = await mount(
    answering([transactionRow({ tableName: "Table 2", customerName: "Garcia Lopez SL" })]),
  );
  await ready(el);
  expect(words(row(el).querySelector("[data-place]"))).toBe("Table 2");
  expect(words(row(el).querySelector("[data-way] [data-tag]"))).toBe("Full invoice");
  expect(words(row(el).querySelector("[data-way]"))).toBe("Full invoice Garcia Lopez SL");
});
it("keeps a refund row's identity, sign and the sale's number, under a Refund label", async () => {
  const refund = transactionRow({
    transactionId: "refund:refund-1",
    refundId: "refund-1",
    type: "refund",
    amount: "-13.75",
  });
  const { el } = await mount(answering([refund]));
  await ready(el);
  const drawn = row(el, "refund:refund-1");
  expect(drawn.querySelector("[data-way] wt-icon")!.getAttribute("name")).toBe("undo");
  expect(words(drawn.querySelector("[data-way] [data-tag]"))).toBe("Refund");
  expect(words(drawn.querySelector("[data-amount]"))).toBe("−€13.75");
  expect(words(drawn.querySelector("[data-number]"))).toBe("F/0012");
  const opened = vi.fn();
  el.addEventListener("find-transaction-open", opened);
  await userEvent.click(drawn);
  expect(opened.mock.calls[0]![0].detail).toEqual({ row: refund });
  setLocale("es-ES");
  await el.updateComplete;
  expect(words(row(el, "refund:refund-1").querySelector("[data-amount]"))).toBe("−13,75 €");
});
it.each([
  ["en-GB", "Cash, card ··5502 · Luis", "Card ··4821, cash, voucher"],
  ["es-ES", "Efectivo, tarjeta ··5502 · Luis", "Tarjeta ··4821, efectivo, vale"],
] as const)(
  "in %s, writes a split payment's later ways of paying in lower case",
  async (language, cashFirst, cardFirst) => {
    const { el } = await mount(
      answering([
        transactionRow({
          transactionId: "split-1",
          type: "sale",
          customerName: null,
          methods: [
            { method: "cash", last4: null },
            { method: "card", last4: "5502" },
          ],
          staff: { id: "staff-2", name: "Luis" },
        }),
        transactionRow({
          transactionId: "split-2",
          type: "sale",
          customerName: null,
          methods: [
            { method: "card", last4: "4821" },
            { method: "cash", last4: null },
            { method: "voucher", last4: null },
          ],
          staff: null,
        }),
      ]),
    );
    setLocale(language);
    await ready(el);
    await el.updateComplete;
    expect(words(row(el, "split-1").querySelector("[data-way] .detail"))).toBe(cashFirst);
    expect(words(row(el, "split-2").querySelector("[data-way] .detail"))).toBe(cardFirst);
  },
);
it.each([
  ["en-GB", "Corrective receipt", "Replacement corrective receipt", "Corrective invoice"],
  [
    "es-ES",
    t("find_page.correction", "es-ES"),
    t("find_page.replacement", "es-ES"),
    "Factura rectificativa",
  ],
] as const)(
  "in %s, labels a corrective receipt %s, a replacement %s and a corrective invoice %s",
  async (language, correction, replacement, invoice) => {
    const { el } = await mount(
      answering([
        transactionRow({ transactionId: "c", type: "correction", amount: "-4.00" }),
        transactionRow({ transactionId: "r", type: "replacement" }),
        transactionRow({ transactionId: "f", type: "full-correction", amount: "-4.00" }),
      ]),
    );
    setLocale(language);
    await ready(el);
    await el.updateComplete;
    const tag = (id: string) => words(row(el, id).querySelector("[data-tag]"));
    expect([tag("c"), tag("r"), tag("f")]).toEqual([correction, replacement, invoice]);
  },
);
it("sets the amount alone on a lifted background when the row matched by its amount", async () => {
  const source = answering([
    transactionRow({ transactionId: "amount", amountMatch: "amount", amount: "80.52" }),
    transactionRow({ transactionId: "payment", amountMatch: "payment", amount: "90.00" }),
  ]);
  const { el } = await mount(source);
  await ready(el);
  await type(el, "80.52");
  await vi.waitFor(() => expect(requests(source.fetcher)).toHaveLength(2));
  await ready(el);
  const highlight = row(el, "amount").querySelectorAll(".hl");
  expect(highlight).toHaveLength(1);
  expect(highlight[0]!.closest("[data-amount]")).not.toBeNull();
  expect(words(highlight[0]!)).toBe("€80.52");
  expect(row(el, "payment").querySelector(".hl")).toBeNull();
  const style = getComputedStyle(highlight[0]!);
  const probe = document.createElement("div");
  probe.style.background = "var(--wt-color-surface-lifted)";
  el.shadowRoot!.appendChild(probe);
  expect(style.backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
  probe.remove();
});
it.each([
  ["", [null], "Newest first"],
  ["Ana", [null, "amount"], "Best match first"],
  ["80.52", ["amount", null], "Matching the amount"],
] as const)("with %j typed, heads the rows %s", async (search, matches, heading) => {
  const { el, fetcher } = await mount(
    answering(
      matches.map((amountMatch, index) =>
        transactionRow({ transactionId: `sale-${index}`, amountMatch }),
      ),
    ),
  );
  await ready(el);
  if (search) {
    await type(el, search);
    await vi.waitFor(() => expect(requests(fetcher)).toHaveLength(2));
    await ready(el);
  }
  expect(words(el.shadowRoot!.querySelector("[data-order-label]"))).toBe(heading);
});
it("hides the refunds under way and the owed bills while a search is typed", async () => {
  const { el } = await mount(
    findBillApi(
      async (url) =>
        json(
          url.pathname.endsWith("options")
            ? billOptions
            : url.pathname === "/api/bills"
              ? listPage([billRow({ partyId: "party-1" }), billRow({ workingOrderId: "c" })], 2)
              : { ...listPage([transactionRow()], 1), dates: resolvedDates },
        ),
      [openCorrection()],
    ),
  );
  await ready(el);
  const sections = () =>
    el.shadowRoot!.querySelectorAll("[data-corrections], [data-owed], [data-counter-orders]");
  await vi.waitFor(() => expect(sections()).toHaveLength(3));
  await type(el, "T3");
  await el.updateComplete;
  expect(sections()).toHaveLength(0);
  await vi.waitFor(() => expect(topBar(el).subtitle).toBe("1 found"));
  await type(el, "");
  await el.updateComplete;
  expect(sections()).toHaveLength(3);
  await vi.waitFor(() => expect(topBar(el).subtitle).toBe("Paid today"));
});
it("Show more appends the next page once, leaving out a sale it already shows", async () => {
  const first = Array.from({ length: 50 }, (_, index) =>
    transactionRow({ transactionId: `sale-${index + 1}` }),
  );
  const source = findBillApi(async (url) =>
    json(
      url.pathname.endsWith("options")
        ? billOptions
        : url.pathname === "/api/bills"
          ? listPage([])
          : {
              ...(url.searchParams.get("page") === "0"
                ? listPage(first, 52, 0)
                : listPage([first[49]!, transactionRow({ transactionId: "sale-51" })], 52, 1)),
              dates: resolvedDates,
            },
    ),
  );
  const { el, fetcher } = await mount(source);
  await ready(el);
  expect(shown(el)).toHaveLength(50);
  const more = el.shadowRoot!.querySelector<HTMLElement>("[data-list-more]")!;
  expect(words(more)).toBe("Show more");
  await userEvent.click(more);
  await vi.waitFor(() => expect(shown(el)).toHaveLength(51));
  expect(shown(el).map((b) => b.dataset.transaction)).toEqual([
    ...first.map((r) => r.transactionId),
    "sale-51",
  ]);
  expect(requests(fetcher).map((url) => url.searchParams.get("page"))).toEqual(["0", "1"]);
  expect(el.shadowRoot!.querySelector("[data-list-more]")).toBeNull();
});
it("leaves 16 px under Show more at the end of the scrolled list", async () => {
  try {
    await pageAt(390, 844);
    const { el, host } = await mount(answering([transactionRow()], 60));
    host.style.blockSize = "600px";
    await ready(el);
    const more = el.shadowRoot!.querySelector<HTMLElement>("[data-list-more]")!;
    const panel = el.shadowRoot!.querySelector("wt-full-screen-panel")!;
    const body = panel.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const content = panel.shadowRoot!.querySelector<HTMLElement>(".content")!;
    body.scrollTop = body.scrollHeight;
    const end = Math.min(
      body.getBoundingClientRect().bottom,
      content.getBoundingClientRect().bottom,
    );
    expect(end - more.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(16);
  } finally {
    await resetPage();
  }
});
it("draws a line between the Days sheet's rows, and none under the last", async () => {
  const { el } = await mount();
  await ready(el);
  const menu = daysMenu(el);
  await menu.updateComplete;
  await userEvent.click(menu.shadowRoot!.querySelector<HTMLElement>('[part="trigger"]')!);
  const rows = [...menu.querySelectorAll<HTMLElement>("[data-preset] > wt-menu-row")];
  await vi.waitFor(() => expect(rows.at(-2)!.hasAttribute("divider")).toBe(true));
  const lines = rows.map((r) => getComputedStyle(r).borderBottomWidth);
  expect(lines).toEqual([...Array(rows.length - 1).fill("1px"), "0px"]);
});
const pagedSale = (n: number) => transactionRow({ transactionId: `sale-${n}` });
/** Pages of two of six sales; page 1 repeats page 0's last sale, as an arrival between reads would. */
const pagedAnswer = (page: number) => ({
  rows:
    page === 0
      ? [pagedSale(1), pagedSale(2)]
      : page === 1
        ? [pagedSale(2), pagedSale(3)]
        : [pagedSale(4), pagedSale(5)],
  total: 6,
  page,
  pageSize: 2,
  dates: resolvedDates,
});
async function showMore(el: Screen, count: number) {
  const more = await vi.waitFor(() => {
    const found = el.shadowRoot!.querySelector<HTMLElement>("[data-list-more]");
    expect(found).not.toBeNull();
    expect(found!.hasAttribute("loading")).toBe(false);
    return found!;
  });
  await userEvent.click(more);
  await vi.waitFor(() => expect(shown(el)).toHaveLength(count));
}
it("a new visit after Show more reads every page shown again in turn, with the same search and days, without repeats", async () => {
  const source = findBillApi(async (url) =>
    json(
      url.pathname.endsWith("options")
        ? billOptions
        : url.pathname === "/api/bills"
          ? listPage([])
          : pagedAnswer(Number(url.searchParams.get("page"))),
    ),
  );
  const { el, fetcher } = await mount(source);
  await ready(el);
  await choose(el, "yesterday");
  await type(el, "fish");
  await vi.waitFor(() => expect(requests(fetcher).at(-1)!.searchParams.get("q")).toBe("fish"));
  await ready(el);
  await showMore(el, 3);
  await showMore(el, 5);
  const ids = ["sale-1", "sale-2", "sale-3", "sale-4", "sale-5"];
  expect(shown(el).map((b) => b.dataset.transaction)).toEqual(ids);
  expect(el.shadowRoot!.querySelector("[data-list-more]")).toBeNull();
  const before = requests(fetcher).length;
  const dates = requests(fetcher).at(-1)!.searchParams.get("preset");
  expect(dates).toBe("yesterday");
  el.active = false;
  await el.updateComplete;
  el.active = true;
  await el.updateComplete;
  await vi.waitFor(() => expect(requests(fetcher).length).toBe(before + 3));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const again = requests(fetcher).slice(before);
  expect(again.map((url) => url.searchParams.get("page"))).toEqual(["0", "1", "2"]);
  for (const url of again) {
    expect(url.searchParams.get("q")).toBe("fish");
    expect(url.searchParams.get("preset")).toBe(dates);
  }
  await vi.waitFor(() => expect(shown(el).map((b) => b.dataset.transaction)).toEqual(ids));
  expect(el.shadowRoot!.querySelector("[data-list-more]")).toBeNull();
});
it("a visit ended while its pages are read again ignores their late answers, and the next visit reads them all again", async () => {
  const pending: {
    page: number;
    resolve: (response: Response) => void;
    signal?: AbortSignal | null;
  }[] = [];
  let hold = false;
  const source = findBillApi(async (url, signal) => {
    if (url.pathname.endsWith("options")) return json(billOptions);
    if (url.pathname === "/api/bills") return json(listPage([]));
    const page = Number(url.searchParams.get("page"));
    if (!hold) return json(pagedAnswer(page));
    return new Promise((resolve) => pending.push({ page, resolve, signal }));
  });
  const { el, fetcher } = await mount(source);
  await ready(el);
  await showMore(el, 3);
  hold = true;
  el.active = false;
  await el.updateComplete;
  el.active = true;
  await el.updateComplete;
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  pending[0]!.resolve(json(pagedAnswer(0)));
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[1]!.page).toBe(1);
  el.active = false;
  await el.updateComplete;
  expect(pending[1]!.signal!.aborted).toBe(true);
  pending[1]!.resolve(json(pagedAnswer(1)));
  await new Promise((resolve) => setTimeout(resolve, 30));
  await el.updateComplete;
  expect(pending).toHaveLength(2);
  hold = false;
  const before = requests(fetcher).length;
  el.active = true;
  await el.updateComplete;
  await vi.waitFor(() => expect(requests(fetcher).length).toBe(before + 2));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(
    requests(fetcher)
      .slice(before)
      .map((url) => url.searchParams.get("page")),
  ).toEqual(["0", "1"]);
  await vi.waitFor(() =>
    expect(shown(el).map((b) => b.dataset.transaction)).toEqual(["sale-1", "sale-2", "sale-3"]),
  );
});
const fiftyOne = Array.from({ length: 51 }, (_, index) => pagedSale(index + 1));
/** Fifty-one sales over two pages; `page1` answers the second page, when given. */
const fiftyOneSource = (page1?: () => Promise<Response>) =>
  findBillApi(async (url) => {
    if (url.pathname.endsWith("options")) return json(billOptions);
    if (url.pathname === "/api/bills") return json(listPage([]));
    if (url.searchParams.get("page") === "0")
      return json({ ...listPage(fiftyOne.slice(0, 50), 51, 0), dates: resolvedDates });
    return page1 ? page1() : json({ ...listPage(fiftyOne.slice(50), 51, 1), dates: resolvedDates });
  });
const scrollerOf = (el: Screen) =>
  el
    .shadowRoot!.querySelector("wt-full-screen-panel")!
    .shadowRoot!.querySelector<HTMLElement>(".body")!;
/** Where row `id` sits in the scroll area, and whether all of it is in view. */
function placed(el: Screen, id: string) {
  const scroller = scrollerOf(el);
  const view = scroller.getBoundingClientRect();
  const drawn = row(el, id).getBoundingClientRect();
  return {
    inView: drawn.top >= view.top && drawn.bottom <= view.bottom,
    seen: `scrollTop ${scroller.scrollTop}, view ${view.top}–${view.bottom}, row ${drawn.top}–${drawn.bottom}`,
  };
}
/** Shows all 51 sales in a 600 px screen and opens the last, scrolled into view to be tapped. */
async function openLastOfFiftyOne(source: ReturnType<typeof findBillApi>) {
  const mounted = await mount(source);
  mounted.host.style.blockSize = "600px";
  await ready(mounted.el);
  await showMore(mounted.el, 51);
  row(mounted.el, "sale-51").scrollIntoView({ block: "center" });
  expect(scrollerOf(mounted.el).scrollTop).toBeGreaterThan(1000);
  await userEvent.click(row(mounted.el, "sale-51"));
  return mounted;
}
async function leaveAndReturn(el: Screen, host: HTMLElement) {
  el.active = false;
  host.hidden = true;
  await el.updateComplete;
  el.active = true;
  host.hidden = false;
  await el.updateComplete;
}
it("keeps a search's count while Show more waits and after Show more fails", async () => {
  let release!: (response: Response) => void;
  const source = fiftyOneSource(() => new Promise<Response>((resolve) => (release = resolve)));
  const { el } = await mount(source);
  await type(el, "fish");
  await vi.waitFor(() => expect(topBar(el).subtitle).toBe("51 found"));
  await userEvent.click(
    await vi.waitFor(() => el.shadowRoot!.querySelector<HTMLElement>("[data-list-more]")!),
  );
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await el.updateComplete;
  expect(topBar(el).subtitle).toBe("51 found");
  release(json({ error: { code: "server.internal" } }, 500));
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-list-error]")).not.toBeNull());
  expect(shown(el)).toHaveLength(50);
  expect(topBar(el).subtitle).toBe("51 found");
});
it("a return from a sale opened after Show more brings that sale back into view, focused", async () => {
  const { el, host } = await openLastOfFiftyOne(fiftyOneSource());
  await leaveAndReturn(el, host);
  await vi.waitFor(() => expect(shown(el)).toHaveLength(51));
  await vi.waitFor(() => {
    const { inView, seen } = placed(el, "sale-51");
    expect(inView, seen).toBe(true);
    expect(el.shadowRoot!.activeElement).toBe(row(el, "sale-51"));
  });
});
it("a return that finds staff already in the search field brings the sale into view and leaves focus there", async () => {
  let holding = false;
  let release!: () => void;
  const source = fiftyOneSource(async () => {
    const answer = json({ ...listPage(fiftyOne.slice(50), 51, 1), dates: resolvedDates });
    if (!holding) return answer;
    await new Promise<void>((resolve) => (release = resolve));
    return answer;
  });
  const { el, host } = await openLastOfFiftyOne(source);
  holding = true;
  await leaveAndReturn(el, host);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const input = searchField(el).shadowRoot!.querySelector("input")!;
  input.focus();
  expect(searchField(el).shadowRoot!.activeElement).toBe(input);
  release();
  await vi.waitFor(() => expect(shown(el)).toHaveLength(51));
  await vi.waitFor(() => {
    const { inView, seen } = placed(el, "sale-51");
    expect(inView, seen).toBe(true);
  });
  expect(el.shadowRoot!.activeElement).toBe(searchField(el));
  expect(searchField(el).shadowRoot!.activeElement).toBe(input);
});
it.each(["a new search", "a new API context"])(
  "a sale opened before %s is not brought back on a later return",
  async (afresh) => {
    const source = fiftyOneSource();
    const { el, host } = await openLastOfFiftyOne(source);
    const before = requests(source.fetcher).length;
    if (afresh === "a new search") await type(el, "fish");
    else el.api = fiftyOneSource().api;
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-list-more]")).not.toBeNull());
    if (afresh === "a new search")
      expect(requests(source.fetcher).at(-1)!.searchParams.get("q")).toBe("fish");
    else expect(requests(source.fetcher)).toHaveLength(before);
    await showMore(el, 51);
    scrollerOf(el).scrollTop = 0;
    await leaveAndReturn(el, host);
    await vi.waitFor(() => {
      expect(shown(el)).toHaveLength(51);
      expect(el.shadowRoot!.querySelector("[data-list-loading]")).toBeNull();
    });
    await el.updateComplete;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(scrollerOf(el).scrollTop).toBe(0);
    expect(el.shadowRoot!.activeElement).toBeNull();
  },
);
it("offers no Show more when every sale is shown, and says when nothing matches", async () => {
  const { el } = await mount(answering([transactionRow()], 1));
  await ready(el);
  expect(el.shadowRoot!.querySelector("[data-list-more]")).toBeNull();
  const empty = await mount(answering([], 0));
  await vi.waitFor(() =>
    expect(words(empty.el.shadowRoot!.querySelector("[data-list-empty]"))).toBe("No results"),
  );
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
  expect(bills).toHaveLength(1);
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
  expect(el.shadowRoot!.querySelector("wt-data-table")).toBeNull();
  expect(shown(el)).toHaveLength(1);
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
    expect(await ready(el)).toHaveLength(1);
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
