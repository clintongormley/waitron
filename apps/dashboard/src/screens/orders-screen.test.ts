import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveData, tableNoMatches } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi, OrderRowDto, OrdersPageDto } from "../api/client.js";
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
  tables: ["Mesa 5"],
  counter: false,
  saleId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  invoiceNumber: "A/12",
  invoiceType: "F2",
  creditNotes: ["R/2"],
  status: "left_without_paying",
  credited: "in_part",
  total: "30.00",
  stillOwed: "15.00",
  staff: [{ id: "person-1", name: "Ana" }],
  departedAt: "2026-09-30T13:00:00.000Z",
};
const PAGE: OrdersPageDto = { rows: [ROW], next: "cursor", from: "2026-09-30", to: "2026-09-30" };

function stubApi(overrides: Record<string, unknown> = {}): DashboardApi {
  const api = {
    listOrderPages: vi.fn().mockResolvedValue(PAGE),
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
    getOrderPrinters: vi.fn().mockResolvedValue([{ id: "printer-1", name: "Barra" }]),
    reprintOrder: vi.fn().mockResolvedValue({ jobId: "job-1" }),
    liveData: new LiveData(),
    ...overrides,
  };
  return {
    ...api,
    background: {
      ...api,
      listOrderPages: vi.fn().mockResolvedValue(PAGE),
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

async function loaded(api = stubApi()) {
  const { el } = await mountWidget<OrdersScreen>("dashboard-orders-screen", { api });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")?.rows).toHaveLength(1),
  );
  return { el, api };
}

beforeEach(() => {
  setLocale("en-GB");
  history.replaceState(null, "", "/manage/orders");
  sessionStorage.removeItem("waitron.orders.table");
  localStorage.removeItem("waitron.orders.table:columns");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

describe("dashboard Orders", () => {
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

  it("places each credit note below its invoice number", async () => {
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
      listOrderPages: vi.fn().mockResolvedValue({
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
      expect(location.pathname).toBe("/manage/orders/status/unpaid/from/2026-09-01/to/2026-09-02"),
    );
    expect(
      (api.background.listOrderPages as ReturnType<typeof vi.fn>).mock.lastCall?.[0],
    ).toMatchObject({
      status: "unpaid",
      from: "2026-09-01",
      to: "2026-09-02",
    });
  });

  it("does not send an empty date after one end of a range is cleared", async () => {
    history.replaceState(null, "", "/manage/orders/from/2026-09-01/to/2026-09-02");
    const { el, api } = await loaded();
    const choose = (name: string, value: string) =>
      el
        .shadowRoot!.querySelector(`[name=${name}]`)!
        .dispatchEvent(
          new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
        );
    choose("from", "");
    choose("status", "paid");
    await vi.waitFor(() => expect(api.background.listOrderPages).toHaveBeenCalled());
    expect(
      (api.background.listOrderPages as ReturnType<typeof vi.fn>).mock.lastCall?.[0],
    ).toMatchObject({
      status: "paid",
      from: undefined,
      to: undefined,
    });
  });

  it("accepts a paid status from the address and asks the server to apply session scope", async () => {
    history.replaceState(null, "", "/manage/orders/status/paid");
    const { el, api } = await loaded();
    const status = el.shadowRoot!.querySelector<
      HTMLElement & { options: { value: string }[]; value: string }
    >("wt-combobox[name=status]")!;
    expect(status.options.map((option) => option.value)).toContain("paid");
    expect(status.value).toBe("paid");
    expect((api.listOrderPages as ReturnType<typeof vi.fn>).mock.lastCall?.[0].status).toBe("paid");
  });

  it("loads another page when Show more is chosen", async () => {
    const { el, api } = await loaded();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=show-more]")!.click();
    await vi.waitFor(() =>
      expect((api.background.listOrderPages as ReturnType<typeof vi.fn>).mock.lastCall?.[1]).toBe(
        2,
      ),
    );
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

  it("places a table-filter refusal under Table and says to fix the filter bar", async () => {
    const api = stubApi({
      listOrderPages: vi
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

  it("refreshes changed bills through the passive API", async () => {
    const { api } = await loaded();
    api.liveData.invalidate([{ type: "working_orders", id: ROW.id }]);
    await vi.waitFor(() => expect(api.background.listOrderPages).toHaveBeenCalled());
    expect(api.listOrderPages).toHaveBeenCalledTimes(1);
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
    (api.background.listOrderPages as ReturnType<typeof vi.fn>).mockResolvedValue({
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
    await vi.waitFor(() => expect(picker.shadowRoot!.textContent).toContain("Copy sent to Barra"));
    (api.background.listOrderPages as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...PAGE,
      rows: [{ ...ROW }],
    });
    api.liveData.invalidate([{ type: "working_orders", id: ROW.id }]);
    await vi.waitFor(() => expect(api.background.listOrderPages).toHaveBeenCalled());
    expect(picker.shadowRoot!.textContent).toContain("Copy sent to Barra");
    expect(api.getOrderPrinters).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an invoice without a bill", { ...ROW, kind: "sale" as const }],
    ["a bill without an invoice", { ...ROW, invoiceNumber: null, invoiceType: null }],
  ])("does not offer reprint for %s", async (_name, row) => {
    const api = stubApi({ listOrderPages: vi.fn().mockResolvedValue({ ...PAGE, rows: [row] }) });
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
      const empty = { ...PAGE, rows: [], next: null };
      const api = stubApi({ listOrderPages: vi.fn().mockResolvedValue(empty) });
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
      new CustomEvent("wt-change", { detail: { value: "Mesa 5" }, bubbles: true, composed: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(api.listOrderPages).toHaveBeenCalledTimes(1);
    expect(api.background.listOrderPages).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(
        (api.background.listOrderPages as ReturnType<typeof vi.fn>).mock.lastCall?.[0].table,
      ).toBe("Mesa 5"),
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
      (api.background.listOrderPages as ReturnType<typeof vi.fn>).mock.lastCall?.[0].q;
    type("gin ");
    await vi.waitFor(() => expect(lastQ()).toBe("gin "));
    type("   ");
    await vi.waitFor(() => {
      expect(
        (api.background.listOrderPages as ReturnType<typeof vi.fn>).mock.calls.length,
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
    expect(api.background.listOrderPages).not.toHaveBeenCalled();
  });

  it("keeps a paid bill's earlier departure visible", async () => {
    const paid = { ...ROW, status: "paid" as const, stillOwed: null };
    const api = stubApi({ listOrderPages: vi.fn().mockResolvedValue({ ...PAGE, rows: [paid] }) });
    const { el } = await loaded(api);
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    expect(table.shadowRoot!.textContent).toContain("Left without paying on");
  });
});
