import { afterEach, describe, expect, it, vi } from "vitest";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget, expectMessageAboveButtons } from "./test-helpers.js";
import { readDocumentPrinter, rememberDocumentPrinter } from "../document-printer-preference.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import type {
  DashboardApi,
  OfferedPrinter,
  OrderDeliveryAttempt,
  OrderDetailDto,
  OrderRowDto,
} from "../api/client.js";
import "./order-reprint-dialog.js";
import type { OrderReprintDialog } from "./order-reprint-dialog.js";

const errorMessage = (el: OrderReprintDialog) =>
  formMessageOf(el.shadowRoot!.querySelector("wt-form-actions")!);

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
  vi.restoreAllMocks();
  rememberDocumentPrinter("receipt", "");
  rememberDocumentPrinter("invoice", "");
  localStorage.removeItem("waitron-dashboard-document-printer:receipt");
  localStorage.removeItem("waitron-dashboard-document-printer:invoice");
  setLocale("es-ES");
});

it("prints a duplicate on the selected printer and says where it went", async () => {
  setLocale("en-GB");
  const api = {
    getOrderPrinters: vi.fn().mockResolvedValue([
      { id: "printer-1", name: "Bar printer" },
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
  expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Reprint the receipt");
  el.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "printer-2" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(printButton(el).textContent?.trim()).toBe("Print a copy on Kitchen");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=print]")!.click();
  await vi.waitFor(() => expect(api.reprintOrder).toHaveBeenCalledWith("bill-1", "printer-2"));
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Copy sent to Kitchen"));
});

it("says the printer the copy was sent to, though another was chosen while the request was on its way", async () => {
  setLocale("en-GB");
  let finish!: (queued: { jobId: string }) => void;
  const api = {
    getOrderPrinters: vi.fn().mockResolvedValue([
      { id: "printer-1", name: "Bar printer" },
      { id: "printer-2", name: "Kitchen" },
    ]),
    reprintOrder: vi.fn().mockReturnValue(new Promise((resolve) => (finish = resolve))),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-combobox")?.options).toHaveLength(2),
  );
  el.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "printer-1" }, bubbles: true, composed: true }),
  );
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=print]")!.click();
  await vi.waitFor(() => expect(api.reprintOrder).toHaveBeenCalledWith("bill-1", "printer-1"));
  el.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "printer-2" }, bubbles: true, composed: true }),
  );
  finish({ jobId: "job-1" });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Copy sent to Bar printer"));
  expect(el.shadowRoot!.textContent).not.toContain("sent to Kitchen");
});

it("puts a bill label holding the invoice placeholder, and a printer name holding a replacement pattern, in as written", async () => {
  setLocale("en-GB");
  const api = {
    getOrderPrinters: vi.fn().mockResolvedValue([{ id: "printer-1", name: "Bar printer $&" }]),
    reprintOrder: vi.fn().mockResolvedValue({ jobId: "job-1" }),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row: { ...row, orderNumber: null, label: "Terrace {invoice} $&" },
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1"),
  );
  expect(el.shadowRoot!.textContent).toContain("Bill Terrace {invoice} $&, invoice A/12");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=print]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain("Copy sent to Bar printer $&"),
  );
});

it("keeps a refused print open and shows the printer refusal under its control", async () => {
  setLocale("en-GB");
  const api = {
    getOrderPrinters: vi.fn().mockResolvedValue([{ id: "printer-1", name: "Bar printer" }]),
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
  await vi.waitFor(async () =>
    expect((await errorMessage(el))?.textContent).toBe(codeMessage("connection.failed")),
  );
  await expectMessageAboveButtons(
    el.shadowRoot!.querySelector("wt-dialog")!,
    printButton(el),
    codeMessage("connection.failed"),
  );
  getOrderPrinters.mockResolvedValue([{ id: "printer-1", name: "Bar printer" }]);
  liveData.refresh();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1"),
  );
  expect(await errorMessage(el)).toBeNull();
});

it("keeps a print's connection failure when the printer list recovers", async () => {
  setLocale("en-GB");
  const liveData = new LiveData();
  const printers = [{ id: "printer-1", name: "Bar printer" }];
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
  const alert = async () => (await errorMessage(el))?.textContent;
  liveData.refresh();
  await vi.waitFor(async () => expect(await alert()).toBe(codeMessage("connection.failed")));
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=print]")!.click();
  await vi.waitFor(() => expect(reprintOrder).toHaveBeenCalledTimes(1));
  liveData.refresh();
  await vi.waitFor(() => expect(getOrderPrinters).toHaveBeenCalledTimes(3));
  getOrderPrinters.mockResolvedValue([...printers, { id: "printer-2", name: "Kitchen" }]);
  liveData.refresh();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-combobox")?.options).toHaveLength(2),
  );
  expect(await alert()).toBe(codeMessage("connection.failed"));
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
      el.shadowRoot!.querySelector("wt-button[slot=cancel]:not([data-test=document-back])")!,
    );
    await print.updateComplete;
    expect(print.getAttribute("disabled")).not.toBeNull();
    expect(print.variant).toBe("secondary");
    expect(buttonFill(print)).toBe(cancelFill);
    arrive([{ id: "printer-1", name: "Bar printer" }]);
    await vi.waitFor(() => expect(print.getAttribute("disabled")).toBeNull());
    expect(print.variant).toBe("primary");
    expect(buttonFill(print)).not.toBe(cancelFill);
  },
);

it("keeps Print quiet with no printers and lets staff refresh without printing", async () => {
  let arrive!: (printers: { id: string; name: string }[]) => void;
  const held = new Promise<{ id: string; name: string }[]>((resolve) => (arrive = resolve));
  setLocale("en-GB");
  const api = {
    reprintOrder: vi.fn(),
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
  const refresh = el.shadowRoot!.querySelector<HTMLElement>("[data-test=printers-retry]");
  expect(refresh?.textContent?.trim()).toBe("Refresh printers");
  vi.mocked(api.getOrderPrinters).mockResolvedValue([{ id: "new", name: "New printer" }]);
  refresh!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-combobox")?.options).toEqual([
      { value: "new", label: "New printer" },
    ]),
  );
  expect(el.shadowRoot!.querySelector("wt-combobox")?.value).toBe("new");
  expect(api.reprintOrder).not.toHaveBeenCalled();
  expect(readDocumentPrinter("receipt")).toBeNull();
});

it("keeps Print blue while the copy it sent is in progress", async () => {
  let finish!: () => void;
  const api = {
    getOrderPrinters: vi.fn().mockResolvedValue([{ id: "printer-1", name: "Bar printer" }]),
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
  const getOrderPrinters = vi.fn().mockResolvedValue([{ id: "printer-1", name: "Bar printer" }]);
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
    none: "No printer is available for this document",
    retry: "Try again",
    refresh: "Refresh printers",
  },
  "es-ES": {
    loading: "Cargando impresoras…",
    none: "No hay ninguna impresora disponible para este documento",
    retry: "Reintentar",
    refresh: "Actualizar impresoras",
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
    getOrderPrinters: vi.fn().mockResolvedValue([{ id: "printer-1", name: "Bar printer" }]),
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
  "says no printer is available for the document once an empty list arrives (%s)",
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
    const alert = async () => (await errorMessage(el))?.textContent;
    await vi.waitFor(async () => expect(await alert()).toBe(codeMessage("connection.failed")));
    await vi.waitFor(() => expect(retryButton(el)?.textContent?.trim()).toBe(texts[locale].retry));
    expect(el.shadowRoot!.textContent).not.toContain(texts[locale].none);
    expect(loadingLine(el)).toBeNull();
    expect(printButton(el).getAttribute("disabled")).not.toBeNull();
    getOrderPrinters.mockResolvedValue([{ id: "printer-1", name: "Bar printer" }]);
    retryButton(el)!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-combobox")?.value).toBe("printer-1"),
    );
    expect(getOrderPrinters).toHaveBeenCalledTimes(2);
    await el.updateComplete;
    expect(await alert()).toBeUndefined();
    expect(retryButton(el)).toBeNull();
  },
);

it("keeps a refused print's message when a later printer read fails", async () => {
  setLocale("en-GB");
  const liveData = new LiveData();
  const getOrderPrinters = vi
    .fn()
    .mockResolvedValueOnce([{ id: "printer-1", name: "Bar printer" }])
    .mockRejectedValue({ code: "connection.failed" });
  const reprintOrder = vi.fn().mockRejectedValue({ code: "authorization.not_permitted" });
  const api = { getOrderPrinters, reprintOrder, liveData } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  const alert = async () => (await errorMessage(el))?.textContent;
  await vi.waitFor(() => expect(printButton(el).getAttribute("disabled")).toBeNull());
  printButton(el).click();
  await vi.waitFor(async () =>
    expect(await alert()).toBe(codeMessage("authorization.not_permitted")),
  );
  liveData.refresh();
  await vi.waitFor(() => expect(getOrderPrinters).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(await alert()).toBe(codeMessage("authorization.not_permitted"));
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
    const alert = async () => (await errorMessage(el))?.textContent;
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(texts[locale].none));
    liveData.refresh();
    await vi.waitFor(async () => expect(await alert()).toBe(codeMessage("connection.failed")));
    await vi.waitFor(() => expect(retryButton(el)?.textContent?.trim()).toBe(texts[locale].retry));
    expect(el.shadowRoot!.textContent).not.toContain(texts[locale].none);
    expect(printButton(el).getAttribute("disabled")).not.toBeNull();
    getOrderPrinters.mockResolvedValue([]);
    liveData.refresh();
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(texts[locale].none));
    await el.updateComplete;
    expect(await alert()).toBeUndefined();
    expect(retryButton(el)?.textContent?.trim()).toBe(texts[locale].refresh);
  },
);

it("keeps a stale printer list usable after a later failed read, and offers a retry", async () => {
  setLocale("en-GB");
  const liveData = new LiveData();
  const getOrderPrinters = vi
    .fn()
    .mockResolvedValueOnce([{ id: "printer-1", name: "Bar printer" }])
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
  expect((await errorMessage(el))?.textContent).toBe(codeMessage("connection.failed"));
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
    expect(await errorMessage(el)).toBeNull();
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
    .mockResolvedValueOnce([{ id: "printer-1", name: "Bar printer" }])
    .mockRejectedValue({ code: "connection.failed" });
  const reprintOrder = vi.fn().mockRejectedValue({ code: "authorization.not_permitted" });
  const api = { getOrderPrinters, reprintOrder, liveData } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
    api,
    row,
  });
  const alert = async () => (await errorMessage(el))?.textContent;
  await vi.waitFor(() => expect(printButton(el).getAttribute("disabled")).toBeNull());
  printButton(el).click();
  await vi.waitFor(async () =>
    expect(await alert()).toBe(codeMessage("authorization.not_permitted")),
  );
  liveData.refresh();
  await vi.waitFor(() => expect(retryButton(el)).not.toBeNull());
  expect(await alert()).toBe(codeMessage("authorization.not_permitted"));
  getOrderPrinters.mockReturnValue(new Promise(() => undefined));
  retryButton(el)!.click();
  await vi.waitFor(() => expect(getOrderPrinters).toHaveBeenCalledTimes(3));
  await el.updateComplete;
  expect(await alert()).toBe(codeMessage("authorization.not_permitted"));
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
    .mockResolvedValueOnce([{ id: "printer-1", name: "Bar printer" }])
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
  const BAR_PRINTER = { id: "printer-1", name: "Bar printer", kind: "receipt" as const };
  const OFFICE_PRINTER = { id: "page-1", name: "Office printer", kind: "a4" as const };
  const KITCHEN_PRINTER = { id: "printer-2", name: "Kitchen printer", kind: "receipt" as const };
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
  const deliveryAttempt = (
    status: OrderDeliveryAttempt["status"],
    designation: OrderDeliveryAttempt["designation"] = "original",
  ): OrderDeliveryAttempt => ({
    id: "delivery-1",
    medium: "receipt",
    designation,
    status,
    failureCode: null,
    requestedAt: "2026-09-30T12:05:00Z",
    at: null,
    personId: null,
    personName: null,
    printerHold: null,
    lateSuccess: false,
  });
  /** The detail with an attempt in `status` as its current delivery. */
  const withCurrent = (
    detail: OrderDetailDto,
    status: OrderDeliveryAttempt["status"],
  ): OrderDetailDto => {
    const attempt = deliveryAttempt(status);
    return {
      ...detail,
      deliveries: { ...detail.deliveries!, current: attempt, history: [attempt] },
    };
  };
  type InvoiceApi = DashboardApi & {
    getOrder: ReturnType<typeof vi.fn>;
    getOrderPrinters: ReturnType<typeof vi.fn>;
    requestOrderPrintDelivery: ReturnType<typeof vi.fn>;
  };
  const invoiceApi = (detail: OrderDetailDto, overrides: Record<string, unknown> = {}) =>
    ({
      getOrder: vi.fn().mockResolvedValue(detail),
      getOrderPrinters: vi.fn().mockResolvedValue([{ id: "printer-1", name: "Bar printer" }]),
      requestOrderPrintDelivery: vi.fn().mockResolvedValue(deliveryAttempt("queued")),
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
  const choose = (el: OrderReprintDialog, printerId: string) =>
    chooser(el)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: printerId }, bubbles: true, composed: true }),
    );
  const chooseListed = async (el: OrderReprintDialog, id: string) => {
    await vi.waitFor(() =>
      expect(chooser(el)?.options.some((option) => option.value === id)).toBe(true),
    );
    choose(el, id);
    await el.updateComplete;
  };
  /** A print request that answers only when the test says so. */
  const heldPrint = () => {
    let answer!: (attempt: OrderDeliveryAttempt) => void;
    let refuse!: (error: unknown) => void;
    const request = vi.fn().mockReturnValue(
      new Promise<OrderDeliveryAttempt>((resolve, reject) => {
        answer = resolve;
        refuse = reject;
      }),
    );
    return {
      request,
      answer: (attempt: OrderDeliveryAttempt) => answer(attempt),
      refuse: (error: unknown) => refuse(error),
    };
  };

  it("chooses the recorded F1 document before offering its eligible printers", async () => {
    setLocale("en-GB");
    const api = invoiceApi(invoiceDetail([BAR_PRINTER, OFFICE_PRINTER], null, "original"));
    const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
      api,
      row: fullRow,
      mode: "choose",
    });
    const document = el.shadowRoot!.querySelector<HTMLElement & { options: unknown[] }>(
      "[name=document]",
    );
    expect(document?.options).toEqual([
      { value: "receipt", label: "Receipt" },
      { value: "invoice", label: "Invoice" },
    ]);
    document!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "receipt" }, bubbles: true, composed: true }),
    );
    await vi.waitFor(() =>
      expect(chooser(el)?.options).toEqual([{ value: BAR_PRINTER.id, label: BAR_PRINTER.name }]),
    );
    expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Print the receipt");
    expect(api.getOrder).toHaveBeenCalledWith(fullRow.id);
    expect(api.getOrderPrinters).not.toHaveBeenCalled();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=print]")!.click();
    await vi.waitFor(() =>
      expect(api.requestOrderPrintDelivery).toHaveBeenCalledWith(
        fullRow.id,
        BAR_PRINTER.id,
        expect.any(String),
      ),
    );
    expect(api.reprintOrder).not.toHaveBeenCalled();
    api.getOrder.mockResolvedValue(invoiceDetail([OFFICE_PRINTER], null));
    api.liveData.refresh();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain("No printer is available for this document"),
    );
    expect(chooser(el)).toBeNull();
  });

  it("waits for the first eligible offer without rejecting its remembered printer while busy", async () => {
    setLocale("en-GB");
    localStorage.setItem("waitron-dashboard-document-printer:invoice", OFFICE_PRINTER.id);
    const api = invoiceApi(withCurrent(invoiceDetail(null, OFFICE_PRINTER.id), "queued"));
    const el = await openInvoice(api);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=print-busy]")).not.toBeNull(),
    );
    expect(el.shadowRoot!.textContent).not.toContain(
      "Your previous printer is no longer available",
    );
    api.getOrder.mockResolvedValue(invoiceDetail([BAR_PRINTER, OFFICE_PRINTER], OFFICE_PRINTER.id));
    api.liveData.refresh();
    await vi.waitFor(() => expect(chooser(el)?.value).toBe(OFFICE_PRINTER.id));
    expect(el.shadowRoot!.textContent).not.toContain(
      "Your previous printer is no longer available",
    );
  });

  it("drops the previous full invoice's Receipt list before a new simplified bill loads", async () => {
    const api = invoiceApi(invoiceDetail([BAR_PRINTER], null));
    const { el } = await mountWidget<OrderReprintDialog>("dashboard-order-reprint-dialog", {
      api,
      row: fullRow,
      mode: "receipt",
    });
    await vi.waitFor(() => expect(chooser(el)?.value).toBe(BAR_PRINTER.id));
    el.row = null;
    await el.updateComplete;
    let arrive!: (printers: { id: string; name: string }[]) => void;
    api.getOrderPrinters.mockReturnValue(
      new Promise((resolve) => {
        arrive = resolve;
      }),
    );
    el.row = row;
    await el.updateComplete;
    expect(chooser(el)).toBeNull();
    expect(loadingLine(el)).not.toBeNull();
    arrive([{ id: "new", name: "New printer" }]);
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("new"));
  });

  it("keeps independent browser printer memories for Receipt and Invoice", async () => {
    setLocale("en-GB");
    localStorage.setItem("waitron-dashboard-document-printer:receipt", KITCHEN_PRINTER.id);
    localStorage.setItem("waitron-dashboard-document-printer:invoice", OFFICE_PRINTER.id);
    const api = invoiceApi(
      invoiceDetail([BAR_PRINTER, OFFICE_PRINTER, KITCHEN_PRINTER], BAR_PRINTER.id),
    );
    const invoice = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(invoice)?.value).toBe(OFFICE_PRINTER.id));
    const { el: receipt } = await mountWidget<OrderReprintDialog>(
      "dashboard-order-reprint-dialog",
      { api, row: fullRow, mode: "receipt" },
    );
    await vi.waitFor(() => expect(chooser(receipt)?.value).toBe(KITCHEN_PRINTER.id));
    expect(receipt.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Reprint the receipt");
    expect(chooser(receipt)!.options.map((printer) => printer.value)).toEqual([
      BAR_PRINTER.id,
      KITCHEN_PRINTER.id,
    ]);
  });

  it("requires a choice among several printers instead of choosing the original or first", async () => {
    const api = invoiceApi(invoiceDetail([BAR_PRINTER, OFFICE_PRINTER], OFFICE_PRINTER.id));
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.options).toHaveLength(2));
    expect(chooser(el)!.value).toBe("");
    const print = printButton(el);
    expect(print.disabled).toBe(true);
    expect(print.variant).toBe("secondary");
  });

  it("keeps printing and a session preference when browser storage is refused", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage refused", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage refused", "SecurityError");
    });
    await expect(Promise.resolve().then(() => readDocumentPrinter("invoice"))).resolves.toBeNull();
    const api = invoiceApi(invoiceDetail([BAR_PRINTER, OFFICE_PRINTER], null));
    const el = await openInvoice(api);
    await chooseListed(el, OFFICE_PRINTER.id);
    printButton(el).click();
    await vi.waitFor(() => expect(api.requestOrderPrintDelivery).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(printButton(el).loading).toBe(false));
    expect(readDocumentPrinter("invoice")).toBe(OFFICE_PRINTER.id);
    vi.mocked(Storage.prototype.getItem).mockRestore();
    expect(readDocumentPrinter("invoice")).toBe(OFFICE_PRINTER.id);
    const reopened = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(reopened)?.value).toBe(OFFICE_PRINTER.id));
    expect(await errorMessage(reopened)).toBeNull();
  });

  it("remembers an accepted printer but saves nothing for a selection or refused request", async () => {
    const pending = heldPrint();
    const api = invoiceApi(invoiceDetail([BAR_PRINTER, OFFICE_PRINTER], null), {
      requestOrderPrintDelivery: pending.request,
    });
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.options).toHaveLength(2));
    choose(el, OFFICE_PRINTER.id);
    expect(localStorage.getItem("waitron-dashboard-document-printer:invoice")).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=print]")!.click();
    await vi.waitFor(() => expect(pending.request).toHaveBeenCalledOnce());
    pending.refuse({ code: "internal.error" });
    await vi.waitFor(() => expect(printButton(el).loading).toBe(false));
    expect(localStorage.getItem("waitron-dashboard-document-printer:invoice")).toBeNull();
    api.requestOrderPrintDelivery.mockResolvedValue(deliveryAttempt("queued", "duplicate"));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=print]")!.click();
    await vi.waitFor(() =>
      expect(localStorage.getItem("waitron-dashboard-document-printer:invoice")).toBe(
        OFFICE_PRINTER.id,
      ),
    );
    const reopened = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(reopened)?.value).toBe(OFFICE_PRINTER.id));
  });

  it("marks A4 printers and accepts an explicit printer choice", async () => {
    setLocale("en-GB");
    const api = invoiceApi(
      invoiceDetail([BAR_PRINTER, OFFICE_PRINTER, KITCHEN_PRINTER], OFFICE_PRINTER.id),
    );
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.options).toHaveLength(3));
    expect(chooser(el)!.options).toEqual([
      { value: "printer-1", label: "Bar printer" },
      { value: "page-1", label: "Office printer · A4" },
      { value: "printer-2", label: "Kitchen printer" },
    ]);
    choose(el, OFFICE_PRINTER.id);
    await el.updateComplete;
    expect(chooser(el)!.value).toBe("page-1");
    expect(api.getOrder).toHaveBeenCalledWith("bill-1");
    expect(api.getOrderPrinters).not.toHaveBeenCalled();
  });

  it("keeps the person's choice when the list is read again, while it is still listed", async () => {
    const api = invoiceApi(
      invoiceDetail([BAR_PRINTER, OFFICE_PRINTER, KITCHEN_PRINTER], OFFICE_PRINTER.id),
    );
    const el = await openInvoice(api);
    await chooseListed(el, OFFICE_PRINTER.id);
    chooser(el)!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "printer-2" },
        bubbles: true,
        composed: true,
      }),
    );
    api.getOrder.mockResolvedValue(
      invoiceDetail([OFFICE_PRINTER, KITCHEN_PRINTER, BAR_PRINTER], OFFICE_PRINTER.id),
    );
    api.liveData.refresh();
    await vi.waitFor(() => expect(chooser(el)?.options[0]?.value).toBe("page-1"));
    expect(chooser(el)!.value).toBe("printer-2");
    api.getOrder.mockResolvedValue(invoiceDetail([BAR_PRINTER, OFFICE_PRINTER], OFFICE_PRINTER.id));
    api.liveData.refresh();
    await vi.waitFor(() => expect(chooser(el)?.options).toHaveLength(2));
    expect(chooser(el)!.value).toBe("");
    expect(printButton(el).disabled).toBe(true);
  });

  it("prints the full invoice on the chosen printer under a request key, and says where it went", async () => {
    setLocale("en-GB");
    const api = invoiceApi(
      invoiceDetail([BAR_PRINTER, OFFICE_PRINTER], OFFICE_PRINTER.id, "original"),
    );
    const el = await openInvoice(api);
    await chooseListed(el, OFFICE_PRINTER.id);
    printButton(el).click();
    await vi.waitFor(() => expect(api.requestOrderPrintDelivery).toHaveBeenCalledTimes(1));
    const [id, printerId, key] = api.requestOrderPrintDelivery.mock.calls[0] as string[];
    expect([id, printerId]).toEqual(["bill-1", "page-1"]);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain("Invoice sent to Office printer"),
    );
    expect(api.reprintOrder).not.toHaveBeenCalled();
  });

  it("once printed, keeps the heading and says only where it went while the server offers no print", async () => {
    setLocale("en-GB");
    const api = invoiceApi(
      invoiceDetail([BAR_PRINTER, OFFICE_PRINTER], OFFICE_PRINTER.id, "original"),
    );
    const el = await openInvoice(api);
    await chooseListed(el, OFFICE_PRINTER.id);
    api.getOrder.mockResolvedValue(withCurrent(invoiceDetail(null, OFFICE_PRINTER.id), "queued"));
    printButton(el).click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain("Invoice sent to Office printer"),
    );
    await vi.waitFor(() => expect(chooser(el)).toBeNull());
    expect(el.shadowRoot!.querySelector("[data-test=print-busy]")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain(
      "Your previous printer is no longer available",
    );
    expect(el.shadowRoot!.textContent).not.toContain("No printer is available for this document");
    expect(el.shadowRoot!.querySelector("wt-dialog")!.getAttribute("heading")).toBe(
      "Print the invoice",
    );
    expect(printButton(el).getAttribute("disabled")).not.toBeNull();
    expect(printButton(el).variant).toBe("secondary");
    api.getOrder.mockResolvedValue(
      withCurrent(invoiceDetail([BAR_PRINTER, OFFICE_PRINTER], OFFICE_PRINTER.id), "sent"),
    );
    api.liveData.refresh();
    await vi.waitFor(() => expect(chooser(el)?.value).toBe(OFFICE_PRINTER.id));
    expect(el.shadowRoot!.textContent).not.toContain(
      "Your previous printer is no longer available",
    );
  });

  it("never offers the receipt printers' list when the dialog turns to a full invoice", async () => {
    let answer!: (detail: OrderDetailDto) => void;
    const api = invoiceApi(invoiceDetail([OFFICE_PRINTER], OFFICE_PRINTER.id), {
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
    answer(invoiceDetail([OFFICE_PRINTER], OFFICE_PRINTER.id));
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("page-1"));
  });

  it("shows an unavailable printer's refusal under the chooser and keeps the dialog open", async () => {
    setLocale("en-GB");
    const api = invoiceApi(invoiceDetail([BAR_PRINTER, OFFICE_PRINTER], OFFICE_PRINTER.id), {
      requestOrderPrintDelivery: vi
        .fn()
        .mockRejectedValue({ code: "invoice_delivery.printer_invalid" }),
    });
    const el = await openInvoice(api);
    await chooseListed(el, OFFICE_PRINTER.id);
    printButton(el).click();
    await vi.waitFor(() =>
      expect(chooser(el)?.error).toBe("That printer is unavailable. Choose another printer"),
    );
    expect((await errorMessage(el))?.textContent).toBe(
      "Correct the highlighted fields to continue.",
    );
    expect(printButton(el).disabled).toBe(false);
    expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
  });

  it("shows any other refusal beside the buttons", async () => {
    setLocale("en-GB");
    const api = invoiceApi(invoiceDetail([BAR_PRINTER], null), {
      requestOrderPrintDelivery: vi.fn().mockRejectedValue({ code: "invoice_delivery.active" }),
    });
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("printer-1"));
    printButton(el).click();
    await vi.waitFor(async () =>
      expect((await errorMessage(el))?.textContent).toBe(codeMessage("invoice_delivery.active")),
    );
    expect(chooser(el)!.error).toBe("");
  });

  it.each(["queued", "sending"] as const)(
    "says the invoice is on its way and keeps Print quiet while its current delivery is %s",
    async (status) => {
      setLocale("en-GB");
      const api = invoiceApi(withCurrent(invoiceDetail(null, null), status));
      const el = await openInvoice(api);
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-test=print-busy]")?.textContent?.trim()).toBe(
          codeMessage("invoice_delivery.active"),
        ),
      );
      expect(loadingLine(el)).toBeNull();
      expect(printButton(el).getAttribute("disabled")).not.toBeNull();
      expect(printButton(el).variant).toBe("secondary");
    },
  );

  it.each([
    ["en-GB", null, "No printer is available for this document"],
    ["en-GB", "sent", "No printer is available for this document"],
    ["es-ES", "failed", "No hay ninguna impresora disponible para este documento"],
  ] as const)(
    "says no printer is available for the document when no delivery is on its way (%s, current %s)",
    async (locale, current, words) => {
      setLocale(locale);
      const offerless = invoiceDetail(null, null);
      const api = invoiceApi(current === null ? offerless : withCurrent(offerless, current));
      const el = await openInvoice(api);
      await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(words));
      expect(el.shadowRoot!.querySelector("[data-test=print-busy]")).toBeNull();
      expect(loadingLine(el)).toBeNull();
      expect(printButton(el).getAttribute("disabled")).not.toBeNull();
      expect(printButton(el).variant).toBe("secondary");
    },
  );

  it("keeps the person's choice when Try again reads the bill again after a failed read", async () => {
    const api = invoiceApi(
      invoiceDetail([BAR_PRINTER, OFFICE_PRINTER, KITCHEN_PRINTER], OFFICE_PRINTER.id),
    );
    const el = await openInvoice(api);
    await chooseListed(el, OFFICE_PRINTER.id);
    chooser(el)!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "printer-2" },
        bubbles: true,
        composed: true,
      }),
    );
    api.getOrder.mockRejectedValue({ code: "connection.failed" });
    api.liveData.refresh();
    await vi.waitFor(() => expect(retryButton(el)).not.toBeNull());
    api.getOrder.mockResolvedValue(
      invoiceDetail([BAR_PRINTER, OFFICE_PRINTER, KITCHEN_PRINTER], OFFICE_PRINTER.id),
    );
    const reads = api.getOrder.mock.calls.length;
    retryButton(el)!.click();
    await vi.waitFor(() => expect(retryButton(el)).toBeNull());
    expect(api.getOrder.mock.calls.length).toBeGreaterThan(reads);
    await el.updateComplete;
    expect(chooser(el)!.value).toBe("printer-2");
  });

  it("keeps several choices unselected when the first read recovers", async () => {
    const api = invoiceApi(invoiceDetail([BAR_PRINTER, OFFICE_PRINTER], OFFICE_PRINTER.id), {
      getOrder: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(retryButton(el)).not.toBeNull());
    api.getOrder.mockResolvedValue(invoiceDetail([BAR_PRINTER, OFFICE_PRINTER], OFFICE_PRINTER.id));
    retryButton(el)!.click();
    await vi.waitFor(() => expect(chooser(el)?.options).toHaveLength(2));
    expect(chooser(el)!.value).toBe("");
  });

  it.each([
    ["en-GB", "original", "Print the invoice", "Print on Office printer"],
    ["en-GB", "duplicate", "Print a copy of the invoice", "Print a copy on Office printer"],
    ["es-ES", "original", "Imprimir la factura", "Imprimir en Office printer"],
    [
      "es-ES",
      "duplicate",
      "Imprimir una copia de la factura",
      "Imprimir una copia en Office printer",
    ],
  ] as const)("words the dialog in %s for an %s", async (locale, designation, title, action) => {
    setLocale(locale);
    const api = invoiceApi(
      invoiceDetail([BAR_PRINTER, OFFICE_PRINTER], OFFICE_PRINTER.id, designation),
    );
    const el = await openInvoice(api);
    await chooseListed(el, OFFICE_PRINTER.id);
    expect(el.shadowRoot!.querySelector("wt-dialog")!.getAttribute("heading")).toBe(title);
    expect(printButton(el).textContent?.trim()).toBe(action);
    if (locale === "es-ES") expect(chooser(el)!.options[1]!.label).toBe("Office printer · A4");
  });

  it("shows a failed read as a load failure with a retry that reads the bill again", async () => {
    setLocale("en-GB");
    const api = invoiceApi(invoiceDetail([BAR_PRINTER], null), {
      getOrder: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(retryButton(el)).not.toBeNull());
    expect((await errorMessage(el))?.textContent).toBe(codeMessage("connection.failed"));
    api.getOrder.mockResolvedValue(invoiceDetail([BAR_PRINTER], null));
    retryButton(el)!.click();
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("printer-1"));
    expect(api.getOrderPrinters).not.toHaveBeenCalled();
  });

  it("keeps receipt mode on the receipt printers when the same dialog later prints an invoice and back", async () => {
    const api = invoiceApi(invoiceDetail([OFFICE_PRINTER], OFFICE_PRINTER.id));
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("page-1"));
    el.row = null;
    await el.updateComplete;
    el.mode = "receipt";
    el.row = row;
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("printer-1"));
    expect(api.getOrderPrinters).toHaveBeenCalledTimes(1);
  });

  it("says the printer the invoice was sent to, though another was chosen while the request was on its way", async () => {
    setLocale("en-GB");
    const held = heldPrint();
    const api = invoiceApi(
      invoiceDetail([BAR_PRINTER, OFFICE_PRINTER], OFFICE_PRINTER.id, "original"),
      {
        requestOrderPrintDelivery: held.request,
      },
    );
    const el = await openInvoice(api);
    await chooseListed(el, OFFICE_PRINTER.id);
    printButton(el).click();
    await vi.waitFor(() => expect(api.requestOrderPrintDelivery).toHaveBeenCalledTimes(1));
    choose(el, "printer-1");
    await el.updateComplete;
    expect(printButton(el).textContent?.trim()).toBe("Print on Office printer");
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=document-back]")
        ?.disabled,
    ).toBe(true);
    held.answer(deliveryAttempt("queued"));
    await vi.waitFor(() => expect(printButton(el).loading).toBe(false));
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=document-back]")
        ?.disabled,
    ).toBe(false);
    expect(el.shadowRoot!.textContent).toContain("Invoice sent to Office printer");
    expect(el.shadowRoot!.textContent).not.toContain("sent to Bar printer");
  });

  it("words the confirmation by the copy the server says it made, not by a later offer", async () => {
    setLocale("en-GB");
    const held = heldPrint();
    const api = invoiceApi(invoiceDetail([OFFICE_PRINTER], OFFICE_PRINTER.id, "original"), {
      requestOrderPrintDelivery: held.request,
    });
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("page-1"));
    printButton(el).click();
    await vi.waitFor(() => expect(api.requestOrderPrintDelivery).toHaveBeenCalledTimes(1));
    api.getOrder.mockResolvedValue(invoiceDetail([OFFICE_PRINTER], OFFICE_PRINTER.id, "duplicate"));
    api.liveData.refresh();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-dialog")!.getAttribute("heading")).toBe(
        "Print a copy of the invoice",
      ),
    );
    held.answer(deliveryAttempt("queued", "original"));
    await vi.waitFor(() => expect(printButton(el).loading).toBe(false));
    expect(el.shadowRoot!.textContent).toContain("Invoice sent to Office printer");
  });

  it("calls a print a copy when the server answers that it made a copy", async () => {
    setLocale("en-GB");
    const api = invoiceApi(invoiceDetail([OFFICE_PRINTER], OFFICE_PRINTER.id, "original"), {
      requestOrderPrintDelivery: vi.fn().mockResolvedValue(deliveryAttempt("queued", "duplicate")),
    });
    const el = await openInvoice(api);
    await vi.waitFor(() => expect(chooser(el)?.value).toBe("page-1"));
    printButton(el).click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain("Copy sent to Office printer"),
    );
  });

  it.each([
    ["answers", (held: ReturnType<typeof heldPrint>) => held.answer(deliveryAttempt("queued"))],
    [
      "is refused",
      (held: ReturnType<typeof heldPrint>) =>
        held.refuse({ code: "invoice_delivery.printer_invalid" }),
    ],
    ["fails", (held: ReturnType<typeof heldPrint>) => held.refuse({ code: "connection.failed" })],
  ])(
    "leaves a dialog opened for another bill untouched when an earlier opening's print %s",
    async (_name, settle) => {
      setLocale("en-GB");
      const held = heldPrint();
      const api = invoiceApi(invoiceDetail([OFFICE_PRINTER], OFFICE_PRINTER.id, "original"), {
        requestOrderPrintDelivery: held.request,
      });
      const el = await openInvoice(api);
      await vi.waitFor(() => expect(chooser(el)?.value).toBe("page-1"));
      printButton(el).click();
      await vi.waitFor(() => expect(api.requestOrderPrintDelivery).toHaveBeenCalledTimes(1));
      el.row = null;
      await el.updateComplete;
      const next = { ...fullRow, id: "bill-2", invoiceNumber: "A/13" };
      api.getOrder.mockResolvedValue({
        ...invoiceDetail([BAR_PRINTER], null, "original"),
        row: next,
      });
      el.row = next;
      await el.updateComplete;
      expect(el.mode).toBe("choose");
      el.shadowRoot!.querySelector("[name=document]")!.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "invoice" },
          bubbles: true,
          composed: true,
        }),
      );
      await vi.waitFor(() => expect(chooser(el)?.value).toBe("printer-1"));
      expect(printButton(el).loading).toBe(false);
      settle(held);
      await held.request.mock.results[0]!.value.catch(() => undefined);
      await el.updateComplete;
      expect(localStorage.getItem("waitron-dashboard-document-printer:invoice")).toBe(
        _name === "answers" ? OFFICE_PRINTER.id : null,
      );
      expect(el.shadowRoot!.textContent).not.toContain("sent to");
      expect(await errorMessage(el)).toBeNull();
      expect(chooser(el)!.error).toBe("");
      expect(printButton(el).loading).toBe(false);
      api.requestOrderPrintDelivery.mockResolvedValue(deliveryAttempt("queued"));
      printButton(el).click();
      await vi.waitFor(() =>
        expect(el.shadowRoot!.textContent).toContain("Invoice sent to Bar printer"),
      );
      expect(api.requestOrderPrintDelivery).toHaveBeenLastCalledWith(
        "bill-2",
        "printer-1",
        expect.any(String),
      );
    },
  );
});
