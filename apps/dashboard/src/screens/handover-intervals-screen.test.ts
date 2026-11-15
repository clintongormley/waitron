import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type {
  ReturnedInvoicesQuery,
  ReturnedInvoices,
  ReturnedInvoiceRecord,
} from "../api/client.js";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import { HandoverIntervalsScreen } from "./handover-intervals-screen.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  sessionStorage.removeItem("waitron.returned-invoices.table");
  setLocale(locale);
});
const invoice: ReturnedInvoiceRecord = {
  recordId: "original",
  saleId: "sale",
  sourceName: "Old box",
  sourceNodeId: "old",
  generationId: "chain",
  installation: "ABCDE",
  sequence: 12,
  invoiceNumber: "A/42",
  issueDate: "2026-07-20",
  kind: "F2",
  category: "simplified",
  correctsRecordId: null,
  taxable: "0.30",
  gross: "0.33",
  tax: "0.03",
  receivedAt: "2026-07-21T23:30:00Z",
};
const invoicePage = {
  rows: [invoice],
  page: 0,
  pageSize: 50,
  total: 101,
  timeZone: "Europe/Madrid",
};
const row = {
  operationId: "op",
  inventoryReceived: true,
  sourceName: "Kitchen box",
  destinationName: "Counter box",
  lastChangeAtMs: Date.parse("2026-11-10T09:50:00Z"),
  declaredAtMs: Date.parse("2026-11-10T10:00:00Z"),
  activatedAt: "2026-11-10T09:59:00Z",
  reason: "Power failure",
};

it("keeps loading, empty, failure and retry distinct", async () => {
  setLocale("en-GB");
  let resolve!: (value: unknown) => void;
  const listHandoverIntervals = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockRejectedValueOnce({ code: "report.failed" })
    .mockResolvedValue({ intervals: [row], timeZone: "Europe/Madrid" });
  const { el } = await mountWidget<HandoverIntervalsScreen>("dashboard-handover-intervals-screen", {
    api: {
      listHandoverIntervals,
      listReturnedInvoices: async () => ({
        rows: [],
        total: 0,
        page: 0,
        pageSize: 50,
        timeZone: "Europe/Madrid",
      }),
    } as unknown as DashboardApi,
  });
  await vi.waitFor(() => expect(el.shadowRoot?.querySelector("wt-data-table")?.loading).toBe(true));
  resolve({ intervals: [], timeZone: "Europe/Madrid" });
  await vi.waitFor(() =>
    expect(el.shadowRoot?.querySelector("wt-data-table")?.emptyMessage).toBe(
      en["handover_intervals.empty"],
    ),
  );
  await userEvent.click(el.shadowRoot!.querySelector("wt-button")!);
  await vi.waitFor(() =>
    expect(el.shadowRoot?.querySelector("wt-data-table")?.errorMessage).toBeTruthy(),
  );
  expect(el.shadowRoot!.querySelector("wt-data-table")!.emptyMessage).toBe("");
  await userEvent.click(el.shadowRoot!.querySelector("wt-button")!);
  await vi.waitFor(() =>
    expect(el.shadowRoot?.querySelector("wt-data-table")?.rows).toEqual([row]),
  );
  expect(el.shadowRoot!.querySelector("wt-data-table")!.errorMessage).toBe("");
});

it.each([
  ["en-GB", en],
  ["es-ES", es],
] as const)(
  "labels each clock in the venue zone, with backwards dates and unknown activity (%s)",
  async (language, words) => {
    setLocale(language);
    const { el } = await mountWidget<HandoverIntervalsScreen>(
      "dashboard-handover-intervals-screen",
      {
        api: {
          listReturnedInvoices: async () => ({
            rows: [],
            total: 0,
            page: 0,
            pageSize: 50,
            timeZone: "Europe/Madrid",
          }),
          listHandoverIntervals: async () => ({
            intervals: [
              row,
              { ...row, operationId: "unknown", inventoryReceived: false, lastChangeAtMs: null },
            ],
            timeZone: "Europe/Madrid",
          }),
        } as unknown as DashboardApi,
      },
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("wt-data-table")?.rows).toHaveLength(2),
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const text = table.shadowRoot!.textContent!;
    for (const key of ["copy", "declared", "activated"] as const)
      expect(text).toContain(words[`handover_intervals.${key}`]);
    for (const value of [
      "Kitchen box",
      "Counter box",
      "Power failure",
      "10:50",
      "11:00",
      "10:59",
      words["handover_intervals.unknown"],
      words["handover_intervals.received"],
      words["handover_intervals.not_received"],
    ])
      expect(text).toContain(value);
    expect(el.shadowRoot!.textContent).toContain("Europe/Madrid");
    expect(el.shadowRoot!.textContent).toContain(words["handover_intervals.unconfirmed"]);
    expect(el.shadowRoot!.querySelector("a")!.getAttribute("href")).toBe(
      `/help/${language.startsWith("es") ? "es" : "en"}/servers#reconciliation`,
    );
  },
);

it("loads returned invoices independently and pages, retries and refreshes to zero", async () => {
  setLocale("en-GB");
  let resolve!: (value: unknown) => void;
  const listReturnedInvoices = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockRejectedValueOnce({ code: "report.failed" })
    .mockResolvedValueOnce(invoicePage)
    .mockResolvedValueOnce({
      ...invoicePage,
      rows: [{ ...invoice, recordId: "next" }],
      page: 1,
      total: 51,
      timeZone: "Europe/Madrid",
    })
    .mockImplementation(async (query: ReturnedInvoicesQuery) => ({
      ...invoicePage,
      page: query.page,
    }));
  const { el } = await mountWidget<HandoverIntervalsScreen>("dashboard-handover-intervals-screen", {
    api: {
      listHandoverIntervals: async () => ({ intervals: [], timeZone: "Europe/Madrid" }),
      listReturnedInvoices,
    } as unknown as DashboardApi,
  });
  const table = () => el.shadowRoot!.querySelectorAll("wt-data-table")[1]!;
  await vi.waitFor(() => expect(table()?.loading).toBe(true));
  resolve({ ...invoicePage, rows: [], total: 0 });
  await vi.waitFor(() => expect(table().emptyMessage).toBe(en["returned_invoices.empty"]));
  const click = async (action: string) =>
    userEvent.click(
      action === "refresh"
        ? el.shadowRoot!.querySelector('[data-invoices="refresh"]')!
        : table().shadowRoot!.querySelector(`button[data-${action}-page]`)!,
    );
  await click("refresh");
  await vi.waitFor(() => expect(table().errorMessage).toBeTruthy());
  expect(table().emptyMessage).toBe("");
  await click("refresh");
  await vi.waitFor(() => expect(table().rows).toEqual([invoice]));
  expect(table().shadowRoot!.textContent).toContain("Simplified invoice");
  expect(table().shadowRoot!.textContent).toContain("F2");
  expect(table().shadowRoot!.textContent).toContain("2026-07-20");
  expect(table().shadowRoot!.textContent).toContain("01:30");
  await click("next");
  await vi.waitFor(() => expect(table().rows[0]).toMatchObject({ recordId: "next" }));
  expect(
    table().shadowRoot!.querySelector<HTMLButtonElement>("button[data-next-page]")!.disabled,
  ).toBe(true);
  await click("previous");
  await vi.waitFor(() => expect(table().rows).toEqual([invoice]));
  await click("next");
  await vi.waitFor(() => expect(listReturnedInvoices).toHaveBeenCalledTimes(6));
  await click("refresh");
  await vi.waitFor(() => expect(listReturnedInvoices).toHaveBeenCalledTimes(7));
  expect(listReturnedInvoices.mock.calls.map(([query]) => query.page)).toEqual([
    0, 0, 0, 1, 0, 1, 0,
  ]);
});

it("restores Received before reading, debounces search and keeps rows and header focus while newer replies replace stale ones", async () => {
  setLocale("en-GB");
  sessionStorage.setItem(
    "waitron.returned-invoices.table",
    JSON.stringify({ sortKey: "receivedAt", sortDirection: "ascending" }),
  );
  let finish!: (value: ReturnedInvoices) => void;
  const late = new Promise<ReturnedInvoices>((resolve) => {
    finish = resolve;
  });
  const read = vi
    .fn()
    .mockResolvedValueOnce(invoicePage)
    .mockReturnValueOnce(late)
    .mockResolvedValue({ ...invoicePage, rows: [{ ...invoice, recordId: "newer" }] });
  const { el } = await mountWidget<HandoverIntervalsScreen>("dashboard-handover-intervals-screen", {
    api: {
      listHandoverIntervals: async () => {
        throw { code: "report.failed" };
      },
      listReturnedInvoices: read,
    } as unknown as DashboardApi,
  });
  const table = el.shadowRoot!.querySelectorAll("wt-data-table")[1]!;
  await vi.waitFor(() => expect(table.rows).toEqual([invoice]));
  expect(read.mock.calls.map(([q]) => q)).toEqual([
    { search: "", page: 0, sortKey: "receivedAt", sortDirection: "ascending" },
  ]);
  expect(table.columns.filter((c) => c.sortValue).map((c) => c.key)).toEqual(["receivedAt"]);
  const header = table.shadowRoot!.querySelector<HTMLButtonElement>(
    'button[data-sort="receivedAt"]',
  )!;
  await userEvent.click(header);
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  expect(table.loading).toBe(false);
  expect(table.rows).toEqual([invoice]);
  expect(table.shadowRoot!.activeElement).toBe(header);
  const input = table.shadowRoot!.querySelector<HTMLInputElement>('input[type="search"]')!;
  input.value = "A/42 ";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  expect(read).toHaveBeenCalledTimes(2);
  await vi.waitFor(() => expect(table.rows[0]).toMatchObject({ recordId: "newer" }));
  expect(read.mock.lastCall![0]).toMatchObject({
    search: "A/42 ",
    page: 0,
    sortDirection: "descending",
  });
  finish({ ...invoicePage, rows: [{ ...invoice, recordId: "stale" }] });
  await late;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(table.rows[0]).toMatchObject({ recordId: "newer" });
  expect(el.shadowRoot!.querySelector("wt-data-table")!.errorMessage).not.toBe("");
});

it("retries a refused move and keeps live refresh on the server-corrected page as totals grow again", async () => {
  let total = 101;
  const read = vi.fn(async (query: ReturnedInvoicesQuery) => ({
    ...invoicePage,
    total,
    page: Math.min(query.page, Math.ceil(total / 50) - 1),
  }));
  const liveData = new LiveData();
  const { el } = await mountWidget<HandoverIntervalsScreen>("dashboard-handover-intervals-screen", {
    api: {
      liveData,
      listReturnedInvoices: read,
      listHandoverIntervals: async () => ({ intervals: [], timeZone: "Europe/Madrid" }),
    } as unknown as DashboardApi,
  });
  const table = el.shadowRoot!.querySelectorAll("wt-data-table")[1]!;
  await vi.waitFor(() => expect(table.rows).toEqual([invoice]));
  read.mockRejectedValueOnce({ code: "report.failed" });
  const next = () =>
    table.dispatchEvent(new CustomEvent("wt-page-change", { detail: { page: 2 } }));
  next();
  await vi.waitFor(() => expect(table.errorMessage).not.toBe(""));
  next();
  await vi.waitFor(() => expect(table.serverPaging?.page).toBe(2));
  expect(read.mock.calls.map(([q]) => q.page)).toEqual([0, 2, 2]);
  total = 1;
  liveData.refresh();
  await vi.waitFor(() => expect(table.serverPaging?.page).toBe(0));
  await vi.waitFor(() => expect(read.mock.lastCall![0].page).toBe(0));
  total = 101;
  liveData.refresh();
  await vi.waitFor(() => expect(read.mock.calls.map(([q]) => q.page)).toEqual([0, 2, 2, 2, 0, 0]));
  expect(table.serverPaging?.page).toBe(0);
  table.dispatchEvent(new CustomEvent("wt-page-change", { detail: { page: 1 } }));
  await vi.waitFor(() => expect(table.serverPaging?.page).toBe(1));
  vi.useFakeTimers();
  try {
    const input = table.shadowRoot!.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = "A/42 ";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await table.updateComplete;
    table.dispatchEvent(new CustomEvent("wt-page-change", { detail: { page: 2 } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(read.mock.lastCall![0]).toMatchObject({ page: 0, search: "A/42 " });
  } finally {
    vi.useRealTimers();
  }
});

it("flushes a pending search on Enter without a second debounced request", async () => {
  const read = vi.fn().mockResolvedValue(invoicePage);
  const { el } = await mountWidget<HandoverIntervalsScreen>("dashboard-handover-intervals-screen", {
    api: {
      listReturnedInvoices: read,
      listHandoverIntervals: async () => ({ intervals: [], timeZone: "Europe/Madrid" }),
    } as unknown as DashboardApi,
  });
  const table = el.shadowRoot!.querySelectorAll("wt-data-table")[1]!;
  await vi.waitFor(() => expect(table.rows).toEqual([invoice]));
  vi.useFakeTimers();
  try {
    const input = table.shadowRoot!.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = "A/42 ";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await table.updateComplete;
    await el.updateComplete;
    expect(read).toHaveBeenCalledTimes(1);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.lastCall![0].search).toBe("A/42 ");
    await vi.advanceTimersByTimeAsync(200);
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
