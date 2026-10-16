import { describe, expect, it, vi } from "vitest";
import { TillApi } from "./client.js";
import type { BillRow, BillsQuery, TransactionsQuery } from "./find-bill-types.js";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const billsQuery: BillsQuery = {
  q: "0091 & Ruiz ",
  page: 1,
  sort: { key: "total", direction: "ascending" },
  zoneId: "zone-1",
  staffId: "staff-1",
  state: "part-paid",
};
const transactionsQuery: TransactionsQuery = {
  q: "T1/12 ",
  page: 2,
  sort: { key: "invoice", direction: "descending" },
  dates: { preset: "custom", from: "2026-10-01", to: "2026-10-15" },
  method: "card",
  type: "full-invoice",
  staffId: "staff-2",
};

describe("Find a bill client", () => {
  it("sends the Bills server query without losing trailing spaces or leading zero digits", async () => {
    const result = { rows: [], page: 1, pageSize: 50, total: 0, openCount: 19 };
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(response(result)));
    const signal = new AbortController().signal;
    const api = new TillApi("", fetchStub);
    expect(api.listBills).toBeTypeOf("function");
    expect(await api.listBills(billsQuery, { signal })).toEqual(result);
    const [url, init] = fetchStub.mock.calls[0]!;
    const parsed = new URL(String(url), location.origin);
    expect(parsed.pathname).toBe("/api/bills");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      q: "0091 & Ruiz ",
      page: "1",
      sort: "total",
      direction: "ascending",
      zoneId: "zone-1",
      staffId: "staff-1",
      state: "part-paid",
    });
    expect(init).toEqual({ method: "GET", credentials: "include", signal });
  });
  it("encodes custom Transactions dates and every tab-specific filter", async () => {
    const result = {
      rows: [],
      total: 200,
      page: 2,
      pageSize: 50,
      openCount: 7,
      dates: {
        startAt: "2026-09-30T22:00:00.000Z",
        endAt: "2026-10-15T22:00:00.000Z",
        from: "2026-10-01",
        to: "2026-10-15",
      },
    };
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(response(result)));
    const signal = new AbortController().signal;
    const api = new TillApi("", fetchStub);
    expect(api.listTransactions).toBeTypeOf("function");
    expect(await api.listTransactions(transactionsQuery, { signal })).toEqual(result);
    const parsed = new URL(String(fetchStub.mock.calls[0]![0]), location.origin);
    expect(parsed.pathname).toBe("/api/transactions");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      q: "T1/12 ",
      page: "2",
      sort: "invoice",
      direction: "descending",
      preset: "custom",
      from: "2026-10-01",
      to: "2026-10-15",
      method: "card",
      type: "full-invoice",
      staffId: "staff-2",
    });
    expect(fetchStub.mock.calls[0]![1]).toEqual({ method: "GET", credentials: "include", signal });
  });
  it("leaves absent filters out and serializes a preset without custom date fields", async () => {
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(
          response({ rows: [], page: 0, pageSize: 50, total: 0, openCount: 0, dates: null }),
        ),
      );
    const api = new TillApi("", fetchStub);
    expect(api.listTransactions).toBeTypeOf("function");
    await api.listTransactions({
      q: "",
      page: 0,
      sort: { key: "when", direction: "descending" },
      dates: { preset: "any" },
    });
    expect(
      Object.fromEntries(
        new URL(String(fetchStub.mock.calls[0]![0]), location.origin).searchParams,
      ),
    ).toEqual({ q: "", page: "0", sort: "when", direction: "descending", preset: "any" });
    await api.listBills({ q: "", page: 0, sort: { key: "openedAt", direction: "descending" } });
    expect(
      Object.fromEntries(
        new URL(String(fetchStub.mock.calls[1]![0]), location.origin).searchParams,
      ),
    ).toEqual({ q: "", page: "0", sort: "openedAt", direction: "descending" });
  });
  it("reads fresh selection and options with the caller's abort signal", async () => {
    const row: BillRow = {
      workingOrderId: "order-1",
      openedAt: "2026-10-15T12:00:00.000Z",
      orderNumber: 1,
      label: null,
      partyId: null,
      partyName: null,
      tables: [],
      zoneId: null,
      zoneName: null,
      staff: [],
      itemCount: 1,
      total: "12.10",
      paid: "2.00",
      stillOwed: "10.10",
      state: "part-paid",
      earlierDay: false,
      invoiceNumber: null,
      departedAt: null,
      orderStatus: "open",
      collectionStatus: null,
    };
    const choices = {
      zones: [{ id: "zone-1", name: "Counter" }],
      timeZone: "Europe/Madrid",
      billStaff: [{ id: "staff-1", name: "Ana" }],
      transactionStaff: [],
    };
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockImplementation((url) =>
        Promise.resolve(response(String(url).endsWith("/options") ? choices : row)),
      );
    const api = new TillApi("", fetchStub);
    const signal = new AbortController().signal;
    expect(api.getFindBill).toBeTypeOf("function");
    expect(api.findBillOptions).toBeTypeOf("function");
    expect(await api.getFindBill("order/one", { signal })).toEqual(row);
    expect(await api.findBillOptions({ signal })).toEqual(choices);
    expect(fetchStub.mock.calls).toEqual([
      ["/api/bills/order%2Fone", { method: "GET", credentials: "include", signal }],
      ["/api/find-bill/options", { method: "GET", credentials: "include", signal }],
    ]);
  });
  it.each(["bills", "transactions", "selection", "options"] as const)(
    "preserves HTTP/domain refusal on %s",
    async (which) => {
      const fetchStub = vi
        .fn<typeof fetch>()
        .mockImplementation(() =>
          Promise.resolve(response({ error: { code: "session.required", params: {} } }, 401)),
        );
      const api = new TillApi("", fetchStub);
      expect(api.listBills).toBeTypeOf("function");
      const read =
        which === "bills"
          ? () => api.listBills(billsQuery)
          : which === "transactions"
            ? () => api.listTransactions(transactionsQuery)
            : which === "selection"
              ? () => api.getFindBill("order-1")
              : () => api.findBillOptions();
      await expect(read()).rejects.toMatchObject({ code: "session.required", status: 401 });
    },
  );
});
it("reads a historical receipt by sale ID with the caller's cancellation signal", async () => {
  const receipt = { invoiceNumber: "A/91", total: "12.10", lines: [], qr: "stored-qr" };
  const fetcher = vi.fn<typeof fetch>(async () => response(receipt));
  const api = new TillApi("", fetcher),
    signal = new AbortController().signal;
  expect(api.getTransactionReceipt).toBeTypeOf("function");
  expect(await api.getTransactionReceipt("sale/id", { signal })).toEqual(receipt);
  expect(fetcher.mock.calls[0]).toEqual([
    "/api/transactions/sale%2Fid/receipt",
    { method: "GET", credentials: "include", signal },
  ]);
});
it.each([undefined, "en-GB"])(
  "requests a historical duplicate with optional language %s",
  async (language) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const api = new TillApi("", fetcher);
    expect(api.reprintTransaction).toBeTypeOf("function");
    expect(await api.reprintTransaction("sale/id", language)).toBeUndefined();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/transactions/sale%2Fid/reprint");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(String(init!.body))).toEqual(language === undefined ? {} : { language });
  },
);
it("keeps a historical reprint refusal as a failed action", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    response({ error: { code: "device.forbidden_action", params: { action: "reprint" } } }, 403),
  );
  const api = new TillApi("", fetcher);
  expect(api.reprintTransaction).toBeTypeOf("function");
  await expect(api.reprintTransaction("sale")).rejects.toMatchObject({
    code: "device.forbidden_action",
    action: "reprint",
    status: 403,
  });
});
