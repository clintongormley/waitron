import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi, OfferedPrinter, OrderDetailDto, OrderRowDto } from "../api/client.js";
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

it("puts a bill label holding the invoice placeholder, and a printer name holding a replacement pattern, in as written", async () => {
  setLocale("en-GB");
  const api = {
    getOrderPrinters: vi.fn().mockResolvedValue([{ id: "printer-1", name: "Barra $&" }]),
    reprintOrder: vi.fn().mockResolvedValue({ jobId: "job-1" }),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row: { ...row, orderNumber: null, label: "Terraza {invoice} $&" },
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1"),
  );
  expect(el.shadowRoot!.textContent).toContain("Bill Terraza {invoice} $&, invoice A/12");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=print]")!.click();
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Copy sent to Barra $&"));
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

it.each(locales)(
  "treats a later failed read of an empty list as a load failure with a retry (%s)",
  async (locale) => {
    setLocale(locale);
    const liveData = new LiveData();
    const getOrderPrinters = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValue({ code: "connection.failed" });
    const api = { getOrderPrinters, liveData } as unknown as DashboardApi;
    const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
      api,
      row,
    });
    const alert = () => el.shadowRoot!.querySelector("[role=alert]")?.textContent;
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(texts[locale].none));
    liveData.refresh();
    await vi.waitFor(() => expect(alert()).toBe(codeMessage("connection.failed")));
    await vi.waitFor(() => expect(retryButton(el)?.textContent?.trim()).toBe(texts[locale].retry));
    expect(el.shadowRoot!.textContent).not.toContain(texts[locale].none);
    expect(printButton(el).getAttribute("disabled")).not.toBeNull();
    getOrderPrinters.mockResolvedValue([]);
    liveData.refresh();
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(texts[locale].none));
    await el.updateComplete;
    expect(alert()).toBeUndefined();
    expect(retryButton(el)).toBeNull();
  },
);

it("keeps a stale printer list usable after a later failed read, and offers a retry", async () => {
  setLocale("en-GB");
  const liveData = new LiveData();
  const getOrderPrinters = vi
    .fn()
    .mockResolvedValueOnce([{ id: "printer-1", name: "Barra" }])
    .mockRejectedValue({ code: "connection.failed" });
  const api = { getOrderPrinters, liveData } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1"),
  );
  liveData.refresh();
  await vi.waitFor(() => expect(retryButton(el)).not.toBeNull());
  expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
    codeMessage("connection.failed"),
  );
  expect(el.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1");
  expect(printButton(el).getAttribute("disabled")).toBeNull();
});

it.each(locales)(
  "drops the read's failure and says the printers are loading while a retry is read (%s)",
  async (locale) => {
    setLocale(locale);
    const getOrderPrinters = vi.fn().mockRejectedValue({ code: "connection.failed" });
    const api = { getOrderPrinters, liveData: new LiveData() } as unknown as DashboardApi;
    const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
      api,
      row,
    });
    await vi.waitFor(() => expect(retryButton(el)).not.toBeNull());
    getOrderPrinters.mockReturnValue(new Promise(() => undefined));
    retryButton(el)!.click();
    await vi.waitFor(() => expect(getOrderPrinters).toHaveBeenCalledTimes(2));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(loadingLine(el)?.textContent?.trim()).toBe(texts[locale].loading);
    expect(retryButton(el)).toBeNull();
    expect(printButton(el).getAttribute("disabled")).not.toBeNull();
  },
);

it("keeps a print's message when Try again reads the printers again", async () => {
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
  await vi.waitFor(() => expect(retryButton(el)).not.toBeNull());
  expect(alert()).toBe(codeMessage("authorization.not_permitted"));
  getOrderPrinters.mockReturnValue(new Promise(() => undefined));
  retryButton(el)!.click();
  await vi.waitFor(() => expect(getOrderPrinters).toHaveBeenCalledTimes(3));
  await el.updateComplete;
  expect(alert()).toBe(codeMessage("authorization.not_permitted"));
});

it("says the printers are loading, not that there is none, when Try again follows an empty list", async () => {
  setLocale("en-GB");
  const liveData = new LiveData();
  const getOrderPrinters = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockRejectedValue({ code: "connection.failed" });
  const api = { getOrderPrinters, liveData } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(texts["en-GB"].none));
  liveData.refresh();
  await vi.waitFor(() => expect(retryButton(el)).not.toBeNull());
  getOrderPrinters.mockReturnValue(new Promise(() => undefined));
  retryButton(el)!.click();
  await vi.waitFor(() => expect(getOrderPrinters).toHaveBeenCalledTimes(3));
  await el.updateComplete;
  expect(loadingLine(el)?.textContent?.trim()).toBe(texts["en-GB"].loading);
  expect(el.shadowRoot!.textContent).not.toContain(texts["en-GB"].none);
});

it("keeps the earlier printer usable when Try again fails too", async () => {
  setLocale("en-GB");
  const liveData = new LiveData();
  const getOrderPrinters = vi
    .fn()
    .mockResolvedValueOnce([{ id: "printer-1", name: "Barra" }])
    .mockRejectedValue({ code: "connection.failed" });
  const api = { getOrderPrinters, liveData } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1"),
  );
  liveData.refresh();
  await vi.waitFor(() => expect(retryButton(el)).not.toBeNull());
  retryButton(el)!.click();
  await vi.waitFor(() => expect(getOrderPrinters).toHaveBeenCalledTimes(3));
  await vi.waitFor(() => expect(retryButton(el)).not.toBeNull());
  expect(el.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1");
  expect(printButton(el).getAttribute("disabled")).toBeNull();
});

it("says the printers are loading, not that there is none, when reopened after an empty list", async () => {
  setLocale("en-GB");
  const getOrderPrinters = vi.fn().mockResolvedValueOnce([]);
  const api = { getOrderPrinters, liveData: new LiveData() } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(texts["en-GB"].none));
  el.row = null;
  await el.updateComplete;
  getOrderPrinters.mockReturnValue(new Promise(() => undefined));
  el.row = row;
  await vi.waitFor(() => expect(getOrderPrinters).toHaveBeenCalledTimes(2));
  await el.updateComplete;
  expect(loadingLine(el)?.textContent?.trim()).toBe(texts["en-GB"].loading);
  expect(el.shadowRoot!.textContent).not.toContain(texts["en-GB"].none);
});

describe("printing a full invoice", () => {
  const BARRA = { id: "printer-1", name: "Barra", kind: "receipt" as const };
  const OFICINA = { id: "page-1", name: "Oficina", kind: "a4" as const };
  const COCINA = { id: "printer-2", name: "Cocina", kind: "receipt" as const };
  const fullRow: OrderRowDto = { ...row, invoiceType: "F1" };
  const invoiceDetail = (
    printers: OfferedPrinter[] | null,
    originalPrinterId: string | null,
    designation: "original" | "duplicate" = "duplicate",
  ): OrderDetailDto => ({
    row: fullRow,
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
      originalCompleted: designation === "duplicate",
      originalPrinterId,
      actions: {
        retryOriginal: null,
        print: printers === null ? null : { printers, designation },
        receiptInstead: null,
        email: null,
      },
      history: [],
    },
  });
  type InvoiceApi = DashboardApi & {
    getOrder: ReturnType<typeof vi.fn>;
    getOrderPrinters: ReturnType<typeof vi.fn>;
    requestOrderPrintDelivery: ReturnType<typeof vi.fn>;
  };
  const invoiceApi = (detail: OrderDetailDto, overrides: Record<string, unknown> = {}) =>
    ({
      getOrder: vi.fn().mockResolvedValue(detail),
      getOrderPrinters: vi.fn().mockResolvedValue([{ id: "printer-1", name: "Barra" }]),
      requestOrderPrintDelivery: vi.fn().mockResolvedValue({ id: "delivery-1" }),
      reprintOrder: vi.fn(),
      liveData: new LiveData(),
      ...overrides,
    }) as unknown as InvoiceApi;
  const openInvoice = async (api: DashboardApi) =>
    (
      await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
        api,
        row: fullRow,
        mode: "invoice",
      })
    ).el;
  const chooser = (el: OrderReprintDialog) => el.shadowRoot!.querySelector("wt-combobox");

  it("preselects the printer the original went to, though it is neither first nor of the first's kind, and lists A4 printers marked", async () => {
    setLocale("en-GB");
    const api = invoiceApi(invoiceDetail([BARRA, OFICINA, COCINA], OFICINA.id));
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.options).toHaveLength(3));
    expect(chooser(el)!.options).toEqual([
      { value: "printer-1", label: "Barra" },
      { value: "page-1", label: "Oficina · A4" },
      { value: "printer-2", label: "Cocina" },
    ]);
    expect(chooser(el)!.value).toBe("page-1");
    expect(api.getOrder).toHaveBeenCalledWith("bill-1");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await el.updateComplete;
    expect(chooser(el)!.value).toBe("page-1");
    expect(api.getOrderPrinters).not.toHaveBeenCalled();
  });

  it.each([
    ["the original went by email", null],
    ["the original's printer is now switched off", "printer-9"],
  ])("preselects the first printer when %s", async (_name, original) => {
    const api = invoiceApi(invoiceDetail([COCINA, OFICINA], original));
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.options).toHaveLength(2));
    expect(chooser(el)!.value).toBe("printer-2");
  });

  it("keeps the person's choice when the list is read again, while it is still listed", async () => {
    const api = invoiceApi(invoiceDetail([BARRA, OFICINA, COCINA], OFICINA.id));
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("page-1"));
    chooser(el)!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "printer-2" },
        bubbles: true,
        composed: true,
      }),
    );
    api.getOrder.mockResolvedValue(invoiceDetail([OFICINA, COCINA, BARRA], OFICINA.id));
    api.liveData.refresh();
    await vi.waitFor(() => expect(chooser(el)?.options[0]?.value).toBe("page-1"));
    expect(chooser(el)!.value).toBe("printer-2");
    api.getOrder.mockResolvedValue(invoiceDetail([BARRA, OFICINA], OFICINA.id));
    api.liveData.refresh();
    await vi.waitFor(() => expect(chooser(el)?.options).toHaveLength(2));
    expect(chooser(el)!.value).toBe("page-1");
  });

  it("prints the full invoice on the chosen printer under a request key, and says where it went", async () => {
    setLocale("en-GB");
    const api = invoiceApi(invoiceDetail([BARRA, OFICINA], OFICINA.id, "original"));
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("page-1"));
    printButton(el).click();
    await vi.waitFor(() => expect(api.requestOrderPrintDelivery).toHaveBeenCalledTimes(1));
    const [id, printerId, key] = api.requestOrderPrintDelivery.mock.calls[0] as string[];
    expect([id, printerId]).toEqual(["bill-1", "page-1"]);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Invoice sent to Oficina"));
    expect(api.reprintOrder).not.toHaveBeenCalled();
  });

  it("once printed, keeps the heading and says only where it went while the server offers no print", async () => {
    setLocale("en-GB");
    const api = invoiceApi(invoiceDetail([BARRA, OFICINA], OFICINA.id, "original"));
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("page-1"));
    api.getOrder.mockResolvedValue(invoiceDetail(null, OFICINA.id));
    printButton(el).click();
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Invoice sent to Oficina"));
    await vi.waitFor(() => expect(chooser(el)).toBeNull());
    expect(el.shadowRoot!.querySelector("[data-test=print-busy]")).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-dialog")!.getAttribute("heading")).toBe(
      "Print the invoice",
    );
    expect(printButton(el).getAttribute("disabled")).not.toBeNull();
    expect(printButton(el).variant).toBe("secondary");
  });

  it("never offers the receipt printers' list when the dialog turns to a full invoice", async () => {
    let answer!: (detail: OrderDetailDto) => void;
    const api = invoiceApi(invoiceDetail([OFICINA], OFICINA.id), {
      getOrder: vi.fn().mockReturnValue(new Promise((resolve) => (answer = resolve))),
    });
    const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
      api,
      row,
    });
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("printer-1"));
    el.row = null;
    await el.updateComplete;
    el.mode = "invoice";
    el.row = fullRow;
    await el.updateComplete;
    expect(chooser(el)).toBeNull();
    expect(loadingLine(el)).not.toBeNull();
    answer(invoiceDetail([OFICINA], OFICINA.id));
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("page-1"));
  });

  it("shows an unavailable printer's refusal under the chooser and keeps the dialog open", async () => {
    setLocale("en-GB");
    const api = invoiceApi(invoiceDetail([BARRA, OFICINA], OFICINA.id), {
      requestOrderPrintDelivery: vi
        .fn()
        .mockRejectedValue({ code: "invoice_delivery.printer_invalid" }),
    });
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("page-1"));
    printButton(el).click();
    await vi.waitFor(() =>
      expect(chooser(el)?.error).toBe("That printer is unavailable. Choose another printer"),
    );
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
  });

  it("shows any other refusal beside the buttons", async () => {
    setLocale("en-GB");
    const api = invoiceApi(invoiceDetail([BARRA], null), {
      requestOrderPrintDelivery: vi.fn().mockRejectedValue({ code: "invoice_delivery.active" }),
    });
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("printer-1"));
    printButton(el).click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
        codeMessage("invoice_delivery.active"),
      ),
    );
    expect(chooser(el)!.error).toBe("");
  });

  it("says the invoice is on its way and keeps Print quiet while the server offers no print", async () => {
    setLocale("en-GB");
    const api = invoiceApi(invoiceDetail(null, null));
    const el = await openInvoice(api);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=print-busy]")?.textContent?.trim()).toBe(
        codeMessage("invoice_delivery.active"),
      ),
    );
    expect(loadingLine(el)).toBeNull();
    expect(printButton(el).getAttribute("disabled")).not.toBeNull();
    expect(printButton(el).variant).toBe("secondary");
  });

  it.each([
    ["en-GB", "original", "Print the invoice", "Print"],
    ["en-GB", "duplicate", "Print a copy of the invoice", "Print a copy"],
    ["es-ES", "original", "Imprimir la factura", "Imprimir"],
    ["es-ES", "duplicate", "Imprimir una copia de la factura", "Imprimir una copia"],
  ] as const)("words the dialog in %s for an %s", async (locale, designation, title, action) => {
    setLocale(locale);
    const api = invoiceApi(invoiceDetail([BARRA, OFICINA], OFICINA.id, designation));
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("page-1"));
    expect(el.shadowRoot!.querySelector("wt-dialog")!.getAttribute("heading")).toBe(title);
    expect(printButton(el).textContent?.trim()).toBe(action);
    if (locale === "es-ES") expect(chooser(el)!.options[1]!.label).toBe("Oficina · A4");
  });

  it("shows a failed read as a load failure with a retry that reads the bill again", async () => {
    setLocale("en-GB");
    const api = invoiceApi(invoiceDetail([BARRA], null), {
      getOrder: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(retryButton(el)).not.toBeNull());
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
      codeMessage("connection.failed"),
    );
    api.getOrder.mockResolvedValue(invoiceDetail([BARRA], null));
    retryButton(el)!.click();
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("printer-1"));
    expect(api.getOrderPrinters).not.toHaveBeenCalled();
  });

  it("keeps receipt mode on the receipt printers when the same dialog later prints an invoice and back", async () => {
    const api = invoiceApi(invoiceDetail([OFICINA], OFICINA.id));
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("page-1"));
    el.row = null;
    await el.updateComplete;
    el.mode = "receipt";
    el.row = row;
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("printer-1"));
    expect(api.getOrderPrinters).toHaveBeenCalledTimes(1);
  });
});
