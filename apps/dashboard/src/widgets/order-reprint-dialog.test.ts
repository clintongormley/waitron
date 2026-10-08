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

const printButton = (el: OrderReprintDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=print]")!;
const buttonFill = (host: Element) =>
  getComputedStyle(host.shadowRoot!.querySelector("button")!).backgroundColor;

it.each(["light", "dark"] as const)(
  "draws Print quiet like Cancel while the printers load, then blue once there is one (%s theme)",
  async (theme) => {
    let arrive!: (printers: { id: string; name: string }[]) => void;
    const api = {
      getOrderPrinters: vi.fn().mockReturnValue(new Promise((resolve) => (arrive = resolve))),
      liveData: new LiveData(),
    } as unknown as DashboardApi;
    const { el } = await mountWidget<OrderReprintDialog>(
      "dashboard-order-reprint-dialog",
      { api, row },
      theme,
    );
    const print = printButton(el);
    const cancelFill = buttonFill(
      el.shadowRoot!.querySelector("wt-button[slot=footer]:not([data-test=print])")!,
    );
    await print.updateComplete;
    expect(print.getAttribute("disabled")).not.toBeNull();
    expect(print.variant).toBe("secondary");
    expect(buttonFill(print)).toBe(cancelFill);
    arrive([{ id: "printer-1", name: "Barra" }]);
    await vi.waitFor(() => expect(print.getAttribute("disabled")).toBeNull());
    expect(print.variant).toBe("primary");
    expect(buttonFill(print)).not.toBe(cancelFill);
  },
);

it("keeps Print quiet when there is no printer to send to", async () => {
  let arrive!: (printers: { id: string; name: string }[]) => void;
  const held = new Promise<{ id: string; name: string }[]>((resolve) => (arrive = resolve));
  const api = {
    getOrderPrinters: vi.fn().mockReturnValue(held),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  await vi.waitFor(() => expect(api.getOrderPrinters).toHaveBeenCalled());
  arrive([]);
  await held;
  await vi.waitFor(() => expect((el as unknown as { printers: unknown }).printers).toEqual([]));
  await el.updateComplete;
  const print = printButton(el);
  await print.updateComplete;
  expect(print.getAttribute("disabled")).not.toBeNull();
  expect(print.variant).toBe("secondary");
});

it("keeps Print blue while the copy it sent is in progress", async () => {
  let finish!: () => void;
  const api = {
    getOrderPrinters: vi.fn().mockResolvedValue([{ id: "printer-1", name: "Barra" }]),
    reprintOrder: vi.fn().mockReturnValue(new Promise<void>((resolve) => (finish = resolve))),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  const print = printButton(el);
  await vi.waitFor(() => expect(print.getAttribute("disabled")).toBeNull());
  print.click();
  await vi.waitFor(() => expect(print.loading).toBe(true));
  expect(api.reprintOrder).toHaveBeenCalled();
  expect(print.variant).toBe("primary");
  finish();
  await vi.waitFor(() => expect(print.loading).toBe(false));
});

it("keeps Print blue while its copy is being sent, even if the printers vanish meanwhile", async () => {
  let finish!: () => void;
  const liveData = new LiveData();
  const getOrderPrinters = vi.fn().mockResolvedValue([{ id: "printer-1", name: "Barra" }]);
  const api = {
    getOrderPrinters,
    reprintOrder: vi.fn().mockReturnValue(new Promise<void>((resolve) => (finish = resolve))),
    liveData,
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  const print = printButton(el);
  await vi.waitFor(() => expect(print.getAttribute("disabled")).toBeNull());
  print.click();
  await vi.waitFor(() => expect(print.loading).toBe(true));
  getOrderPrinters.mockResolvedValue([]);
  liveData.refresh();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-combobox")).toBeNull());
  await el.updateComplete;
  await print.updateComplete;
  expect(print.loading).toBe(true);
  expect(print.variant).toBe("primary");
  finish();
  await vi.waitFor(() => expect(print.loading).toBe(false));
});

const texts = {
  "en-GB": {
    loading: "Loading printers…",
    none: "There is no active printer to print on",
    retry: "Try again",
  },
  "es-ES": {
    loading: "Cargando impresoras…",
    none: "No hay ninguna impresora activa",
    retry: "Reintentar",
  },
} as const;
const locales = Object.keys(texts) as (keyof typeof texts)[];

const loadingLine = (el: OrderReprintDialog) =>
  el.shadowRoot!.querySelector("[data-test=printers-loading]");
const retryButton = (el: OrderReprintDialog) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=printers-retry]");

it.each(locales)(
  "says the printers are loading, not that there is none, while they load (%s)",
  async (locale) => {
    setLocale(locale);
    const api = {
      getOrderPrinters: vi.fn().mockReturnValue(new Promise(() => undefined)),
      liveData: new LiveData(),
    } as unknown as DashboardApi;
    const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
      api,
      row,
    });
    await vi.waitFor(() => expect(api.getOrderPrinters).toHaveBeenCalled());
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).not.toContain(texts[locale].none);
    expect(loadingLine(el)?.getAttribute("role")).toBe("status");
    expect(loadingLine(el)?.textContent?.trim()).toBe(texts[locale].loading);
    expect(printButton(el).getAttribute("disabled")).not.toBeNull();
    expect(printButton(el).variant).toBe("secondary");
  },
);

it.each(locales)("lists the loaded printers with no message beside them (%s)", async (locale) => {
  setLocale(locale);
  const api = {
    getOrderPrinters: vi.fn().mockResolvedValue([{ id: "printer-1", name: "Barra" }]),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1"),
  );
  await el.updateComplete;
  expect(loadingLine(el)).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain(texts[locale].none);
  expect(printButton(el).getAttribute("disabled")).toBeNull();
});

it.each(locales)(
  "says there is no active printer once an empty list arrives (%s)",
  async (locale) => {
    setLocale(locale);
    const api = {
      getOrderPrinters: vi.fn().mockResolvedValue([]),
      liveData: new LiveData(),
    } as unknown as DashboardApi;
    const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
      api,
      row,
    });
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(texts[locale].none));
    expect(loadingLine(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-combobox")).toBeNull();
    expect(printButton(el).getAttribute("disabled")).not.toBeNull();
  },
);

it.each(locales)(
  "shows a failed printer read as a load failure with a retry that reads again (%s)",
  async (locale) => {
    setLocale(locale);
    const getOrderPrinters = vi.fn().mockRejectedValue({ code: "connection.failed" });
    const api = { getOrderPrinters, liveData: new LiveData() } as unknown as DashboardApi;
    const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
      api,
      row,
    });
    const alert = () => el.shadowRoot!.querySelector("[role=alert]")?.textContent;
    await vi.waitFor(() => expect(alert()).toBe(codeMessage("connection.failed")));
    await vi.waitFor(() => expect(retryButton(el)?.textContent?.trim()).toBe(texts[locale].retry));
    expect(el.shadowRoot!.textContent).not.toContain(texts[locale].none);
    expect(loadingLine(el)).toBeNull();
    expect(printButton(el).getAttribute("disabled")).not.toBeNull();
    getOrderPrinters.mockResolvedValue([{ id: "printer-1", name: "Barra" }]);
    retryButton(el)!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1"),
    );
    expect(getOrderPrinters).toHaveBeenCalledTimes(2);
    await el.updateComplete;
    expect(alert()).toBeUndefined();
    expect(retryButton(el)).toBeNull();
  },
);

it("keeps a refused print's message when a later printer read fails", async () => {
  setLocale("en-GB");
  const liveData = new LiveData();
  const getOrderPrinters = vi
    .fn()
    .mockResolvedValueOnce([{ id: "printer-1", name: "Barra" }])
    .mockRejectedValue({ code: "connection.failed" });
  const reprintOrder = vi.fn().mockRejectedValue({ code: "authorization.not_permitted" });
  const api = { getOrderPrinters, reprintOrder, liveData } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  const alert = () => el.shadowRoot!.querySelector("[role=alert]")?.textContent;
  await vi.waitFor(() => expect(printButton(el).getAttribute("disabled")).toBeNull());
  printButton(el).click();
  await vi.waitFor(() => expect(alert()).toBe(codeMessage("authorization.not_permitted")));
  liveData.refresh();
  await vi.waitFor(() => expect(getOrderPrinters).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(alert()).toBe(codeMessage("authorization.not_permitted"));
});
