import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi, OrderDetailDto } from "../api/client.js";
import "./order-detail-dialog.js";
import type { OrderDetailDialog } from "./order-detail-dialog.js";

const detail: OrderDetailDto = {
  row: {
    kind: "bill",
    id: "bill-1",
    at: "2026-09-30T12:00:00Z",
    orderNumber: 12,
    label: null,
    partyId: "party-1",
    partyName: "Rosa",
    tables: ["Mesa 5"],
    counter: false,
    saleId: "sale-1",
    invoiceNumber: "A/12",
    creditNotes: ["R/2"],
    status: "left_without_paying",
    credited: "in_part",
    total: "30.00",
    stillOwed: "15.00",
    staff: [],
    departedAt: "2026-09-30T13:00:00Z",
  },
  lines: [
    {
      lineNo: 1,
      name: "Soup",
      variantName: "Large",
      quantity: "1.000",
      total: "10.00",
      listUnitPrice: "12.00",
      creditedTo: "Ana",
    },
  ],
  invoices: [
    {
      kind: "invoice",
      number: "A/12",
      issuedAt: "2026-09-30T12:30:00Z",
      total: "30.00",
      rungBy: "Luis",
    },
    {
      kind: "credit_note",
      number: "R/2",
      issuedAt: "2026-09-30T13:30:00Z",
      total: "-15.00",
      rungBy: "Luis",
    },
  ],
  tenders: [{ method: "cash", amount: "10.00", tip: "1.00" }],
  payments: [
    {
      method: "card",
      state: "received",
      applied: "5.00",
      tip: "0.00",
      createdAt: "2026-09-30T12:15:00Z",
      refunds: [
        {
          applied: "2.00",
          tip: "0.00",
          state: "received",
          reason: "Wrong card",
          createdAt: "2026-09-30T12:20:00Z",
        },
      ],
    },
  ],
  party: {
    name: "Rosa",
    guestCount: 2,
    openedAt: "2026-09-30T12:00:00Z",
    closedAt: "2026-09-30T14:00:00Z",
    openedBy: "Ana",
    closedBy: "Luis",
    tables: ["Mesa 5"],
  },
  departure: {
    recordedAt: "2026-09-30T13:00:00Z",
    reason: "Forgot wallet",
    recordedBy: "Ana",
    authorizedBy: "Luis",
    amount: "30.00",
  },
  reprints: [
    {
      requestedAt: "2026-09-30T15:00:00Z",
      personId: "laura",
      personName: "Laura",
      printerName: "Barra",
    },
  ],
};

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

it("shows the bill's items, invoices, payments, party, departure and copies", async () => {
  setLocale("en-GB");
  const api = {
    getOrder: vi.fn().mockResolvedValue(detail),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
    mayReprint: () => true,
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Soup"));
  const words = el.shadowRoot!.textContent!;
  for (const value of [
    "Large",
    "Ana",
    "A/12",
    "R/2",
    "Cash",
    "Wrong card",
    "Rosa",
    "Mesa 5",
    "Forgot wallet",
    "Luis",
    "Laura",
    "Barra",
  ])
    expect(words).toContain(value);
  expect(api.getOrder).toHaveBeenCalledWith("bill-1");
});

it("explains when a bill outside the session's scope cannot be opened", async () => {
  setLocale("en-GB");
  const api = {
    getOrder: vi.fn().mockRejectedValue({ code: "working_order.not_found" }),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "old-bill",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("That bill was not found"));
});

it("shows the old unit price only when it differs from the charged price", async () => {
  setLocale("en-GB");
  const same = { ...detail, lines: [{ ...detail.lines[0]!, listUnitPrice: "10.00" }] };
  const api = {
    getOrder: vi.fn().mockResolvedValue(same),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Soup"));
  expect(el.shadowRoot!.textContent).not.toContain("was €10.00");
});

it("explains payment states and an unnamed party in Spanish", async () => {
  setLocale("es-ES");
  const translated = {
    ...detail,
    party: { ...detail.party!, name: null },
    payments: [
      {
        ...detail.payments[0]!,
        refunds: [{ ...detail.payments[0]!.refunds[0]!, state: "completed" }],
      },
    ],
  };
  const api = {
    getOrder: vi.fn().mockResolvedValue(translated),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Soup"));
  const words = el.shadowRoot!.textContent!;
  for (const value of [
    "Tarjeta",
    "Pago recibido",
    "Devolución completada",
    "Grupo sin nombre",
    "Comensales: 2",
    "por Luis",
  ])
    expect(words).toContain(value);
  expect(words).not.toContain(" · received");
});
