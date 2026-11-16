import { NavigationGuard } from "@waitron/ui";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type {
  DashboardApi,
  TaxOfficeInvoiceDto,
  TaxOfficePageDto,
  TaxOfficeQuery,
} from "../api/client.js";
import { en, es } from "../i18n/strings.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { TaxOfficeScreen } from "./tax-office-screen.js";
import "./tax-office-screen.js";

const locale = currentLocale();
beforeEach(() => {
  setLocale("en-GB");
  history.replaceState(null, "", "/manage/invoices");
  localStorage.removeItem("waitron.invoices.table:columns");
});
afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setLocale(locale);
  history.replaceState(null, "", "/");
});

function invoice(over: Partial<TaxOfficeInvoiceDto> = {}): TaxOfficeInvoiceDto {
  return {
    id: "sale-1",
    number: "A/12",
    kind: "F2",
    issuedAt: "2026-11-05T10:30:00.000Z",
    issueDate: "2026-11-05",
    operationDate: null,
    customerName: null,
    customerTaxId: null,
    vat: [{ rate: "10.00", base: "10.00", tax: "1.00" }],
    total: "11.00",
    corrects: [],
    cancelledAt: null,
    ...over,
  };
}

const twoRates = invoice({
  id: "sale-2",
  number: "B/7",
  kind: "F1",
  customerName: "Comidas Ruiz SL",
  customerTaxId: "B12345678",
  vat: [
    { rate: "10.00", base: "20.00", tax: "2.00" },
    { rate: "21.00", base: "10.00", tax: "2.10" },
  ],
  total: "34.10",
});

const page = (rows: TaxOfficeInvoiceDto[], next: TaxOfficePageDto["next"] = null) => ({
  rows,
  next,
  timeZone: "Europe/Madrid",
});

async function mount(api: Partial<DashboardApi>) {
  const { el } = await mountWidget<TaxOfficeScreen>("dashboard-tax-office-screen", {
    api: api as DashboardApi,
  });
  return el;
}

const table = (el: TaxOfficeScreen) => el.shadowRoot!.querySelector("wt-data-table")!;
const field = (el: TaxOfficeScreen, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement & { error: string; value: string }>(`[name="${name}"]`)!;
const tableText = async (el: TaxOfficeScreen) => {
  await table(el).updateComplete;
  return table(el).shadowRoot!.textContent!.replace(/\s+/g, " ");
};
const lastQuery = (list: ReturnType<typeof vi.fn>) => list.mock.calls.at(-1)![0] as TaxOfficeQuery;

it("lists the route's rows, one line per VAT rate, with the kind, customer and total", async () => {
  const listTaxOfficeInvoices = vi.fn().mockResolvedValue(page([invoice(), twoRates]));
  const el = await mount({ listTaxOfficeInvoices });
  await vi.waitFor(() => expect(table(el).loading).toBe(false));

  expect(table(el).rows).toHaveLength(2);
  const text = await tableText(el);
  expect(text).toContain("A/12");
  expect(text).toContain("Comidas Ruiz SL");
  expect(text).toContain("B12345678");
  expect(text).toContain("34.10");
  const kinds = [...table(el).shadowRoot!.querySelectorAll("abbr")].map((kind) => [
    kind.textContent!.trim(),
    kind.title,
  ]);
  expect(kinds).toEqual([
    ["F2", en["tax_office.kind.F2"]],
    ["F1", en["tax_office.kind.F1"]],
  ]);
  const row = table(el).shadowRoot!.querySelector('[data-row-key="sale-2"]')!;
  const lines = (part: string) =>
    [...row.querySelectorAll(`[part~="${part}"]`)].map((line) => line.textContent!.trim());
  expect(lines("base")).toEqual([
    expect.stringContaining("20.00"),
    expect.stringContaining("10.00"),
  ]);
  expect(lines("rate")).toEqual(["10%", "21%"]);
  expect(lines("tax")).toEqual([expect.stringContaining("2.00"), expect.stringContaining("2.10")]);
});

it("writes each rate as Spanish writes a percentage, under the Spanish headings", async () => {
  setLocale("es-ES");
  const el = await mount({ listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([twoRates])) });
  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));

  await table(el).updateComplete;
  const rates = [...table(el).shadowRoot!.querySelectorAll('[part~="rate"]')].map(
    (line) => line.textContent,
  );
  expect(rates).toEqual([
    new Intl.NumberFormat("es-ES", { style: "percent" }).format(0.1),
    new Intl.NumberFormat("es-ES", { style: "percent" }).format(0.21),
  ]);
  expect(rates[1]).toMatch(/^21\s%$/);
  const headings = [...table(el).shadowRoot!.querySelectorAll("th")].map((th) =>
    th.textContent!.trim(),
  );
  expect(headings).toEqual(
    (["number", "kind", "issued", "customer", "total", "base", "rate", "tax"] as const).map(
      (column) => es[`tax_office.col.${column}`],
    ),
  );
});

it("offers every column but the invoice number in a translated chooser, and remembers a hidden one", async () => {
  setLocale("es-ES");
  const el = await mount({ listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([twoRates])) });
  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));
  await table(el).updateComplete;
  const root = table(el).shadowRoot!;

  expect(root.querySelector(".columns-trigger")?.getAttribute("aria-label")).toBe(
    es["table.customise_columns"],
  );
  expect(
    [...root.querySelectorAll<HTMLInputElement>("input[data-column]")].map((box) => [
      box.dataset.column,
      box.checked,
    ]),
  ).toEqual(
    ["kind", "issued", "customer", "total", "base", "rate", "tax"].map((key) => [key, true]),
  );
  const box = root.querySelector<HTMLInputElement>('input[data-column="customer"]')!;
  box.checked = false;
  box.dispatchEvent(new Event("change"));
  await table(el).updateComplete;

  expect([...root.querySelectorAll("thead th")].map((th) => th.textContent!.trim())).not.toContain(
    es["tax_office.col.customer"],
  );
  expect(JSON.parse(localStorage.getItem("waitron.invoices.table:columns")!)).toEqual({
    customer: false,
  });
});

it("links to the guide page on showing invoices to the tax office", async () => {
  const el = await mount({ listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([])) });

  const link = el.shadowRoot!.querySelector<HTMLAnchorElement>("a.guide")!;
  expect(link.getAttribute("href")).toBe("/help/en/invoices");
  expect(link.textContent).toBe(en["tax_office.guide"]);
});

it("dates an invoice on the venue's calendar, not the browser's", async () => {
  const el = await mount({
    listTaxOfficeInvoices: vi.fn().mockResolvedValue({
      rows: [invoice({ issuedAt: "2026-11-05T02:30:00.000Z", issueDate: "2026-11-04" })],
      next: null,
      timeZone: "America/New_York",
    }),
  });
  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));

  const text = await tableText(el);
  expect(text).toContain("4 Nov 2026");
  expect(text).toContain("21:30");
  expect(text).not.toContain("5 Nov 2026");
});

it("defaults the issue range to the current month", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2028, 1, 10, 12) });
  const listTaxOfficeInvoices = vi.fn().mockResolvedValue(page([]));
  const el = await mount({ listTaxOfficeInvoices });
  await vi.waitFor(() => expect(listTaxOfficeInvoices).toHaveBeenCalled());

  expect(listTaxOfficeInvoices.mock.calls[0]![0]).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  expect(field(el, "from").value).toBe("2028-02-01");
  expect(field(el, "to").value).toBe("2028-02-29");
});

it.each([
  ["q", "Ruiz", { q: "Ruiz" }],
  ["rate", "21", { rate: "21" }],
  ["amount", "34.10", { amount: "34.10" }],
] as const)("sends the %s filter as its query parameter", async (name, value, sent) => {
  history.replaceState(null, "", "/manage/invoices/from/2026-11-01/to/2026-11-30");
  const listTaxOfficeInvoices = vi.fn().mockResolvedValue(page([]));
  const el = await mount({ listTaxOfficeInvoices });
  await vi.waitFor(() => expect(listTaxOfficeInvoices).toHaveBeenCalledTimes(1));

  const input = field(el, name).shadowRoot!.querySelector("input")!;
  await userEvent.type(input, value);
  await userEvent.keyboard("{Enter}");

  await vi.waitFor(() =>
    expect(lastQuery(listTaxOfficeInvoices)).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
      ...sent,
    }),
  );
  expect(location.pathname).toContain(`/${name}/`);
});

it("sends the issue range, the operation range and the kind as their query parameters", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-11-01/to/2026-11-30");
  const listTaxOfficeInvoices = vi.fn().mockResolvedValue(page([]));
  const el = await mount({ listTaxOfficeInvoices });
  await vi.waitFor(() => expect(listTaxOfficeInvoices).toHaveBeenCalledTimes(1));
  const change = (name: string, value: string) =>
    field(el, name).dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );

  change("from", "2026-10-01");
  change("to", "2026-10-31");
  change("operationFrom", "2026-09-01");
  change("operationTo", "2026-09-30");
  change("kind", "R5");

  await vi.waitFor(() =>
    expect(lastQuery(listTaxOfficeInvoices)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      operationFrom: "2026-09-01",
      operationTo: "2026-09-30",
      kind: "R5",
    }),
  );
});

it("reads the filters from the address", async () => {
  history.replaceState(
    null,
    "",
    "/manage/invoices/from/2026-10-01/to/2026-10-31/q/Ruiz/rate/21/amount/34.10/operation-from/2026-09-01/operation-to/2026-09-30/kind/F1",
  );
  const listTaxOfficeInvoices = vi.fn().mockResolvedValue(page([]));
  await mount({ listTaxOfficeInvoices });
  await vi.waitFor(() => expect(listTaxOfficeInvoices).toHaveBeenCalled());

  expect(listTaxOfficeInvoices.mock.calls[0]![0]).toEqual({
    from: "2026-10-01",
    to: "2026-10-31",
    q: "Ruiz",
    rate: "21",
    amount: "34.10",
    operationFrom: "2026-09-01",
    operationTo: "2026-09-30",
    kind: "F1",
  });
});

it("asks for the next page with the keyset the last page named, and adds its rows", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-11-01/to/2026-11-30/kind/F2");
  const next = { at: "2026-11-05T10:30:00.000Z", id: "sale-1" };
  const listTaxOfficeInvoices = vi
    .fn()
    .mockResolvedValueOnce(page([invoice()], next))
    .mockResolvedValueOnce(page([invoice({ id: "sale-0", number: "A/11" })]));
  const el = await mount({ listTaxOfficeInvoices });
  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));

  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=more]")!);

  await vi.waitFor(() => expect(table(el).rows).toHaveLength(2));
  expect(listTaxOfficeInvoices.mock.calls[1]![0]).toEqual({
    from: "2026-11-01",
    to: "2026-11-30",
    kind: "F2",
    after: next,
  });
  expect(el.shadowRoot!.querySelector("[data-test=more]")).toBeNull();
});

it("reads the next page with the listed rows' filter while a new range is half typed", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-11-01/to/2026-11-30");
  const next = { at: "2026-11-05T10:30:00.000Z", id: "sale-1" };
  const listTaxOfficeInvoices = vi
    .fn()
    .mockResolvedValueOnce(page([invoice()], next))
    .mockResolvedValueOnce(page([invoice({ id: "sale-0", number: "A/11" })]));
  const el = await mount({ listTaxOfficeInvoices });
  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));
  field(el, "from").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "" }, bubbles: true, composed: true }),
  );

  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=more]")!);

  await vi.waitFor(() => expect(table(el).rows).toHaveLength(2));
  expect(listTaxOfficeInvoices.mock.calls[1]![0]).toEqual({
    from: "2026-11-01",
    to: "2026-11-30",
    after: next,
  });
});

it("Open asks the PDF route for the invoice and opens the PDF in a new tab", async () => {
  const pdf = new Blob(["%PDF"], { type: "application/pdf" });
  const downloadTaxOfficeInvoicePdf = vi.fn().mockResolvedValue(pdf);
  const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:the-pdf");
  const el = await mount({
    listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([twoRates])),
    downloadTaxOfficeInvoicePdf,
  });
  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));
  await table(el).updateComplete;

  const button = table(el).shadowRoot!.querySelector<HTMLElement>("[data-test=open]")!;
  expect(button.localName).toBe("button");
  expect(button.textContent!.trim()).toBe("B/7");
  expect(button.getAttribute("aria-label")).toBe(
    en["tax_office.open_label"].replace("{number}", "B/7"),
  );
  await userEvent.click(button);

  await vi.waitFor(() => expect(open).toHaveBeenCalledWith("blob:the-pdf", "_blank"));
  expect(downloadTaxOfficeInvoicePdf).toHaveBeenCalledWith("sale-2");
  expect(table(el).shadowRoot!.querySelectorAll("[data-test=open]")).toHaveLength(1);
});

it("lets the opened PDF go a minute after opening it, not before", async () => {
  vi.spyOn(window, "open").mockReturnValue({} as Window);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:the-pdf");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const el = await mount({
    listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([twoRates])),
    downloadTaxOfficeInvoicePdf: vi.fn().mockResolvedValue(new Blob(["%PDF"])),
  });
  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));
  await table(el).updateComplete;
  // Only the timer the revoke waits on is faked: no animation frame is paused.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  table(el).shadowRoot!.querySelector<HTMLElement>("[data-test=open]")!.click();
  await vi.waitFor(() => expect(window.open).toHaveBeenCalled());
  vi.advanceTimersByTime(59_000);
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1_000);
  expect(revoke).toHaveBeenCalledWith("blob:the-pdf");
  vi.useRealTimers();
});

it("downloads the PDF when the browser refuses a new tab", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:the-pdf");
  const clicked: { href: string; download: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.href, download: this.download });
  });
  const el = await mount({
    listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([twoRates])),
    downloadTaxOfficeInvoicePdf: vi.fn().mockResolvedValue(new Blob(["%PDF"])),
  });
  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));
  await table(el).updateComplete;

  await userEvent.click(table(el).shadowRoot!.querySelector<HTMLElement>("[data-test=open]")!);

  await vi.waitFor(() => expect(clicked).toEqual([{ href: "blob:the-pdf", download: "B-7.pdf" }]));
});

it("says why an invoice could not be opened, and keeps the list", async () => {
  const el = await mount({
    listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([invoice()])),
    downloadTaxOfficeInvoicePdf: vi.fn().mockRejectedValue({ code: "invoice_delivery.not_found" }),
  });
  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));
  await table(el).updateComplete;

  await userEvent.click(table(el).shadowRoot!.querySelector<HTMLElement>("[data-test=open]")!);

  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=action-error]")?.textContent).toBeTruthy(),
  );
  expect(table(el).errorMessage).toBe("");
  expect(table(el).rows).toHaveLength(1);
});

const monthButton = (el: TaxOfficeScreen) =>
  el.shadowRoot!.querySelector<HTMLElement & { loading: boolean; disabled: boolean }>(
    "[data-test=download-month]",
  )!;

it("names the month of the issue range's start on the download action, in the person's language", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-03-15/to/2026-04-10");
  const el = await mount({ listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([])) });
  await vi.waitFor(() => expect(table(el).loading).toBe(false));

  expect(monthButton(el).textContent!.trim()).toBe("Download March 2026");
  expect(monthButton(el).getAttribute("variant")).toBe("primary");

  setLocale("es-ES");
  el.requestUpdate();
  await el.updateComplete;
  expect(monthButton(el).textContent!.trim()).toBe("Descargar marzo de 2026");
});

it("keeps the download action quiet and switched off while the issue start date is empty", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-03-15/to/2026-04-10");
  const downloadTaxOfficeMonth = vi.fn();
  const el = await mount({
    listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([])),
    downloadTaxOfficeMonth,
  });
  await vi.waitFor(() => expect(table(el).loading).toBe(false));

  changeField(el, "from", "");
  await el.updateComplete;

  expect(monthButton(el).disabled).toBe(true);
  expect(monthButton(el).textContent!.trim()).toBe("Download the month");
  expect(monthButton(el).getAttribute("variant")).toBe("secondary");
  monthButton(el).click();
  expect(downloadTaxOfficeMonth).not.toHaveBeenCalled();
});

it("downloads the start month and saves it under the server's file name", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-03-15/to/2026-04-10");
  const zip = new Blob(["PK"], { type: "application/zip" });
  const downloadTaxOfficeMonth = vi
    .fn()
    .mockResolvedValue({ blob: zip, fileName: "named-by-the-server.zip" });
  const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:the-month");
  const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const clicked: { href: string; download: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.href, download: this.download });
  });
  const el = await mount({
    listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([])),
    downloadTaxOfficeMonth,
  });
  await vi.waitFor(() => expect(table(el).loading).toBe(false));

  await userEvent.click(monthButton(el));

  await vi.waitFor(() =>
    expect(clicked).toEqual([{ href: "blob:the-month", download: "named-by-the-server.zip" }]),
  );
  expect(downloadTaxOfficeMonth).toHaveBeenCalledWith("2026-03");
  expect(created).toHaveBeenCalledWith(zip);
  await vi.waitFor(() => expect(revoked).toHaveBeenCalledWith("blob:the-month"));
  expect(monthButton(el).loading).toBe(false);
});

it("shows the download working and ignores a second press until it ends", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-03-15/to/2026-04-10");
  let finish!: (file: { blob: Blob; fileName: string | null }) => void;
  const downloadTaxOfficeMonth = vi.fn(
    () => new Promise<{ blob: Blob; fileName: string | null }>((resolve) => (finish = resolve)),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:the-month");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const saved: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.download);
  });
  const el = await mount({
    listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([])),
    downloadTaxOfficeMonth,
  });
  await vi.waitFor(() => expect(table(el).loading).toBe(false));

  await userEvent.click(monthButton(el));
  await vi.waitFor(() => expect(monthButton(el).loading).toBe(true));
  expect(monthButton(el).textContent!.trim()).toBe("Preparing March 2026…");
  monthButton(el).click();
  await el.updateComplete;
  expect(downloadTaxOfficeMonth).toHaveBeenCalledTimes(1);

  finish({ blob: new Blob(["PK"]), fileName: null });
  await vi.waitFor(() => expect(monthButton(el).loading).toBe(false));
  expect(monthButton(el).textContent!.trim()).toBe("Download March 2026");
  expect(saved).toEqual(["invoices-2026-03.zip"]);
});

it("says why the month could not be downloaded, and keeps the list", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-03-15/to/2026-04-10");
  const el = await mount({
    listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([invoice()])),
    downloadTaxOfficeMonth: vi.fn().mockRejectedValue({ code: "tax_office.export_running" }),
  });
  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));

  await userEvent.click(monthButton(el));

  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=action-error]")?.textContent!.trim()).toBe(
      "Another month of invoices is already downloading. Try again once that download finishes.",
    ),
  );
  expect(monthButton(el).loading).toBe(false);
  expect(table(el).errorMessage).toBe("");
  expect(table(el).rows).toHaveLength(1);
});

function heldDownload() {
  let finish!: (file: { blob: Blob; fileName: string | null }) => void;
  const downloadTaxOfficeMonth = vi.fn(
    () => new Promise<{ blob: Blob; fileName: string | null }>((resolve) => (finish = resolve)),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:the-month");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const saved: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.download);
  });
  return {
    downloadTaxOfficeMonth,
    saved,
    finish: () => finish({ blob: new Blob(["PK"]), fileName: null }),
  };
}

it("keeps naming the month being downloaded when Issued from moves to another month", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-03-15/to/2026-04-10");
  const held = heldDownload();
  const el = await mount({
    listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([])),
    downloadTaxOfficeMonth: held.downloadTaxOfficeMonth,
  });
  await vi.waitFor(() => expect(table(el).loading).toBe(false));

  await userEvent.click(monthButton(el));
  await vi.waitFor(() => expect(monthButton(el).loading).toBe(true));
  changeField(el, "from", "2026-04-02");
  await el.updateComplete;
  expect(monthButton(el).textContent!.trim()).toBe("Preparing March 2026…");

  held.finish();
  await vi.waitFor(() => expect(monthButton(el).loading).toBe(false));
  expect(held.saved).toEqual(["invoices-2026-03.zip"]);
  expect(held.downloadTaxOfficeMonth).toHaveBeenCalledWith("2026-03");
  expect(monthButton(el).textContent!.trim()).toBe("Download April 2026");
});

it("keeps the download action primary and busy when Issued from is cleared during the download", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-03-15/to/2026-04-10");
  const held = heldDownload();
  const el = await mount({
    listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([])),
    downloadTaxOfficeMonth: held.downloadTaxOfficeMonth,
  });
  await vi.waitFor(() => expect(table(el).loading).toBe(false));

  await userEvent.click(monthButton(el));
  await vi.waitFor(() => expect(monthButton(el).loading).toBe(true));
  changeField(el, "from", "");
  await el.updateComplete;
  expect(monthButton(el).getAttribute("variant")).toBe("primary");
  expect(monthButton(el).disabled).toBe(false);
  expect(monthButton(el).loading).toBe(true);
  expect(monthButton(el).textContent!.trim()).toBe("Preparing March 2026…");

  held.finish();
  await vi.waitFor(() => expect(monthButton(el).loading).toBe(false));
  expect(held.saved).toEqual(["invoices-2026-03.zip"]);
  expect(monthButton(el).disabled).toBe(true);
  expect(monthButton(el).getAttribute("variant")).toBe("secondary");
  expect(monthButton(el).textContent!.trim()).toBe("Download the month");
});

it("clears an earlier download refusal when the month is downloaded again", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-03-15/to/2026-04-10");
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:the-month");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const saved = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const downloadTaxOfficeMonth = vi
    .fn()
    .mockRejectedValueOnce({ code: "tax_office.export_running" })
    .mockResolvedValueOnce({ blob: new Blob(["PK"]), fileName: null });
  const el = await mount({
    listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([])),
    downloadTaxOfficeMonth,
  });
  await vi.waitFor(() => expect(table(el).loading).toBe(false));
  const actionError = () => el.shadowRoot!.querySelector("[data-test=action-error]");

  await userEvent.click(monthButton(el));
  await vi.waitFor(() => expect(actionError()).not.toBeNull());

  await userEvent.click(monthButton(el));
  await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  await el.updateComplete;
  expect(actionError()).toBeNull();
});

it("marks a cancelled invoice Cancelled, with its date on the next line", async () => {
  const el = await mount({
    listTaxOfficeInvoices: vi
      .fn()
      .mockResolvedValue(page([invoice({ cancelledAt: "2026-11-06T09:00:00.000Z" })])),
  });
  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));

  const cancelled = table(el).shadowRoot!.querySelector('[part~="cancelled"]')!;
  expect(cancelled.textContent!.trim()).toBe(en["tax_office.cancelled"]);
  expect(cancelled.nextElementSibling!.textContent!.trim()).toBe("6 Nov 2026");
});

it("names the invoice a corrective corrects, and an operation date that differs", async () => {
  const el = await mount({
    listTaxOfficeInvoices: vi
      .fn()
      .mockResolvedValue(
        page([invoice({ kind: "R5", corrects: ["A/3"], operationDate: "2026-11-01" })]),
      ),
  });
  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));

  const text = await tableText(el);
  expect(text).toContain(en["tax_office.corrects"].replace("{numbers}", "A/3"));
  expect(text).toContain(en["tax_office.operation_on"].replace("{date}", "1 Nov 2026"));
});

it("draws no operation line for an invoice whose operation was on its issue day", async () => {
  const el = await mount({
    listTaxOfficeInvoices: vi.fn().mockResolvedValue(page([invoice()])),
  });
  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));

  expect(await tableText(el)).not.toContain(en["tax_office.operation_on"].replace(" {date}", ""));
});

it("names the simplified invoices a full invoice replaces", async () => {
  const el = await mount({
    listTaxOfficeInvoices: vi
      .fn()
      .mockResolvedValue(page([invoice({ kind: "F3", corrects: ["T/90", "T/91"] })])),
  });
  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));

  expect(await tableText(el)).toContain(
    en["tax_office.replaces"].replace("{numbers}", "T/90, T/91"),
  );
});

it("shows the load message, not an empty list, when the read fails", async () => {
  const el = await mount({
    listTaxOfficeInvoices: vi.fn().mockRejectedValue({ code: "report.failed" }),
  });

  await vi.waitFor(() => expect(table(el).errorMessage).not.toBe(""));
  expect(table(el).errorMessage).not.toBe(table(el).emptyMessage);
  expect(table(el).rows).toEqual([]);
  expect(table(el).loading).toBe(false);
});

it.each([
  ["rate", "rate"],
  ["amount", "amount"],
  ["q", "q"],
  ["from", "from"],
  ["range", "to"],
  ["operationRange", "operationTo"],
  ["kind", "kind"],
] as const)("puts a refusal naming %s beside its field", async (refused, control) => {
  const el = await mount({
    listTaxOfficeInvoices: vi
      .fn()
      .mockRejectedValue({ code: "management.request_invalid", params: { field: refused } }),
  });

  await vi.waitFor(() => expect(field(el, control).error).not.toBe(""));
  expect(table(el).errorMessage).toBe(en["form.fix_fields"]);
});

it("clears an earlier field refusal once a read succeeds", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-11-01/to/2026-11-30/rate/x");
  const listTaxOfficeInvoices = vi
    .fn()
    .mockRejectedValueOnce({ code: "management.request_invalid", params: { field: "rate" } })
    .mockResolvedValueOnce(page([invoice()]));
  const el = await mount({ listTaxOfficeInvoices });
  await vi.waitFor(() => expect(field(el, "rate").error).not.toBe(""));

  field(el, "kind").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "F2" }, bubbles: true, composed: true }),
  );

  await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));
  await el.updateComplete;
  expect(field(el, "rate").error).toBe("");
  expect(table(el).errorMessage).toBe("");
});

it.each(["from", "to"] as const)(
  "marks a cleared %s date as needed, and reads again once it is filled",
  async (name) => {
    history.replaceState(null, "", "/manage/invoices/from/2026-11-01/to/2026-11-30");
    const listTaxOfficeInvoices = vi.fn().mockResolvedValue(page([invoice()]));
    const el = await mount({ listTaxOfficeInvoices });
    await vi.waitFor(() => expect(table(el).rows).toHaveLength(1));
    const change = (value: string) =>
      field(el, name).dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );

    change("");
    await el.updateComplete;
    expect(field(el, name).error).toBe(en["tax_office.date_required"]);
    expect(listTaxOfficeInvoices).toHaveBeenCalledTimes(1);
    expect(table(el).rows).toHaveLength(1);

    change(name === "from" ? "2026-10-01" : "2026-12-31");
    await vi.waitFor(() => expect(listTaxOfficeInvoices).toHaveBeenCalledTimes(2));
    await el.updateComplete;
    expect(field(el, name).error).toBe("");
  },
);

const changeField = (el: TaxOfficeScreen, name: string, value: string) =>
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );

it("keeps a text filter edited moments before another one", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-11-01/to/2026-11-30");
  const listTaxOfficeInvoices = vi.fn().mockResolvedValue(page([]));
  const el = await mount({ listTaxOfficeInvoices });
  await vi.waitFor(() => expect(table(el).loading).toBe(false));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  changeField(el, "q", "Ruiz");
  vi.advanceTimersByTime(100);
  changeField(el, "amount", "34.10");
  vi.advanceTimersByTime(400);
  await el.updateComplete;

  expect(lastQuery(listTaxOfficeInvoices)).toEqual({
    from: "2026-11-01",
    to: "2026-11-30",
    q: "Ruiz",
    amount: "34.10",
  });
  expect(field(el, "q").value).toBe("Ruiz");
  expect(location.pathname).toBe(
    "/manage/invoices/from/2026-11-01/to/2026-11-30/q/Ruiz/amount/34.10",
  );
});

it("drops an edit still waiting to be sent when Back restores an earlier search", async () => {
  const base = "/manage/invoices/from/2026-11-01/to/2026-11-30/q/";
  history.replaceState(null, "", `${base}Restored`);
  history.pushState(null, "", `${base}Current`);
  const listTaxOfficeInvoices = vi.fn().mockResolvedValue(page([]));
  const el = await mount({ listTaxOfficeInvoices });
  await vi.waitFor(() => expect(table(el).loading).toBe(false));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  changeField(el, "q", "Pending");
  const back = new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );
  history.back();
  await back;
  vi.advanceTimersByTime(400);
  await el.updateComplete;

  expect(listTaxOfficeInvoices.mock.calls.map((call) => (call[0] as TaxOfficeQuery).q)).toEqual([
    "Current",
    "Restored",
  ]);
  expect(field(el, "q").value).toBe("Restored");
  expect(location.pathname).toBe(`${base}Restored`);
});

it("reads nothing and leaves the address alone while an issue date is empty, when Search or Kind changes", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-10-01/to/2026-10-31");
  const listTaxOfficeInvoices = vi.fn().mockResolvedValue(page([invoice()]));
  const el = await mount({ listTaxOfficeInvoices });
  await vi.waitFor(() => expect(table(el).loading).toBe(false));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  changeField(el, "from", "");
  changeField(el, "q", "Ruiz");
  vi.advanceTimersByTime(400);
  changeField(el, "kind", "F1");
  await el.updateComplete;

  expect(listTaxOfficeInvoices).toHaveBeenCalledTimes(1);
  expect(location.pathname).toBe("/manage/invoices/from/2026-10-01/to/2026-10-31");
  expect(field(el, "from").value).toBe("");
  expect(field(el, "from").error).toBe(en["tax_office.date_required"]);
  expect(field(el, "q").value).toBe("Ruiz");

  changeField(el, "from", "2026-09-01");
  await vi.waitFor(() => expect(listTaxOfficeInvoices).toHaveBeenCalledTimes(2));
  expect(lastQuery(listTaxOfficeInvoices)).toEqual({
    from: "2026-09-01",
    to: "2026-10-31",
    q: "Ruiz",
    kind: "F1",
  });
});

it("keeps a space still being typed once the app's guarded address takes the search, and reads each search once", async () => {
  history.replaceState(null, "", "/manage/invoices/from/2026-11-01/to/2026-11-30");
  const guard = new NavigationGuard(window, {
    isDirty: () => false,
    request: async (proceed) => {
      await proceed();
      return "proceeded";
    },
  });
  onTestFinished(() => guard.dispose());
  const listTaxOfficeInvoices = vi.fn().mockResolvedValue(page([]));
  const el = await mount({ listTaxOfficeInvoices });
  await vi.waitFor(() => expect(table(el).loading).toBe(false));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  changeField(el, "q", "Comidas ");
  vi.advanceTimersByTime(400);
  await el.updateComplete;

  expect(location.pathname).toBe("/manage/invoices/from/2026-11-01/to/2026-11-30/q/Comidas");
  expect(field(el, "q").value).toBe("Comidas ");

  changeField(el, "q", "Ruiz");
  await el.updateComplete;
  field(el, "q").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  await el.updateComplete;

  expect(location.pathname).toBe("/manage/invoices/from/2026-11-01/to/2026-11-30/q/Ruiz");
  expect(listTaxOfficeInvoices.mock.calls.map((call) => (call[0] as TaxOfficeQuery).q)).toEqual([
    undefined,
    "Comidas",
    "Ruiz",
  ]);
});
