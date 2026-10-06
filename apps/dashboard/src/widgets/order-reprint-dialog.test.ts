import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi, OrderRowDto } from "../api/client.js";
import "./order-reprint-dialog.js";
import type { OrderReprintDialog } from "./order-reprint-dialog.js";

const row: OrderRowDto = {
  kind: "bill",
  id: "bill-1",
  at: "2026-09-30T12:00:00Z",
  orderNumber: 12,
  label: null,
  partyId: null,
  partyName: null,
  tables: [],
  counter: true,
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

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

it("prints a duplicate on the selected printer and says where it went", async () => {
  setLocale("en-GB");
  const api = {
    getOrderPrinters: vi.fn().mockResolvedValue([
      { id: "printer-1", name: "Barra" },
      { id: "printer-2", name: "Kitchen" },
    ]),
    reprintOrder: vi.fn().mockResolvedValue({ jobId: "job-1" }),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-combobox")?.options).toHaveLength(2),
  );
  expect(el.shadowRoot!.textContent).toContain("Bill No. 12, invoice A/12");
  el.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "printer-2" }, bubbles: true, composed: true }),
  );
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=print]")!.click();
  await vi.waitFor(() => expect(api.reprintOrder).toHaveBeenCalledWith("bill-1", "printer-2"));
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Copy sent to Kitchen"));
});

it("keeps a refused print open and shows the printer refusal under its control", async () => {
  setLocale("en-GB");
  const api = {
    getOrderPrinters: vi.fn().mockResolvedValue([{ id: "printer-1", name: "Barra" }]),
    reprintOrder: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1"),
  );
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=print]")!.click();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-combobox")?.error).toBeTruthy());
  expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
});

it("clears a failed load's message once the server answers again", async () => {
  setLocale("en-GB");
  const liveData = new LiveData();
  const getOrderPrinters = vi.fn().mockRejectedValue({ code: "connection.failed" });
  const api = { getOrderPrinters, liveData } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
      codeMessage("connection.failed"),
    ),
  );
  getOrderPrinters.mockResolvedValue([{ id: "printer-1", name: "Barra" }]);
  liveData.refresh();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1"),
  );
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

it("keeps a print's connection failure when the printer list recovers", async () => {
  setLocale("en-GB");
  const liveData = new LiveData();
  const printers = [{ id: "printer-1", name: "Barra" }];
  const getOrderPrinters = vi
    .fn()
    .mockResolvedValueOnce(printers)
    .mockRejectedValue({ code: "connection.failed" });
  const reprintOrder = vi.fn().mockRejectedValue({ code: "connection.failed" });
  const api = { getOrderPrinters, reprintOrder, liveData } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1"),
  );
  const alert = (): string | null | undefined =>
    el.shadowRoot!.querySelector("[role=alert]")?.textContent;
  liveData.refresh();
  await vi.waitFor(() => expect(alert()).toBe(codeMessage("connection.failed")));
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=print]")!.click();
  await vi.waitFor(() => expect(reprintOrder).toHaveBeenCalledTimes(1));
  liveData.refresh();
  await vi.waitFor(() => expect(getOrderPrinters).toHaveBeenCalledTimes(3));
  getOrderPrinters.mockResolvedValue([...printers, { id: "printer-2", name: "Kitchen" }]);
  liveData.refresh();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-combobox")?.options).toHaveLength(2),
  );
  expect(alert()).toBe(codeMessage("connection.failed"));
});
