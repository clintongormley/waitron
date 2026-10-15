import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, OrderRowDto } from "../api/client.js";
import "./orders-screen.js";
import type { OrdersScreen } from "./orders-screen.js";

const row: OrderRowDto = {
  kind: "bill",
  id: "bill-1",
  at: "2026-09-30T12:00:00Z",
  orderNumber: 12,
  label: null,
  partyId: null,
  partyName: null,
  tables: ["Mesa 5"],
  counter: false,
  saleId: "sale-1",
  invoiceNumber: "A/12",
  invoiceType: "F2",
  creditNotes: [],
  status: "paid",
  credited: null,
  total: "30.00",
  stillOwed: null,
  staff: [],
  departedAt: null,
};
const detail = {
  row,
  lines: [],
  invoices: [],
  tenders: [],
  payments: [],
  party: null,
  departure: null,
  reprints: [],
};
const api = {
  listOrderPages: vi.fn().mockResolvedValue({ rows: [row], next: null, from: null, to: null }),
  listOrderStaff: vi.fn().mockResolvedValue({ staff: [] }),
  getOrder: vi.fn().mockResolvedValue(detail),
  getOrderPrinters: vi.fn().mockResolvedValue([{ id: "printer-1", name: "Barra" }]),
  liveData: new LiveData(),
} as unknown as DashboardApi;

afterEach(cleanupWidgets);

for (const theme of ["light", "dark"] as const) {
  it(`has an accessible Orders table and dialogs in ${theme} theme`, async () => {
    history.replaceState(null, "", "/manage/orders");
    const { el, host } = await mountWidget<OrdersScreen>("dashboard-orders-screen", { api }, theme);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-data-table")?.rows).toHaveLength(1),
    );
    await expectNoA11yViolations(host);
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>("tbody .row-activate")!.click();
    await vi.waitFor(() =>
      expect(
        el
          .shadowRoot!.querySelector("dashboard-order-detail-dialog")
          ?.shadowRoot!.querySelector("wt-dialog")?.open,
      ).toBe(true),
    );
    await expectNoA11yViolations(host);
    const dialog = el.shadowRoot!.querySelector("dashboard-order-detail-dialog")!;
    await vi.waitFor(() => expect(dialog.shadowRoot!.querySelector("wt-button")).not.toBeNull());
    dialog.shadowRoot!.querySelector<HTMLElement>("wt-button")!.click();
    await vi.waitFor(() =>
      expect(
        el
          .shadowRoot!.querySelector("dashboard-order-reprint-dialog")
          ?.shadowRoot!.querySelector("wt-dialog")?.open,
      ).toBe(true),
    );
    await expectNoA11yViolations(host);
  });
}

const fullRow: OrderRowDto = { ...row, invoiceType: "F1" };
const fullApi = {
  ...api,
  listOrderPages: vi.fn().mockResolvedValue({ rows: [fullRow], next: null, from: null, to: null }),
  getOrder: vi.fn().mockResolvedValue({
    ...detail,
    row: fullRow,
    invoicePdfDownloads: [],
    deliveries: {
      current: null,
      originalCompleted: true,
      originalPrinterId: "page-1",
      actions: {
        retryOriginal: null,
        print: {
          printers: [
            { id: "printer-1", name: "Barra", kind: "receipt" },
            { id: "page-1", name: "Oficina", kind: "a4" },
          ],
          designation: "duplicate",
        },
        receiptInstead: null,
        email: null,
      },
      history: [],
    },
  }),
} as unknown as DashboardApi;

for (const theme of ["light", "dark"] as const) {
  it(`has an accessible full invoice's printer list in ${theme} theme`, async () => {
    history.replaceState(null, "", "/manage/orders");
    const { el, host } = await mountWidget<OrdersScreen>(
      "dashboard-orders-screen",
      { api: fullApi },
      theme,
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-data-table")?.rows).toHaveLength(1),
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>("tbody .row-activate")!.click();
    const dialog = el.shadowRoot!.querySelector("dashboard-order-detail-dialog")!;
    await vi.waitFor(() =>
      expect(dialog.shadowRoot!.querySelector("[data-test=print-invoice]")).not.toBeNull(),
    );
    await expectNoA11yViolations(host);
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=print-invoice]")!.click();
    const picker = el.shadowRoot!.querySelector("dashboard-order-reprint-dialog")!;
    await vi.waitFor(() =>
      expect(picker.shadowRoot!.querySelector("wt-combobox")?.value).toBe("page-1"),
    );
    await expectNoA11yViolations(host);
  });
}
