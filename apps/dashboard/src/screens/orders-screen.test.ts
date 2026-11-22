import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { NavigationGuard, type WtDataTable } from "@waitron/ui";
import { LiveData, tableNoMatches } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi, OrderRowDto, OrdersPageDto, OrdersPageQuery } from "../api/client.js";
import "./orders-screen.js";
import type { OrdersScreen } from "./orders-screen.js";

const ROW: OrderRowDto = {
  kind: "bill",
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  at: "2026-09-30T12:00:00.000Z",
  orderNumber: 12,
  label: "Lunch",
  partyId: null,
  partyName: null,
  tables: ["Table 5"],
  counter: false,
  saleId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  invoiceNumber: "A/12",
  invoiceType: "F2",
  correctives: ["R/2"],
  status: "left_without_paying",
  credited: "in_part",
  total: "30.00",
  stillOwed: "15.00",
  staff: [{ id: "person-1", name: "Ana" }],
  departedAt: "2026-09-30T13:00:00.000Z",
};
const PAGE: OrdersPageDto = {
  rows: [ROW],
  total: 101,
  page: 0,
  pageSize: 50,
  from: "2026-09-30",
  to: "2026-09-30",
};

function stubApi(overrides: Record<string, unknown> = {}): DashboardApi {
  const api = {
    listOrdersPage: vi.fn().mockResolvedValue(PAGE),
    listOrderStaff: vi.fn().mockResolvedValue({ staff: [{ id: "person-1", name: "Ana" }] }),
    getOrder: vi.fn().mockResolvedValue({
      row: ROW,
      lines: [],
      invoices: [],
      tenders: [],
      payments: [],
      party: null,
      departure: null,
      reprints: [],
    }),
    getOrderPrinters: vi.fn().mockResolvedValue([{ id: "printer-1", name: "Bar printer" }]),
    reprintOrder: vi.fn().mockResolvedValue({ jobId: "job-1" }),
    liveData: new LiveData(),
    ...overrides,
  };
  return {
    ...api,
    background: {
      ...api,
      listOrdersPage: vi
        .fn()
        .mockImplementation(async (query: OrdersPageQuery) => ({ ...PAGE, page: query.page })),
      getOrder: vi.fn().mockResolvedValue({
        row: ROW,
        lines: [],
        invoices: [],
        tenders: [],
        payments: [],
        party: null,
        departure: null,
        reprints: [],
      }),
    },
  } as unknown as DashboardApi;
}

/** A full invoice's detail whose original went to the A4 printer, listed second. */
function fullDetail(row: OrderRowDto) {
  return {
    row,
    lines: [],
    invoices: [],
    tenders: [],
    payments: [],
    party: null,
    departure: null,
    reprints: [],
    invoicePdfDownloads: [],
    deliveries: {
      current: null,
      originalCompleted: true,
      originalPrinterId: "page-1",
      actions: {
        retryOriginal: null,
        print: {
          printers: [
            { id: "printer-1", name: "Bar printer", kind: "receipt" },
            { id: "page-1", name: "Office printer", kind: "a4" },
          ],
          designation: "duplicate",
        },
        receiptInstead: null,
        email: null,
      },
      history: [],
    },
  };
}

async function loaded(api = stubApi()) {
  const { el } = await mountWidget<OrdersScreen>("dashboard-orders-screen", { api });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")?.rows).toHaveLength(1),
  );
  return { el, api };
}

beforeEach(() => {
  setLocale("en-GB");
  history.replaceState(null, "", "/orders");
  sessionStorage.removeItem("waitron.orders.table");
  localStorage.removeItem("waitron.orders.table:columns");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

describe("dashboard Orders", () => {
  it("draws Loading orders until the first page answers", async () => {
    let finish!: (value: OrdersPageDto) => void;
    const first = new Promise<OrdersPageDto>((resolve) => {
      finish = resolve;
    });
    const api = stubApi({ listOrdersPage: vi.fn().mockReturnValue(first) });
    const { el } = await mountWidget<OrdersScreen>("dashboard-orders-screen", { api });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await vi.waitFor(() => expect(api.listOrdersPage).toHaveBeenCalledTimes(1));
    expect(table.shadowRoot!.textContent).toContain("Loading orders");
    finish(PAGE);
    await vi.waitFor(() => expect(table.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(1));
    expect(table.shadowRoot!.textContent).not.toContain("Loading orders");
  });

  it("keeps the status and staff choices readable in the filter bar", async () => {
    const { el } = await loaded();
    for (const name of ["status", "staff"]) {
      const choice = el.shadowRoot!.querySelector<HTMLElement>(`wt-combobox[name=${name}]`)!;
      expect(choice.getBoundingClientRect().width).toBeGreaterThan(140);
    }
  });

  it("draws the staff filter's Anyone choice as a value", async () => {
    const { el } = await loaded();
    const staff = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      'wt-combobox[name="staff"]',
    )!;
    await staff.updateComplete;
    const shown = staff.shadowRoot!.querySelector<HTMLElement>(".trigger .value")!;
    expect(shown.textContent).toBe("Anyone");
    expect(shown.classList.contains("placeholder")).toBe(false);
    expect(getComputedStyle(shown).fontStyle).toBe("normal");
  });

  it("shows a debt's status, credit mark and still owed, with the row menu pinned", async () => {
    const { el } = await loaded();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    expect(table.columns.find((column) => column.key === "actions")?.pinned).toBe("end");
    expect(table.shadowRoot!.textContent).toContain("Left without paying");
    expect(table.shadowRoot!.textContent).toContain("Credited in part");
    expect(table.shadowRoot!.textContent).toContain("€15.00");
  });

  it("places each corrective below its invoice number", async () => {
    const { el } = await loaded();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const invoice = table.shadowRoot!.querySelectorAll("tbody tr td")[3]!;
    expect(invoice.textContent).toContain("A/12");
    expect(
      [...invoice.querySelectorAll("span[part=mark]")].map((mark) => mark.textContent),
    ).toEqual(["R/2"]);
  });

  it.each([
    ["F1", "Full invoice"],
    ["F2", "Simplified invoice"],
  ])("labels a filed %s beside its number", async (invoiceType, label) => {
    const api = stubApi({
      listOrdersPage: vi.fn().mockResolvedValue({
        ...PAGE,
        rows: [{ ...ROW, invoiceType }],
      }),
    });
    const { el } = await loaded(api);
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const invoice = table.shadowRoot!.querySelectorAll("tbody tr td")[3]!;
    expect(invoice.textContent).toContain("A/12");
    expect(invoice.textContent).toContain(label);
  });

  it("keeps dates when choosing Unpaid and writes them into the address", async () => {
    const { el, api } = await loaded();
    const choose = (name: string, value: string) =>
      el
        .shadowRoot!.querySelector(`[name=${name}]`)!
        .dispatchEvent(
          new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
        );
    choose("from", "2026-09-01");
    choose("to", "2026-09-02");
    choose("status", "unpaid");
    await vi.waitFor(() =>
      expect(location.pathname).toBe("/orders/status/unpaid/from/2026-09-01/to/2026-09-02"),
    );
    expect(
      (api.background.listOrdersPage as ReturnType<typeof vi.fn>).mock.lastCall?.[0],
    ).toMatchObject({
      status: "unpaid",
      from: "2026-09-01",
      to: "2026-09-02",
    });
  });

  it("does not send an empty date after one end of a range is cleared", async () => {
    history.replaceState(null, "", "/orders/from/2026-09-01/to/2026-09-02");
    const { el, api } = await loaded();
    const choose = (name: string, value: string) =>
      el
        .shadowRoot!.querySelector(`[name=${name}]`)!
        .dispatchEvent(
          new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
        );
    choose("from", "");
    choose("status", "paid");
    await vi.waitFor(() => expect(api.background.listOrdersPage).toHaveBeenCalled());
    expect(
      (api.background.listOrdersPage as ReturnType<typeof vi.fn>).mock.lastCall?.[0],
    ).toMatchObject({
      status: "paid",
      from: undefined,
      to: undefined,
    });
  });

  it("accepts a paid status from the address and asks the server to apply session scope", async () => {
    history.replaceState(null, "", "/orders/status/paid");
    const { el, api } = await loaded();
    const status = el.shadowRoot!.querySelector<
      HTMLElement & { options: { value: string }[]; value: string }
    >("wt-combobox[name=status]")!;
    expect(status.options.map((option) => option.value)).toContain("paid");
    expect(status.value).toBe("paid");
    expect((api.listOrdersPage as ReturnType<typeof vi.fn>).mock.lastCall?.[0].status).toBe("paid");
  });

  it("requests only the next page and resets it when a filter changes", async () => {
    const { el, api } = await loaded();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    table.dispatchEvent(new CustomEvent("wt-page-change", { detail: { page: 1 } }));
    await vi.waitFor(() =>
      expect(vi.mocked(api.background.listOrdersPage).mock.lastCall?.[0].page).toBe(1),
    );
    expect(api.listOrdersPage).toHaveBeenCalledTimes(1);
    el.shadowRoot!.querySelector("[name=status]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "paid" } }),
    );
    await vi.waitFor(() =>
      expect(vi.mocked(api.background.listOrdersPage).mock.lastCall?.[0]).toMatchObject({
        page: 0,
        status: "paid",
      }),
    );
    expect(table.serverPaging).toMatchObject({ total: 101, pageSize: 50 });
  });

  it("restores the header sort before the first read and sends only supported sorts", async () => {
    sessionStorage.setItem(
      "waitron.orders.table",
      JSON.stringify({ sortKey: "total", sortDirection: "descending" }),
    );
    const { el, api } = await loaded();
    expect(vi.mocked(api.listOrdersPage).mock.calls).toHaveLength(1);
    expect(vi.mocked(api.listOrdersPage).mock.lastCall?.[0]).toMatchObject({
      page: 0,
      sortKey: "total",
      sortDirection: "descending",
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    expect(table.columns.filter((column) => column.sortValue).map((column) => column.key)).toEqual([
      "opened",
      "invoice",
      "total",
    ]);
    table.dispatchEvent(
      new CustomEvent("wt-query-change", {
        detail: { search: "ignored", filters: {}, sortKey: "opened", sortDirection: "ascending" },
      }),
    );
    await vi.waitFor(() =>
      expect(vi.mocked(api.background.listOrdersPage).mock.lastCall?.[0]).toMatchObject({
        sortKey: "opened",
        sortDirection: "ascending",
        q: undefined,
      }),
    );
  });

  it("retries a refused page move and accepts a server-clamped page", async () => {
    const { el, api } = await loaded();
    const read = vi.mocked(api.background.listOrdersPage);
    read
      .mockRejectedValueOnce({ code: "orders.failed" })
      .mockResolvedValue({ ...PAGE, page: 0, total: 1 });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const next = () =>
      table.dispatchEvent(new CustomEvent("wt-page-change", { detail: { page: 1 } }));
    next();
    await vi.waitFor(() => expect(table.errorMessage).not.toBe(""));
    next();
    await vi.waitFor(() => expect(read.mock.calls.map((call) => call[0].page)).toEqual([1, 1, 0]));
    await vi.waitFor(() => expect(table.serverPaging).toMatchObject({ page: 0, total: 1 }));
    expect(table.errorMessage).toBe("");
  });

  it("drops a table edit still waiting to be sent when Back restores an earlier search", async () => {
    history.replaceState(null, "", "/orders/table/Restored");
    history.pushState(null, "", "/orders/table/Current");
    const { el, api } = await loaded();
    const read = vi.mocked(api.background.listOrdersPage);
    const table =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=table]")!;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      table.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Pending" } }));
      const back = new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
      history.back();
      await back;
      vi.advanceTimersByTime(400);
      await el.updateComplete;
    } finally {
      vi.useRealTimers();
    }
    const reads = [...vi.mocked(api.listOrdersPage).mock.calls, ...read.mock.calls];
    expect(reads.map((call) => call[0].table)).toEqual(["Current", "Restored"]);
    expect(table.value).toBe("Restored");
    expect(location.pathname).toBe("/orders/table/Restored");
  });

  it("empties the Table field when Back changes only the status during the field's wait", async () => {
    history.pushState(null, "", "/orders/status/open");
    const { el, api } = await loaded();
    const read = vi.mocked(api.background.listOrdersPage);
    const table =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=table]")!;
    const input = table.shadowRoot!.querySelector("input")!;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      input.value = "4";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
      await el.updateComplete;
      const back = new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
      history.back();
      await back;
      vi.advanceTimersByTime(400);
      await el.updateComplete;
      await table.updateComplete;
    } finally {
      vi.useRealTimers();
    }
    expect(location.pathname).toBe("/orders");
    expect(table.value).toBe("");
    expect(input.value).toBe("");
    const reads = [...vi.mocked(api.listOrdersPage).mock.calls, ...read.mock.calls];
    expect(reads.map((call) => [call[0].status, call[0].table])).toEqual([
      ["open", undefined],
      ["all", undefined],
    ]);
  });

  it("keeps a table edit still waiting to be sent when another filter changes the address first", async () => {
    const guard = new NavigationGuard(window, {
      isDirty: () => false,
      request: async (proceed) => {
        await proceed();
        return "proceeded";
      },
    });
    onTestFinished(() => guard.dispose());
    const { el, api } = await loaded();
    const read = vi.mocked(api.background.listOrdersPage);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      el.shadowRoot!.querySelector("wt-input[name=table]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "Terrace 4" } }),
      );
      el.shadowRoot!.querySelector("[name=status]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "open" } }),
      );
      vi.advanceTimersByTime(400);
      await el.updateComplete;
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(() =>
      expect(read.mock.lastCall?.[0]).toMatchObject({ status: "open", table: "Terrace 4" }),
    );
    expect(location.pathname).toBe("/orders/status/open/table/Terrace%204");
  });

  it("restarts an identical corrected date query after releasing a backwards range", async () => {
    history.replaceState(null, "", "/orders/from/2026-09-01/to/2026-09-02");
    const { el, api } = await loaded();
    const choose = (value: string) =>
      el
        .shadowRoot!.querySelector("[name=to]")!
        .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
    choose("2026-08-01");
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=to]")!.error,
      ).not.toBe(""),
    );
    choose("2026-09-02");
    await vi.waitFor(() => expect(api.background.listOrdersPage).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=to]")!.error,
      ).toBe(""),
    );
  });

  it("uses one 200 ms search timer, flushes Enter and replaces search-only history", async () => {
    const { el, api } = await loaded();
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    const search =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=q]")!;
    const read = vi.mocked(api.background.listOrdersPage);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      search.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "q" } }));
      search.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "quokka " } }));
      await vi.advanceTimersByTimeAsync(199);
      expect(read).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(read).toHaveBeenCalledTimes(1);
      expect(read.mock.lastCall?.[0].q).toBe("quokka ");
      search.value = "quokka";
      search.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "quokka" } }));
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(read).toHaveBeenCalledTimes(2);
      expect(push).not.toHaveBeenCalled();
      expect(replace).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
      push.mockRestore();
      replace.mockRestore();
    }
  });

  it("retains rows while a query loads and ignores its late answer after a newer filter", async () => {
    const { el, api } = await loaded();
    let finish!: (value: OrdersPageDto) => void;
    const late = new Promise<OrdersPageDto>((resolve) => {
      finish = resolve;
    });
    const read = vi.mocked(api.background.listOrdersPage);
    read.mockReturnValueOnce(late).mockResolvedValue({ ...PAGE, rows: [{ ...ROW, id: "newer" }] });
    const status = el.shadowRoot!.querySelector("[name=status]")!;
    const choose = (value: string) =>
      status.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
    const table = el.shadowRoot!.querySelector<WtDataTable<OrderRowDto>>("wt-data-table")!;
    const header = table.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="total"]')!;
    await userEvent.click(header);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(table.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(header.isConnected).toBe(true);
    expect(table.shadowRoot!.activeElement).toBe(header);
    expect(table.rows.map((row) => row.id)).toEqual([ROW.id]);
    choose("open");
    await vi.waitFor(() => expect(table.rows.map((row) => row.id)).toEqual(["newer"]));
    finish({ ...PAGE, rows: [{ ...ROW, id: "stale" }] });
    await late;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(table.rows.map((row) => row.id)).toEqual(["newer"]);
  });

  it("keeps live refreshes on the page returned after the server clamps it", async () => {
    const { el, api } = await loaded();
    const read = vi.mocked(api.background.listOrdersPage);
    let total = 101;
    read.mockImplementation(async (query) => ({
      ...PAGE,
      total,
      page: Math.min(query.page, Math.ceil(total / 50) - 1),
    }));
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    table.dispatchEvent(new CustomEvent("wt-page-change", { detail: { page: 2 } }));
    await vi.waitFor(() => expect(table.serverPaging?.page).toBe(2));
    total = 1;
    api.liveData.refresh();
    await vi.waitFor(() => expect(table.serverPaging?.page).toBe(0));
    await vi.waitFor(() => expect(read.mock.lastCall?.[0].page).toBe(0));
    total = 101;
    api.liveData.refresh();
    await vi.waitFor(() =>
      expect(read.mock.calls.map((call) => call[0].page)).toEqual([2, 2, 0, 0]),
    );
    expect(table.serverPaging?.page).toBe(0);
  });

  it("opens a bill's detail when its row is chosen", async () => {
    const { el, api } = await loaded();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>("tbody .row-activate")!.click();
    await vi.waitFor(() =>
      expect(api.getOrder as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(ROW.id),
    );
    expect(el.shadowRoot!.querySelector("dashboard-order-detail-dialog")?.orderId).toBe(ROW.id);
  });

  it.each([false, true])(
    "tells the bill's detail whether the session may download its PDF (%s)",
    async (canExport) => {
      const api = stubApi();
      const { el } = await mountWidget<OrdersScreen>("dashboard-orders-screen", {
        api,
        canExport,
      });
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("wt-data-table")?.rows).toHaveLength(1),
      );
      expect(el.shadowRoot!.querySelector("dashboard-order-detail-dialog")?.mayExport).toBe(
        canExport,
      );
    },
  );

  it("places a table-filter refusal under Table and says to fix the filter bar", async () => {
    const api = stubApi({
      listOrdersPage: vi
        .fn()
        .mockRejectedValue({ code: "management.request_invalid", params: { field: "table" } }),
    });
    const { el } = await mountWidget<OrdersScreen>("dashboard-orders-screen", {
      api,
    });
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-input[name=table]")
          ?.error,
      ).toContain("100"),
    );
    expect(el.shadowRoot!.querySelector("wt-data-table")?.errorMessage).toBe(
      "Correct the highlighted fields to continue.",
    );
  });

  it.each([
    ["table", "5"],
    ["q", "Lunch"],
  ] as const)(
    "leaves the %s filter unapplied on an Enter that confirms an input method's text (key code 229), and applies it on the next Enter",
    async (name, typed) => {
      const { el, api } = await loaded();
      // Reads after the first go through the passive API.
      const calls = vi.mocked(api.background.listOrdersPage).mock.calls;
      const before = calls.length;
      const box = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
        `wt-input[name=${name}]`,
      )!;
      box.value = typed;
      const enter = (keyCode?: number) => {
        const event = new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          composed: true,
          cancelable: true,
        });
        if (keyCode !== undefined) Object.defineProperty(event, "keyCode", { value: keyCode });
        box.shadowRoot!.querySelector("input")!.dispatchEvent(event);
      };
      enter(229);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(calls).toHaveLength(before);
      enter();
      await vi.waitFor(() => expect(calls.at(-1)![0][name]).toBe(typed));
    },
  );

  it("refreshes changed bills through the passive API", async () => {
    const { api } = await loaded();
    api.liveData.invalidate([{ type: "working_orders", id: ROW.id }]);
    await vi.waitFor(() => expect(api.background.listOrdersPage).toHaveBeenCalled());
    expect(api.listOrdersPage).toHaveBeenCalledTimes(1);
  });

  it("opens a printer picker from a bill's detail", async () => {
    const { el, api } = await loaded();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>("tbody .row-activate")!.click();
    const detail = el.shadowRoot!.querySelector("dashboard-order-detail-dialog")!;
    await vi.waitFor(() => expect(detail.shadowRoot!.querySelector("wt-button")).not.toBeNull());
    detail.shadowRoot!.querySelector<HTMLElement>("wt-button")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("dashboard-order-reprint-dialog")?.row?.id).toBe(ROW.id),
    );
    expect(api.getOrderPrinters).toHaveBeenCalled();
  });

  it("keeps an open printer picker when a refresh removes the bill from the list", async () => {
    const { el, api } = await loaded();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector("wt-row-actions")!.querySelectorAll("wt-button")[1]!.click();
    const picker = el.shadowRoot!.querySelector("dashboard-order-reprint-dialog")!;
    await vi.waitFor(() =>
      expect(picker.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1"),
    );
    (api.background.listOrdersPage as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...PAGE,
      rows: [],
    });
    api.liveData.invalidate([{ type: "working_orders", id: ROW.id }]);
    await vi.waitFor(() => expect(table.rows).toHaveLength(0));
    expect(picker.row?.id).toBe(ROW.id);
    expect(picker.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
  });

  it("keeps the sent confirmation when a refresh replaces the bill object", async () => {
    const { el, api } = await loaded();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector("wt-row-actions")!.querySelectorAll("wt-button")[1]!.click();
    const picker = el.shadowRoot!.querySelector("dashboard-order-reprint-dialog")!;
    await vi.waitFor(() =>
      expect(picker.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1"),
    );
    picker.shadowRoot!.querySelector<HTMLElement>("[data-test=print]")!.click();
    await vi.waitFor(() =>
      expect(picker.shadowRoot!.textContent).toContain("Copy sent to Bar printer"),
    );
    (api.background.listOrdersPage as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...PAGE,
      rows: [{ ...ROW }],
    });
    api.liveData.invalidate([{ type: "working_orders", id: ROW.id }]);
    await vi.waitFor(() => expect(api.background.listOrdersPage).toHaveBeenCalled());
    expect(picker.shadowRoot!.textContent).toContain("Copy sent to Bar printer");
    expect(api.getOrderPrinters).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a simplified invoice", "F2", ["View details", "Print / Reprint"]],
    ["a full invoice", "F1", ["View details", "Print / Reprint"]],
  ] as const)("offers the row menu's own print action for %s", async (_name, type, labels) => {
    const row = { ...ROW, invoiceType: type };
    const api = stubApi({ listOrdersPage: vi.fn().mockResolvedValue({ ...PAGE, rows: [row] }) });
    const { el } = await loaded(api);
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const actions = table.shadowRoot!.querySelector("wt-row-actions")!;
    expect(
      [...actions.querySelectorAll("wt-button")].map((button) => button.textContent?.trim()),
    ).toEqual(labels);
  });

  it("opens a full invoice's printer list from its detail, in invoice mode, with no Reprint receipt", async () => {
    const full = { ...ROW, invoiceType: "F1" as const };
    const detail = {
      row: full,
      lines: [],
      invoices: [],
      tenders: [],
      payments: [],
      party: null,
      departure: null,
      reprints: [],
      invoicePdfDownloads: [],
      deliveries: {
        current: null,
        originalCompleted: true,
        originalPrinterId: "page-1",
        actions: {
          retryOriginal: null,
          print: {
            printers: [
              { id: "printer-1", name: "Bar printer", kind: "receipt" },
              { id: "page-1", name: "Office printer", kind: "a4" },
            ],
            designation: "duplicate",
          },
          receiptInstead: null,
          email: null,
        },
        history: [],
      },
    };
    const api = stubApi({
      listOrdersPage: vi.fn().mockResolvedValue({ ...PAGE, rows: [full] }),
      getOrder: vi.fn().mockResolvedValue(detail),
    });
    const { el } = await loaded(api);
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>("tbody .row-activate")!.click();
    const opened = el.shadowRoot!.querySelector("dashboard-order-detail-dialog")!;
    await vi.waitFor(() =>
      expect(opened.shadowRoot!.querySelector("[data-test=print-invoice]")).not.toBeNull(),
    );
    expect(
      [...opened.shadowRoot!.querySelectorAll("wt-form-actions wt-button")].map((button) =>
        button.textContent?.trim(),
      ),
    ).toEqual(["Print / Reprint"]);
    opened.shadowRoot!.querySelector<HTMLElement>("[data-test=print-invoice]")!.click();
    const picker = el.shadowRoot!.querySelector("dashboard-order-reprint-dialog")!;
    await vi.waitFor(() => expect(picker.row?.id).toBe(ROW.id));
    expect(picker.mode).toBe("choose");
    await vi.waitFor(() =>
      expect(picker.shadowRoot!.querySelector("[name=document]")).not.toBeNull(),
    );
    expect(api.getOrderPrinters).not.toHaveBeenCalled();
  });

  it.each(["en-GB", "es-ES"] as const)(
    "opens a full invoice's printer list in invoice mode from its row menu (%s)",
    async (locale) => {
      setLocale(locale);
      const full = { ...ROW, invoiceType: "F1" as const };
      const api = stubApi({
        listOrdersPage: vi.fn().mockResolvedValue({ ...PAGE, rows: [full] }),
        getOrder: vi.fn().mockResolvedValue(fullDetail(full)),
      });
      const { el } = await loaded(api);
      const table = el.shadowRoot!.querySelector("wt-data-table")!;
      await table.updateComplete;
      const print = table
        .shadowRoot!.querySelector("wt-row-actions")!
        .querySelectorAll("wt-button")[1]!;
      expect(print.textContent?.trim()).toBe(
        locale === "en-GB" ? "Print / Reprint" : "Imprimir / Reimprimir",
      );
      print.click();
      const picker = el.shadowRoot!.querySelector("dashboard-order-reprint-dialog")!;
      await vi.waitFor(() => expect(picker.row?.id).toBe(ROW.id));
      expect(picker.mode).toBe("choose");
      await vi.waitFor(() =>
        expect(picker.shadowRoot!.querySelector("[name=document]")).not.toBeNull(),
      );
      expect(api.getOrderPrinters).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a full invoice's Print a copy", "F1", "[data-test=print-invoice]", "choose"],
    ["a simplified invoice's Reprint receipt", "F2", "wt-form-actions wt-button", "receipt"],
  ] as const)(
    "opens %s from the detail after a refresh took the bill off the list",
    async (_name, type, button, mode) => {
      const shown = { ...ROW, invoiceType: type };
      const detail =
        type === "F1"
          ? fullDetail(shown)
          : {
              row: shown,
              lines: [],
              invoices: [],
              tenders: [],
              payments: [],
              party: null,
              departure: null,
              reprints: [],
              invoicePdfDownloads: [],
              deliveries: null,
            };
      const api = stubApi({
        listOrdersPage: vi.fn().mockResolvedValue({ ...PAGE, rows: [shown] }),
        getOrder: vi.fn().mockResolvedValue(detail),
      });
      (api.background.getOrder as ReturnType<typeof vi.fn>).mockResolvedValue(detail);
      const { el } = await loaded(api);
      const table = el.shadowRoot!.querySelector("wt-data-table")!;
      await table.updateComplete;
      table.shadowRoot!.querySelector<HTMLElement>("tbody .row-activate")!.click();
      const opened = el.shadowRoot!.querySelector("dashboard-order-detail-dialog")!;
      await vi.waitFor(() => expect(opened.shadowRoot!.querySelector(button)).not.toBeNull());
      (api.background.listOrdersPage as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...PAGE,
        rows: [],
      });
      api.liveData.invalidate([{ type: "working_orders", id: ROW.id }]);
      await vi.waitFor(() => expect(table.rows).toHaveLength(0));
      opened.shadowRoot!.querySelector<HTMLElement>(button)!.click();
      const picker = el.shadowRoot!.querySelector("dashboard-order-reprint-dialog")!;
      await vi.waitFor(() => expect(picker.row?.id).toBe(ROW.id));
      expect(picker.row?.invoiceNumber).toBe(ROW.invoiceNumber);
      expect(picker.mode).toBe(mode);
      expect(picker.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
    },
  );

  it("opens a simplified invoice's reprint in receipt mode", async () => {
    const { el } = await loaded();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector("wt-row-actions")!.querySelectorAll("wt-button")[1]!.click();
    const picker = el.shadowRoot!.querySelector("dashboard-order-reprint-dialog")!;
    await vi.waitFor(() => expect(picker.row?.id).toBe(ROW.id));
    expect(picker.mode).toBe("receipt");
  });

  it.each([
    ["an invoice without a bill", { ...ROW, kind: "sale" as const }],
    ["a bill without an invoice", { ...ROW, invoiceNumber: null, invoiceType: null }],
  ])("does not offer reprint for %s", async (_name, row) => {
    const api = stubApi({ listOrdersPage: vi.fn().mockResolvedValue({ ...PAGE, rows: [row] }) });
    const { el } = await loaded(api);
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const actions = table.shadowRoot!.querySelector("wt-row-actions")!;
    expect(
      [...actions.querySelectorAll("wt-button")].map((button) => button.textContent?.trim()),
    ).toEqual(["View details"]);
  });

  it("shows statuses and table headings in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await loaded();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    expect(table.shadowRoot!.textContent).toContain("Se fueron sin pagar");
    expect(table.shadowRoot!.textContent).toContain("Pendiente");
  });

  it.each(["en-GB", "es-ES"])(
    "says the dashboard's one no-matches sentence when the search and filters find no bill (%s)",
    async (locale) => {
      setLocale(locale);
      const empty = { ...PAGE, rows: [], total: 0 };
      const api = stubApi({ listOrdersPage: vi.fn().mockResolvedValue(empty) });
      const { el } = await mountWidget<OrdersScreen>("dashboard-orders-screen", { api });
      const table = el.shadowRoot!.querySelector("wt-data-table")!;
      await vi.waitFor(() =>
        expect(table.shadowRoot!.querySelector(".empty .message")?.textContent).toBe(
          tableNoMatches(locale),
        ),
      );
    },
  );

  it("waits for a pause before searching a table name", async () => {
    const { el, api } = await loaded();
    el.shadowRoot!.querySelector("wt-input[name=table]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Table 5" }, bubbles: true, composed: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(api.listOrdersPage).toHaveBeenCalledTimes(1);
    expect(api.background.listOrdersPage).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(
        (api.background.listOrdersPage as ReturnType<typeof vi.fn>).mock.lastCall?.[0].table,
      ).toBe("Table 5"),
    );
  });

  it("sends a search with its trailing space, and spaces alone as no search", async () => {
    const { el, api } = await loaded();
    const type = (value: string) =>
      el
        .shadowRoot!.querySelector("wt-input[name=q]")!
        .dispatchEvent(
          new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
        );
    const lastQ = () =>
      (api.background.listOrdersPage as ReturnType<typeof vi.fn>).mock.lastCall?.[0].q;
    type("gin ");
    await vi.waitFor(() => expect(lastQ()).toBe("gin "));
    type("   ");
    await vi.waitFor(() => {
      expect(
        (api.background.listOrdersPage as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(1);
      expect(lastQ()).toBeUndefined();
    });
  });

  it("shows a backwards range under To without sending the invalid range", async () => {
    const { el, api } = await loaded();
    const choose = (name: string, value: string) =>
      el
        .shadowRoot!.querySelector(`[name=${name}]`)!
        .dispatchEvent(
          new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
        );
    choose("from", "2026-09-30");
    choose("to", "2026-09-01");
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-input[name=to]")?.error,
      ).toContain("on or after"),
    );
    expect(api.background.listOrdersPage).not.toHaveBeenCalled();
  });

  it("keeps a paid bill's earlier departure visible", async () => {
    const paid = { ...ROW, status: "paid" as const, stillOwed: null };
    const api = stubApi({ listOrdersPage: vi.fn().mockResolvedValue({ ...PAGE, rows: [paid] }) });
    const { el } = await loaded(api);
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    expect(table.shadowRoot!.textContent).toContain("Left without paying on");
  });

  it("names a bill closed as a deferred payment and keeps its earlier departure visible", async () => {
    const closed = { ...ROW, status: "deferred_payment" as const, stillOwed: null };
    const api = stubApi({ listOrdersPage: vi.fn().mockResolvedValue({ ...PAGE, rows: [closed] }) });
    const { el } = await loaded(api);
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    expect(table.shadowRoot!.textContent).toContain("Deferred payment");
    expect(table.shadowRoot!.textContent).toContain("Left without paying on");
  });

  describe("finding a customer by tax number", () => {
    const findButton = (el: OrdersScreen) =>
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=find-invoice-customer]");
    const dialog = (el: OrdersScreen) =>
      el.shadowRoot!.querySelector("dashboard-invoice-customer-dialog")!;

    it("offers no button without the personal-data export permission", async () => {
      const { el } = await loaded();
      expect(findButton(el)).toBeNull();
      expect(dialog(el).open).toBe(false);
    });

    it("opens the dialog from the button, and closes it when the dialog closes", async () => {
      const { el, api } = await loaded();
      el.canExportPersonalData = true;
      await el.updateComplete;
      const button = findButton(el)!;
      expect(button.textContent).toBe("Find an invoice customer");
      expect(dialog(el).open).toBe(false);

      button.click();
      await el.updateComplete;
      expect(dialog(el).open).toBe(true);
      expect(dialog(el).api).toBe(api);

      dialog(el).dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
      await el.updateComplete;
      expect(dialog(el).open).toBe(false);
    });
  });
});
