import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type { WtDialog } from "@waitron/ui";
import {
  cleanupWidgets,
  dialogClosed,
  expectNoA11yViolations,
  mountWidget,
} from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import type {
  DashboardApi,
  OrderDeliveries,
  OrderDeliveryAttempt,
  OrderDetailDto,
} from "../api/client.js";
import "./order-detail-dialog.js";
import type { OrderDetailDialog } from "./order-detail-dialog.js";

const attempt = (over: Partial<OrderDeliveryAttempt> = {}): OrderDeliveryAttempt => ({
  id: "delivery-1",
  medium: "a4",
  designation: "original",
  status: "queued",
  failureCode: null,
  requestedAt: "2026-10-12T10:00:00Z",
  at: null,
  personId: "ana",
  personName: "Ana",
  printerHold: null,
  lateSuccess: false,
  ...over,
});

const deliveries = (
  current: OrderDeliveryAttempt | null,
  over: Partial<OrderDeliveries> = {},
): OrderDeliveries => ({
  current,
  originalCompleted: false,
  originalPrinterId: null,
  actions: { retryOriginal: null, print: null, receiptInstead: null, email: null },
  history: current === null ? [] : [current],
  ...over,
});

const PRINTERS = [
  { id: "printer-1", name: "Barra", kind: "receipt" as const },
  { id: "page-1", name: "Oficina", kind: "a4" as const },
];

const f1 = (
  status: OrderDeliveries | null,
  over: Partial<OrderDetailDto> = {},
): OrderDetailDto => ({
  row: {
    kind: "bill",
    id: "bill-1",
    at: "2026-10-12T09:00:00Z",
    orderNumber: 12,
    label: null,
    partyId: null,
    partyName: null,
    tables: [],
    counter: false,
    saleId: "sale-1",
    invoiceNumber: "A/12",
    invoiceType: "F1",
    creditNotes: [],
    status: "paid",
    credited: null,
    total: "30.00",
    stillOwed: null,
    staff: [],
    departedAt: null,
  },
  lines: [],
  invoices: [],
  tenders: [],
  payments: [],
  party: null,
  departure: null,
  reprints: [],
  deliveries: status,
  invoicePdfDownloads: [],
  ...over,
});

type Stubbed = DashboardApi & {
  getOrder: ReturnType<typeof vi.fn>;
  background: { getOrder: ReturnType<typeof vi.fn> };
  downloadOrderInvoicePdf: ReturnType<typeof vi.fn>;
  requestOrderEmailDelivery: ReturnType<typeof vi.fn>;
  retryOrderEmailDelivery: ReturnType<typeof vi.fn>;
};

function stubApi(detail: OrderDetailDto, overrides: Record<string, unknown> = {}): Stubbed {
  return {
    getOrder: vi.fn().mockResolvedValue(detail),
    background: { getOrder: vi.fn().mockResolvedValue(detail) },
    liveData: new LiveData(),
    downloadOrderInvoicePdf: vi.fn().mockResolvedValue(new Blob(["%PDF"])),
    requestOrderEmailDelivery: vi.fn().mockResolvedValue(attempt({ medium: "email" })),
    retryOrderEmailDelivery: vi.fn().mockResolvedValue(attempt({ medium: "email" })),
    ...overrides,
  } as unknown as Stubbed;
}

async function open(
  api: DashboardApi,
  props: Partial<OrderDetailDialog> = {},
): Promise<OrderDetailDialog> {
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
    mayReprint: () => true,
    mayExport: true,
    ...props,
  });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("section")).not.toBeNull());
  return el;
}

/** The dialog awaited the request before this test did, so its handling has run once this returns. */
async function handled(el: OrderDetailDialog, request: Promise<unknown>): Promise<void> {
  await request.catch(() => undefined);
  await el.updateComplete;
}

const find = (el: OrderDetailDialog, test: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`);
const text = (el: OrderDetailDialog, test: string) =>
  find(el, test)?.textContent?.replace(/\s+/g, " ").trim();
const footerButtons = (el: OrderDetailDialog) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("wt-form-actions[slot=footer] wt-button")].map(
    (button) => button.dataset.test ?? button.textContent!.trim(),
  );

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanupWidgets();
  setLocale("es-ES");
});

describe("the full invoice's delivery status", () => {
  it.each([
    ["no attempt yet", null, "Not sent yet.", "Aún no enviada."],
    [
      "an A4 waiting for the office printer",
      attempt(),
      "Waiting for the office printer.",
      "Esperando a la impresora de oficina.",
    ],
    [
      "a receipt original waiting for its printer",
      attempt({ medium: "receipt" }),
      "Waiting for the receipt printer.",
      "Esperando a la impresora de tickets.",
    ],
    [
      "an email waiting to go",
      attempt({ medium: "email" }),
      "Sending the invoice.",
      "Enviando la factura.",
    ],
    [
      "an A4 being sent",
      attempt({ status: "sending" }),
      "Sending the invoice.",
      "Enviando la factura.",
    ],
    ["an A4 printed", attempt({ status: "sent" }), "Printed on A4.", "Impresa en A4."],
    [
      "a receipt original printed",
      attempt({ medium: "receipt", status: "sent" }),
      "Printed on the receipt printer.",
      "Impresa en la impresora de tickets.",
    ],
    [
      "an email sent",
      attempt({ medium: "email", status: "sent" }),
      "Sent by email.",
      "Enviada por correo electrónico.",
    ],
    [
      "an attempt that failed",
      attempt({ status: "failed", failureCode: "printer_refused" }),
      "Not delivered.",
      "No entregada.",
    ],
    [
      "an attempt that may not have arrived",
      attempt({ status: "unknown", failureCode: "timeout" }),
      "May not have been delivered.",
      "Puede que no se haya entregado.",
    ],
    [
      "an A4 that ended unknown while the printer held it",
      attempt({ status: "unknown", failureCode: "timeout", printerHold: "paper_jam" }),
      "May still print: check the printer first.",
      "Puede que aún se imprima: comprueba primero la impresora.",
    ],
  ])("says what happened for %s, in English and Spanish", async (_name, current, en, es) => {
    setLocale("en-GB");
    const el = await open(stubApi(f1(deliveries(current))));
    expect(text(el, "delivery-status")).toBe(en);
    setLocale("es-ES");
    el.requestUpdate();
    await el.updateComplete;
    expect(text(el, "delivery-status")).toBe(es);
  });

  it.each([
    ["paper_out", "Waiting at the office printer: out of paper.", "sin papel"],
    ["paper_jam", "Waiting at the office printer: paper jam.", "atasco de papel"],
    ["cover_open", "Waiting at the office printer: a cover is open.", "hay una tapa abierta"],
    ["tray_missing", "Waiting at the office printer: a tray is missing.", "falta una bandeja"],
    [
      "ink_or_toner_out",
      "Waiting at the office printer: out of ink or toner.",
      "sin tinta o tóner",
    ],
    [
      "output_full",
      "Waiting at the office printer: the output tray is full.",
      "la bandeja de salida está llena",
    ],
    ["paused", "Waiting at the office printer: paused.", "en pausa"],
    ["stopped", "Waiting at the office printer: stopped.", "detenida"],
  ])(
    "says why the office printer holds an A4 (%s), and offers no A4 while it does",
    async (hold, en, es) => {
      setLocale("en-GB");
      const el = await open(
        stubApi(f1(deliveries(attempt({ status: "sending", printerHold: hold })))),
      );
      expect(text(el, "delivery-status")).toBe(en);
      expect(find(el, "print-invoice")).toBeNull();
      expect(find(el, "download-pdf")).not.toBeNull();
      setLocale("es-ES");
      el.requestUpdate();
      await el.updateComplete;
      expect(text(el, "delivery-status")).toBe(`Esperando en la impresora de oficina: ${es}.`);
    },
  );

  it.each(["toString", "lid_melted"])(
    "says only that the A4 waits at the printer for a hold it has no words for (%s)",
    async (hold) => {
      setLocale("en-GB");
      const el = await open(
        stubApi(f1(deliveries(attempt({ status: "sending", printerHold: hold })))),
      );
      expect(text(el, "delivery-status")).toBe("Waiting at the office printer.");
    },
  );

  it("lists every attempt with when, how, which copy, how it ended and who asked, and each PDF download, newest first", async () => {
    setLocale("en-GB");
    const current = attempt({
      id: "delivery-2",
      designation: "duplicate",
      status: "sent",
      requestedAt: "2026-10-12T11:00:00Z",
      personName: "Luis",
    });
    const history = [
      current,
      attempt({
        id: "delivery-1",
        medium: "email",
        status: "failed",
        failureCode: "transport_failed",
        personName: null,
        personId: "gone",
      }),
      attempt({ id: null, medium: "receipt", status: "sent", personId: null, personName: null }),
    ];
    const el = await open(
      stubApi(
        f1(deliveries(current, { history }), {
          invoicePdfDownloads: [
            { requestedAt: "2026-10-12T12:00:00Z", personId: "rosa", personName: "Rosa" },
            { requestedAt: "2026-10-12T13:00:00Z", personId: "gone", personName: null },
          ],
        }),
      ),
    );
    const lines = [...el.shadowRoot!.querySelectorAll("[data-test=delivery-history] li")].map(
      (line) => line.textContent!.replace(/\s+/g, " ").trim(),
    );
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^12 Oct 2026, \d\d:00: PDF downloaded by Unknown person$/);
    expect(lines[1]).toMatch(/^12 Oct 2026, \d\d:00: PDF downloaded by Rosa$/);
    expect(lines[2]).toMatch(/^12 Oct 2026, \d\d:00 · A4 · Copy · Delivered · Requested by Luis$/);
    expect(lines[3]).toMatch(
      /^12 Oct 2026, \d\d:00 · Email · Original · Not delivered · Requested by Unknown person$/,
    );
    expect(lines[4]).toMatch(/^12 Oct 2026, \d\d:00 · Receipt printer · Original · Delivered$/);
  });

  it("puts each PDF download among the attempts by its time; at the same time an attempt comes first, and each kind keeps the order the server sent", async () => {
    setLocale("en-GB");
    const at = (time: string, personName: string) =>
      attempt({ requestedAt: `2026-10-12T${time}Z`, personName, status: "sent" });
    const download = (time: string, personName: string) => ({
      requestedAt: `2026-10-12T${time}Z`,
      personId: personName,
      personName,
    });
    const history = [at("11:00:00", "Luis"), at("10:00:00", "Ana"), at("10:00:00", "Eva")];
    const el = await open(
      stubApi(
        f1(deliveries(history[0]!, { history }), {
          // The server sends downloads oldest first (`readPdfDownloads`, apps/server/src/orders-list.ts).
          invoicePdfDownloads: [
            download("10:00:00", "Rosa"),
            download("10:30:00", "Pepe"),
            download("10:30:00", "Marta"),
            download("12:00:00", "Juan"),
          ],
        }),
      ),
    );
    const names = [...el.shadowRoot!.querySelectorAll("[data-test=delivery-history] li")].map(
      (line) => /(?:by|Requested by) (\w+)$/.exec(line.textContent!.trim())![1],
    );
    expect(names).toEqual(["Juan", "Luis", "Pepe", "Marta", "Ana", "Eva", "Rosa"]);
  });

  it.each([
    [
      "paper_out",
      "sending",
      "Waiting at the office printer",
      "Esperando en la impresora de oficina",
    ],
    [
      "lid_melted",
      "sending",
      "Waiting at the office printer",
      "Esperando en la impresora de oficina",
    ],
    [null, "sending", "Sending", "Enviando"],
    ["paper_jam", "unknown", "Uncertain", "Sin confirmar"],
  ] as const)(
    "words a history attempt the office printer holds (%s, %s) as the status line does",
    async (hold, status, en, es) => {
      setLocale("en-GB");
      const el = await open(stubApi(f1(deliveries(attempt({ status, printerHold: hold })))));
      expect(text(el, "delivery-history")).toMatch(
        new RegExp(`^12 Oct 2026, \\d\\d:00 · A4 · Original · ${en} · Requested by Ana$`),
      );
      setLocale("es-ES");
      el.requestUpdate();
      await el.updateComplete;
      expect(text(el, "delivery-history")).toContain(`A4 · Original · ${es} · Pedida por Ana`);
    },
  );

  it("words the history in Spanish", async () => {
    setLocale("es-ES");
    const current = attempt({ status: "unknown", designation: "duplicate" });
    const el = await open(stubApi(f1(deliveries(current))));
    const line = text(el, "delivery-history");
    expect(line).toContain("A4 · Copia · Sin confirmar · Pedida por Ana");
  });

  it("shows no delivery section, and only Reprint, for a simplified invoice", async () => {
    setLocale("en-GB");
    const simplified = f1(null);
    simplified.row = { ...simplified.row, invoiceType: "F2" };
    const el = await open(stubApi(simplified));
    expect(find(el, "delivery-status")).toBeNull();
    expect(find(el, "delivery-history")).toBeNull();
    expect(footerButtons(el)).toEqual(["Reprint receipt"]);
  });
});

describe("Print invoice and Download PDF", () => {
  const offered = (designation: "original" | "duplicate" = "original") =>
    f1(
      deliveries(null, {
        actions: {
          retryOriginal: null,
          print: { printers: PRINTERS, designation },
          receiptInstead: null,
          email: null,
        },
      }),
    );

  it("offers Print invoice and Download PDF", async () => {
    setLocale("en-GB");
    const el = await open(stubApi(offered()), { mayReprint: () => false });
    expect(footerButtons(el)).toEqual(["print-invoice", "download-pdf"]);
    expect(text(el, "print-invoice")).toBe("Print invoice");
    expect(text(el, "download-pdf")).toBe("Download PDF");
  });

  it.each([
    ["en-GB", "original", null, "Print invoice"],
    ["en-GB", "duplicate", null, "Print a copy"],
    ["en-GB", "original", "a4", "Print invoice"],
    ["es-ES", "original", null, "Imprimir factura"],
    ["es-ES", "duplicate", null, "Imprimir una copia"],
    ["es-ES", "original", "a4", "Imprimir factura"],
  ] as const)(
    "labels the print action in %s for an %s (retry %s)",
    async (locale, designation, retry, label) => {
      setLocale(locale);
      const detail = offered(designation);
      detail.deliveries!.actions.retryOriginal = retry === null ? null : { medium: retry };
      const el = await open(stubApi(detail));
      expect(text(el, "print-invoice")).toBe(label);
    },
  );

  it("offers no print the server does not offer", async () => {
    setLocale("en-GB");
    const el = await open(stubApi(f1(deliveries(attempt({ status: "sent" })))));
    expect(find(el, "print-invoice")).toBeNull();
    expect(find(el, "download-pdf")).not.toBeNull();
  });

  it.each(["en-GB", "es-ES"])(
    "keeps every button inside the dialog at phone width (%s)",
    async (locale) => {
      setLocale(locale);
      await page.viewport(390, 844);
      try {
        const detail = offered();
        detail.deliveries!.actions.retryOriginal = { medium: "a4" };
        const el = await open(stubApi(detail));
        const box = el
          .shadowRoot!.querySelector("wt-dialog")!
          .shadowRoot!.querySelector("dialog")!
          .getBoundingClientRect();
        const buttons = [...el.shadowRoot!.querySelectorAll("wt-button")];
        expect(buttons).toHaveLength(3);
        for (const button of buttons) {
          const { left, right } = button.getBoundingClientRect();
          expect.soft(left, button.textContent!.trim()).toBeGreaterThanOrEqual(box.left);
          expect.soft(right, button.textContent!.trim()).toBeLessThanOrEqual(box.right);
        }
      } finally {
        await page.viewport(1280, 768);
      }
    },
  );

  it("draws no empty footer when no action is open to this person", async () => {
    const el = await open(stubApi(f1(deliveries(attempt({ status: "sent" })))), {
      mayExport: false,
      mayReprint: () => false,
    });
    const footer = el.shadowRoot!.querySelector("wt-dialog")!.shadowRoot!.querySelector(".footer")!;
    expect(footer.classList.contains("has-content")).toBe(false);
  });

  it("hides Download PDF without permission to export reports", async () => {
    setLocale("en-GB");
    const el = await open(stubApi(offered()), { mayExport: false });
    expect(find(el, "download-pdf")).toBeNull();
    expect(find(el, "print-invoice")).not.toBeNull();
  });

  it("asks for the printer list with the bill's row, and sends nothing itself", async () => {
    setLocale("en-GB");
    const detail = offered();
    const api = stubApi(detail);
    const el = await open(api);
    const asked = vi.fn();
    el.addEventListener("order-invoice-print", (event) =>
      asked((event as CustomEvent<{ row: OrderDetailDto["row"] }>).detail),
    );
    const reprint = vi.fn();
    el.addEventListener("order-reprint", reprint);
    find(el, "print-invoice")!.click();
    expect(asked).toHaveBeenCalledWith({ row: detail.row });
    expect(reprint).not.toHaveBeenCalled();
    expect(api.downloadOrderInvoicePdf).not.toHaveBeenCalled();
    expect(api.requestOrderEmailDelivery).not.toHaveBeenCalled();
  });

  it("keeps Download PDF and both email actions beside Print invoice", async () => {
    setLocale("en-GB");
    const detail = offered("duplicate");
    detail.deliveries!.current = attempt({
      id: "delivery-9",
      medium: "email",
      status: "failed",
      failureCode: "smtp_refused",
    });
    detail.deliveries!.actions.retryOriginal = { medium: "email" };
    detail.deliveries!.actions.email = { designation: "duplicate" };
    const el = await open(stubApi(detail), { mayReprint: () => false });
    expect(footerButtons(el)).toEqual([
      "print-invoice",
      "email-again",
      "email-invoice",
      "download-pdf",
    ]);
  });

  it("keeps a refused action's reason apart from a failed read, and clears it when the next action starts", async () => {
    setLocale("en-GB");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const api = stubApi(offered(), {
      downloadOrderInvoicePdf: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const el = await open(api);
    find(el, "download-pdf")!.click();
    await vi.waitFor(() => expect(find(el, "delivery-refused")).not.toBeNull());
    api.background.getOrder.mockRejectedValue({ code: "connection.failed" });
    api.liveData.refresh();
    await vi.waitFor(() => expect(text(el, "read-failed")).toBe(codeMessage("connection.failed")));
    expect(text(el, "delivery-refused")).toBe(codeMessage("authorization.not_permitted"));
    api.background.getOrder.mockResolvedValue(offered());
    api.liveData.refresh();
    await vi.waitFor(() => expect(find(el, "read-failed")).toBeNull());
    expect(text(el, "delivery-refused")).toBe(codeMessage("authorization.not_permitted"));
    api.downloadOrderInvoicePdf.mockResolvedValue(new Blob(["%PDF"]));
    find(el, "download-pdf")!.click();
    await vi.waitFor(() => expect(find(el, "delivery-refused")).toBeNull());
  });

  it("forgets a refused action when another bill opens", async () => {
    setLocale("en-GB");
    const api = stubApi(offered(), {
      downloadOrderInvoicePdf: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const el = await open(api);
    find(el, "download-pdf")!.click();
    await vi.waitFor(() => expect(find(el, "delivery-refused")).not.toBeNull());
    el.orderId = "bill-2";
    await vi.waitFor(() => expect(api.background.getOrder).toHaveBeenCalledWith("bill-2"));
    await vi.waitFor(() => expect(find(el, "delivery-status")).not.toBeNull());
    expect(find(el, "delivery-refused")).toBeNull();
  });

  it("keeps Download PDF busy only for the bill it was pressed for", async () => {
    setLocale("en-GB");
    const refusals = new Map<string, (error: unknown) => void>();
    const requests = new Map<string, Promise<unknown>>();
    const api = stubApi(offered(), {
      downloadOrderInvoicePdf: vi.fn((id: string) => {
        const request = new Promise((_resolve, reject) => refusals.set(id, reject));
        requests.set(id, request);
        return request;
      }),
    });
    const el = await open(api);
    find(el, "download-pdf")!.click();
    await vi.waitFor(() => expect(find(el, "download-pdf")?.hasAttribute("loading")).toBe(true));
    el.orderId = "bill-2";
    await el.updateComplete;
    await vi.waitFor(() => expect(find(el, "delivery-status")).not.toBeNull());
    expect(find(el, "download-pdf")!.hasAttribute("loading")).toBe(false);
    find(el, "download-pdf")!.click();
    await vi.waitFor(() => expect(api.downloadOrderInvoicePdf).toHaveBeenLastCalledWith("bill-2"));
    await vi.waitFor(() => expect(find(el, "download-pdf")?.hasAttribute("loading")).toBe(true));
    refusals.get("bill-1")!({ code: "authorization.not_permitted" });
    await handled(el, requests.get("bill-1")!);
    expect(find(el, "download-pdf")!.hasAttribute("loading")).toBe(true);
    expect(find(el, "delivery-refused")).toBeNull();
    refusals.get("bill-2")!({ code: "authorization.not_permitted" });
    await vi.waitFor(() => expect(find(el, "download-pdf")?.hasAttribute("loading")).toBe(false));
    expect(text(el, "delivery-refused")).toBe(codeMessage("authorization.not_permitted"));
  });

  it("saves the downloaded PDF under the invoice's series and number", async () => {
    setLocale("en-GB");
    const file = new Blob(["%PDF"]);
    const detail = offered();
    detail.row = { ...detail.row, invoiceNumber: "T 2026/7" };
    const api = stubApi(detail, { downloadOrderInvoicePdf: vi.fn().mockResolvedValue(file) });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:invoice");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    const el = await open(api);
    find(el, "download-pdf")!.click();
    await vi.waitFor(() => expect(clicked).toHaveLength(1));
    expect(api.downloadOrderInvoicePdf).toHaveBeenCalledWith("bill-1");
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(clicked[0]!.download).toBe("T_2026-7.pdf");
    expect(clicked[0]!.href).toBe("blob:invoice");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:invoice");
    await vi.waitFor(() => expect(api.background.getOrder).toHaveBeenCalled());
  });

  it("names a plain series' PDF with a dash before the number", async () => {
    setLocale("en-GB");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:invoice");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    const el = await open(stubApi(offered()));
    find(el, "download-pdf")!.click();
    await vi.waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0]!.download).toBe("A-12.pdf");
  });

  it("sends one download while one is out, and drops its refusal once another bill opened", async () => {
    setLocale("en-GB");
    let refuse!: (error: unknown) => void;
    let request!: Promise<unknown>;
    const api = stubApi(offered(), {
      downloadOrderInvoicePdf: vi.fn(
        () => (request = new Promise((_resolve, reject) => (refuse = reject))),
      ),
    });
    const el = await open(api);
    find(el, "download-pdf")!.click();
    await vi.waitFor(() => expect(find(el, "download-pdf")?.hasAttribute("loading")).toBe(true));
    find(el, "download-pdf")!.click();
    expect(api.downloadOrderInvoicePdf).toHaveBeenCalledTimes(1);
    el.orderId = "bill-2";
    await vi.waitFor(() => expect(api.background.getOrder).toHaveBeenCalledWith("bill-2"));
    await vi.waitFor(() => expect(find(el, "delivery-status")).not.toBeNull());
    refuse({ code: "authorization.not_permitted" });
    await handled(el, request);
    expect(find(el, "download-pdf")!.hasAttribute("loading")).toBe(false);
    expect(find(el, "delivery-refused")).toBeNull();
  });

  it("says why a download was refused and keeps the dialog", async () => {
    setLocale("en-GB");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const api = stubApi(offered(), {
      downloadOrderInvoicePdf: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const el = await open(api);
    find(el, "download-pdf")!.click();
    await vi.waitFor(() =>
      expect(text(el, "delivery-refused")).toBe(codeMessage("authorization.not_permitted")),
    );
    expect(click).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
  });
});

describe("sending the invoice by email", () => {
  const emailOffered = (
    designation: "original" | "duplicate" = "original",
    current: OrderDeliveryAttempt | null = null,
    retry: OrderDeliveryAttempt["medium"] | null = null,
  ) =>
    f1(
      deliveries(current, {
        actions: {
          retryOriginal: retry === null ? null : { medium: retry },
          print: { printers: PRINTERS, designation },
          receiptInstead: null,
          email: { designation },
        },
      }),
    );
  const failedEmail = () =>
    attempt({ id: "delivery-9", medium: "email", status: "failed", failureCode: "smtp_refused" });
  const emailDialog = (el: OrderDetailDialog) =>
    el.shadowRoot!.querySelector("dashboard-invoice-email-dialog")!;
  const emailDialogBox = (el: OrderDetailDialog) =>
    emailDialog(el).shadowRoot!.querySelector<WtDialog>("wt-dialog")!;

  it("offers Send by email beside the other actions", async () => {
    setLocale("en-GB");
    const el = await open(stubApi(emailOffered()));
    expect(footerButtons(el)).toEqual([
      "print-invoice",
      "email-invoice",
      "download-pdf",
      "Reprint receipt",
    ]);
  });

  it.each([
    ["en-GB", "original", null, "Send by email", null],
    ["en-GB", "duplicate", null, "Send a copy by email", null],
    ["en-GB", "original", "email", "Send to another address", "Send the email again"],
    ["es-ES", "original", null, "Enviar por correo electrónico", null],
    ["es-ES", "duplicate", null, "Enviar una copia por correo electrónico", null],
    ["es-ES", "original", "email", "Enviar a otra dirección", "Volver a enviar el correo"],
  ] as const)(
    "labels the email actions in %s for an %s (retry %s)",
    async (locale, designation, retry, label, again) => {
      setLocale(locale);
      const current = retry === null ? null : failedEmail();
      const el = await open(stubApi(emailOffered(designation, current, retry)));
      expect(text(el, "email-invoice")).toBe(label);
      expect(text(el, "email-again")).toBe(again ?? undefined);
    },
  );

  it("offers Send the email again before Send to another address", async () => {
    setLocale("en-GB");
    const el = await open(stubApi(emailOffered("original", failedEmail(), "email")));
    expect(footerButtons(el)).toEqual([
      "print-invoice",
      "email-again",
      "email-invoice",
      "download-pdf",
      "Reprint receipt",
    ]);
  });

  it("offers no email the server does not offer", async () => {
    setLocale("en-GB");
    const detail = emailOffered("original", failedEmail(), "a4");
    detail.deliveries!.actions.email = null;
    const el = await open(stubApi(detail));
    expect(find(el, "email-invoice")).toBeNull();
    expect(find(el, "email-again")).toBeNull();
    expect(find(el, "print-invoice")).not.toBeNull();
  });

  it("hides both email actions without permission to export reports", async () => {
    setLocale("en-GB");
    const el = await open(stubApi(emailOffered("original", failedEmail(), "email")), {
      mayExport: false,
    });
    expect(find(el, "email-invoice")).toBeNull();
    expect(find(el, "email-again")).toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-invoice-email-dialog")).toBeNull();
    expect(find(el, "print-invoice")).not.toBeNull();
  });

  it("asks for the address for this bill, and its closing leaves the order detail open", async () => {
    setLocale("en-GB");
    const el = await open(stubApi(emailOffered()));
    const closes: Event[] = [];
    const parent = el.parentElement!;
    const listen = (event: Event) => closes.push(event);
    parent.addEventListener("wt-close", listen);
    try {
      find(el, "email-invoice")!.click();
      await vi.waitFor(() => expect(emailDialogBox(el).open).toBe(true));
      const closed = dialogClosed(emailDialogBox(el));
      emailDialogBox(el).querySelector<HTMLElement>("[data-test=cancel-email]")!.click();
      await closed;
      expect(emailDialogBox(el).open).toBe(false);
      expect(el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("wt-dialog")!.open).toBe(
        true,
      );
      expect(closes).toHaveLength(0);
    } finally {
      parent.removeEventListener("wt-close", listen);
    }
  });

  it("sends the typed address for this bill, then reads the bill again", async () => {
    setLocale("en-GB");
    const api = stubApi(emailOffered());
    const el = await open(api);
    find(el, "email-invoice")!.click();
    await vi.waitFor(() => expect(emailDialogBox(el).open).toBe(true));
    const reads = api.background.getOrder.mock.calls.length;
    emailDialogBox(el)
      .querySelector("wt-input[name=email]")!
      .dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "ana@example.com" },
          bubbles: true,
          composed: true,
        }),
      );
    await emailDialog(el).updateComplete;
    emailDialogBox(el).querySelector<HTMLElement>("[data-test=send-email]")!.click();
    await vi.waitFor(() => expect(emailDialogBox(el).open).toBe(false));
    expect(api.requestOrderEmailDelivery).toHaveBeenCalledWith(
      "bill-1",
      "ana@example.com",
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    await vi.waitFor(() =>
      expect(api.background.getOrder.mock.calls.length).toBeGreaterThan(reads),
    );
    expect(el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("wt-dialog")!.open).toBe(
      true,
    );
  });

  it.each(["en-GB", "es-ES"])(
    "keeps all five buttons inside the dialog at phone width (%s)",
    async (locale) => {
      setLocale(locale);
      await page.viewport(390, 844);
      try {
        const el = await open(stubApi(emailOffered("original", failedEmail(), "email")));
        const box = el
          .shadowRoot!.querySelector("wt-dialog")!
          .shadowRoot!.querySelector("dialog")!
          .getBoundingClientRect();
        const buttons = [...el.shadowRoot!.querySelectorAll("wt-form-actions wt-button")];
        expect(buttons).toHaveLength(5);
        for (const button of buttons) {
          const { left, right } = button.getBoundingClientRect();
          expect.soft(left, button.textContent!.trim()).toBeGreaterThanOrEqual(box.left);
          expect.soft(right, button.textContent!.trim()).toBeLessThanOrEqual(box.right);
        }
      } finally {
        await page.viewport(1280, 768);
      }
    },
  );

  it.each([
    ["original", "Send by email"],
    ["duplicate", "Send a copy by email"],
  ] as const)("heads the address dialog for an %s as its button", async (designation, heading) => {
    setLocale("en-GB");
    const el = await open(stubApi(emailOffered(designation)));
    find(el, "email-invoice")!.click();
    await vi.waitFor(() => expect(emailDialogBox(el).open).toBe(true));
    expect(emailDialogBox(el).heading).toBe(heading);
  });

  it("closes the address dialog when the order detail moves to another bill", async () => {
    setLocale("en-GB");
    const api = stubApi(emailOffered());
    const el = await open(api);
    find(el, "email-invoice")!.click();
    await vi.waitFor(() => expect(emailDialogBox(el).open).toBe(true));
    el.orderId = "bill-2";
    await vi.waitFor(() => expect(emailDialogBox(el).open).toBe(false));
  });

  it("sends the email again through the ended attempt under a new request key each press, then reads the bill again", async () => {
    setLocale("en-GB");
    const api = stubApi(emailOffered("original", failedEmail(), "email"));
    const el = await open(api);
    const reads = api.background.getOrder.mock.calls.length;
    find(el, "email-again")!.click();
    await vi.waitFor(() => expect(api.retryOrderEmailDelivery).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(api.background.getOrder.mock.calls.length).toBeGreaterThan(reads),
    );
    await vi.waitFor(() => expect(find(el, "email-again")?.hasAttribute("loading")).toBe(false));
    find(el, "email-again")!.click();
    await vi.waitFor(() => expect(api.retryOrderEmailDelivery).toHaveBeenCalledTimes(2));
    const [first, second] = api.retryOrderEmailDelivery.mock.calls as [string, string, string][];
    expect(first!.slice(0, 2)).toEqual(["bill-1", "delivery-9"]);
    expect(first![2]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second![2]).not.toBe(first![2]);
  });

  it("sends one request while Send the email again is out", async () => {
    setLocale("en-GB");
    let answer!: (value: OrderDeliveryAttempt) => void;
    const api = stubApi(emailOffered("original", failedEmail(), "email"), {
      retryOrderEmailDelivery: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    });
    const el = await open(api);
    find(el, "email-again")!.click();
    await vi.waitFor(() => expect(find(el, "email-again")?.hasAttribute("loading")).toBe(true));
    find(el, "email-again")!.click();
    expect(api.retryOrderEmailDelivery).toHaveBeenCalledTimes(1);
    answer(attempt({ medium: "email" }));
    await vi.waitFor(() => expect(find(el, "email-again")?.hasAttribute("loading")).toBe(false));
  });

  it("keeps Send the email again busy only for the bill it was pressed for", async () => {
    setLocale("en-GB");
    let answer!: (value: OrderDeliveryAttempt) => void;
    let request!: Promise<unknown>;
    const api = stubApi(emailOffered("original", failedEmail(), "email"), {
      retryOrderEmailDelivery: vi
        .fn()
        .mockImplementationOnce(() => (request = new Promise((resolve) => (answer = resolve))))
        .mockResolvedValue(attempt({ medium: "email" })),
    });
    const el = await open(api);
    find(el, "email-again")!.click();
    await vi.waitFor(() => expect(find(el, "email-again")?.hasAttribute("loading")).toBe(true));
    el.orderId = "bill-2";
    await vi.waitFor(() => expect(api.background.getOrder).toHaveBeenCalledWith("bill-2"));
    await vi.waitFor(() => expect(find(el, "email-again")).not.toBeNull());
    expect(find(el, "email-again")!.hasAttribute("loading")).toBe(false);
    find(el, "email-again")!.click();
    await vi.waitFor(() => expect(api.retryOrderEmailDelivery).toHaveBeenCalledTimes(2));
    expect(api.retryOrderEmailDelivery.mock.calls[1]![0]).toBe("bill-2");
    answer(attempt({ medium: "email" }));
    await handled(el, request);
  });

  it("says why beside the buttons when Send the email again is refused", async () => {
    setLocale("en-GB");
    const api = stubApi(emailOffered("original", failedEmail(), "email"), {
      retryOrderEmailDelivery: vi
        .fn()
        .mockRejectedValue({ code: "invoice_delivery.email_unavailable" }),
    });
    const el = await open(api);
    find(el, "email-again")!.click();
    await vi.waitFor(() =>
      expect(text(el, "delivery-refused")).toBe(codeMessage("invoice_delivery.email_unavailable")),
    );
    expect(find(el, "read-failed")).toBeNull();
    const body = [...el.shadowRoot!.querySelector("wt-dialog")!.children].filter(
      (child) => child.getAttribute("slot") !== "footer",
    );
    expect(body.at(-1)).toBe(find(el, "delivery-refused"));
  });

  it("drops a Send the email again refusal that arrives after another bill opened", async () => {
    setLocale("en-GB");
    let refuse!: (error: unknown) => void;
    let request!: Promise<unknown>;
    const api = stubApi(emailOffered("original", failedEmail(), "email"), {
      retryOrderEmailDelivery: vi.fn(
        () => (request = new Promise((_resolve, reject) => (refuse = reject))),
      ),
    });
    const el = await open(api);
    find(el, "email-again")!.click();
    await vi.waitFor(() => expect(api.retryOrderEmailDelivery).toHaveBeenCalled());
    el.orderId = "bill-2";
    await vi.waitFor(() => expect(api.background.getOrder).toHaveBeenCalledWith("bill-2"));
    await vi.waitFor(() => expect(find(el, "delivery-status")).not.toBeNull());
    refuse({ code: "invoice_delivery.active" });
    await handled(el, request);
    expect(find(el, "delivery-refused")).toBeNull();
  });
});

describe("re-reading while an attempt is on its way", () => {
  it("reads the bill again every 5 s through the passive client while an attempt waits or sends, and stops once it ends", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    setLocale("en-GB");
    const api = stubApi(f1(deliveries(attempt())));
    api.background.getOrder.mockResolvedValue(f1(deliveries(attempt({ status: "sending" }))));
    const el = await open(api);
    expect(api.background.getOrder).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    await vi.waitFor(() => expect(api.background.getOrder).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(text(el, "delivery-status")).toBe("Sending the invoice."));
    api.background.getOrder.mockResolvedValue(f1(deliveries(attempt({ status: "sent" }))));
    vi.advanceTimersByTime(5_000);
    await vi.waitFor(() => expect(text(el, "delivery-status")).toBe("Printed on A4."));
    vi.advanceTimersByTime(20_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.background.getOrder).toHaveBeenCalledTimes(2);
    expect(api.getOrder).toHaveBeenCalledTimes(1);
  });

  it("does not re-read a delivery that is not on its way", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    setLocale("en-GB");
    const api = stubApi(f1(deliveries(attempt({ status: "failed" }))));
    await open(api);
    vi.advanceTimersByTime(15_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.background.getOrder).not.toHaveBeenCalled();
  });

  it("keeps re-reading after a failed read while the last read showed an attempt waiting", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    setLocale("en-GB");
    const api = stubApi(f1(deliveries(attempt())));
    api.background.getOrder.mockRejectedValue({ code: "connection.failed" });
    const el = await open(api);
    vi.advanceTimersByTime(5_000);
    await vi.waitFor(() => expect(find(el, "read-failed")).not.toBeNull());
    api.background.getOrder.mockResolvedValue(f1(deliveries(attempt({ status: "sent" }))));
    vi.advanceTimersByTime(5_000);
    await vi.waitFor(() => expect(text(el, "delivery-status")).toBe("Printed on A4."));
    expect(find(el, "read-failed")).toBeNull();
  });

  // The closed dialog's own query is released, so a stray timer is seen through another reader
  // of the same resource.
  const sentinel = (api: DashboardApi) => {
    const read = vi.fn().mockResolvedValue(null);
    api.liveData.observe(
      { key: "sentinel", dependencies: [{ type: "invoice_deliveries" }], read },
      () => {},
    );
    return read;
  };

  it("stops re-reading when the dialog closes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    setLocale("en-GB");
    const api = stubApi(f1(deliveries(attempt())));
    const el = await open(api);
    const read = sentinel(api);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    vi.advanceTimersByTime(5_000);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    el.orderId = null;
    await el.updateComplete;
    vi.advanceTimersByTime(15_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("stops re-reading when the dialog leaves the page", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    setLocale("en-GB");
    const api = stubApi(f1(deliveries(attempt())));
    const el = await open(api);
    const read = sentinel(api);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    el.remove();
    vi.advanceTimersByTime(15_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("accessibility", () => {
  const offer = {
    retryOriginal: null,
    print: { printers: PRINTERS, designation: "duplicate" as const },
    receiptInstead: null,
    email: null,
  };
  const emailFailed = attempt({ medium: "email", status: "failed", failureCode: "smtp_refused" });
  const emailOffer = {
    retryOriginal: { medium: "email" as const },
    print: { printers: PRINTERS, designation: "original" as const },
    receiptInstead: null,
    email: { designation: "original" as const },
  };
  const states: [string, OrderDetailDto, Record<string, unknown>?][] = [
    [
      "waiting, with its history and a download",
      f1(deliveries(attempt()), {
        invoicePdfDownloads: [
          { requestedAt: "2026-10-12T12:00:00Z", personId: "rosa", personName: "Rosa" },
        ],
      }),
    ],
    [
      "held at the printer",
      f1(deliveries(attempt({ status: "sending", printerHold: "paper_out" }))),
    ],
    [
      "unknown after a hold",
      f1(
        deliveries(
          attempt({ status: "unknown", failureCode: "timeout", printerHold: "paper_jam" }),
        ),
      ),
    ],
    [
      "printed, offering a copy",
      f1(deliveries(attempt({ status: "sent" }), { originalCompleted: true, actions: offer })),
    ],
    [
      "refused beside a failed read",
      f1(deliveries(attempt({ status: "sent" }), { originalCompleted: true, actions: offer })),
      { refused: true },
    ],
    [
      "an email that failed, offering both email actions",
      f1(deliveries(emailFailed, { actions: emailOffer })),
    ],
    [
      "an email sent again and refused",
      f1(deliveries(emailFailed, { actions: emailOffer })),
      { emailRefused: true },
    ],
  ];
  for (const locale of ["en-GB", "es-ES"])
    for (const theme of ["light", "dark"] as const)
      for (const [name, detail, flags] of states)
        it(`has no violations ${name} (${locale}, ${theme})`, async () => {
          setLocale(locale);
          const api = stubApi(detail, {
            downloadOrderInvoicePdf: vi
              .fn()
              .mockRejectedValue({ code: "authorization.not_permitted" }),
            retryOrderEmailDelivery: vi
              .fn()
              .mockRejectedValue({ code: "invoice_delivery.email_unavailable" }),
          });
          const { el, host } = await mountWidget<OrderDetailDialog>(
            "dashboard-order-detail-dialog",
            { api, orderId: "bill-1", mayReprint: () => true, mayExport: true },
            theme,
          );
          await vi.waitFor(() => expect(find(el, "delivery-status")).not.toBeNull());
          if (flags?.refused) {
            find(el, "download-pdf")!.click();
            await vi.waitFor(() => expect(find(el, "delivery-refused")).not.toBeNull());
            api.background.getOrder.mockRejectedValue({ code: "connection.failed" });
            api.liveData.refresh();
            await vi.waitFor(() => expect(find(el, "read-failed")).not.toBeNull());
          }
          if (flags?.emailRefused) {
            find(el, "email-again")!.click();
            await vi.waitFor(() => expect(find(el, "delivery-refused")).not.toBeNull());
          }
          await expectNoA11yViolations(host);
        });
});
