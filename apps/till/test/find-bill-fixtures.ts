import { vi } from "vitest";
import { TillApi } from "../src/api/client.js";
import type { BillRow, TransactionRow } from "../src/api/find-bill-types.js";
export const billRow = (patch: Partial<BillRow> = {}): BillRow => ({
  workingOrderId: "bill-1",
  openedAt: "2026-10-15T12:00:00Z",
  orderNumber: 42,
  label: "Lucía",
  partyId: null,
  partyName: null,
  tables: ["T9"],
  zoneId: "zone-1",
  zoneName: "Terrace",
  staff: [{ id: "staff-1", name: "Alex" }],
  itemCount: 3,
  total: "25.10",
  paid: "5.00",
  stillOwed: "20.10",
  state: "part-paid",
  earlierDay: true,
  invoiceNumber: null,
  departedAt: null,
  orderStatus: "open",
  collectionStatus: null,
  ...patch,
});
export const transactionRow = (patch: Partial<TransactionRow> = {}): TransactionRow => ({
  transactionId: "sale-1",
  saleId: "sale-1",
  workingOrderId: null,
  scopeOrderIds: [],
  issuedAt: "2026-10-15T12:00:00Z",
  invoiceNumber: "F/0012",
  type: "full-invoice",
  tableName: "T3",
  customerName: "María",
  methods: [{ method: "card", last4: "0091" }],
  staff: { id: "staff-1", name: "Alex" },
  amount: "25.10",
  ...patch,
});
export const billOptions = {
  timeZone: "Europe/Madrid",
  zones: [{ id: "zone-1", name: "Terrace" }],
  billStaff: [{ id: "staff-1", name: "Alex" }],
  transactionStaff: [{ id: "staff-2", name: "Former worker" }],
};
export function listPage(rows: unknown[] = [billRow()], total = 51, page = 0) {
  return { rows, total, page, pageSize: 50, openCount: 51 };
}
export const resolvedDates = {
  startAt: "2026-10-14T22:00:00.000Z",
  endAt: "2026-10-15T22:00:00.000Z",
  from: "2026-10-15",
  to: "2026-10-15",
};
export function findBillApi(answer?: (url: URL, signal?: AbortSignal | null) => Promise<Response>) {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const parsed = new URL(String(url), location.origin);
    if (answer) return answer(parsed, init?.signal);
    return json(
      parsed.pathname.endsWith("options")
        ? billOptions
        : parsed.pathname === "/api/bills"
          ? listPage()
          : { ...listPage([transactionRow()]), dates: resolvedDates },
    );
  });
  return { api: new TillApi("", fetcher), fetcher };
}
export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
