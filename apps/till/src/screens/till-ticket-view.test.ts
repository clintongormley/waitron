import { equipmentItem, roleOf } from "../../test/pay-equipment-fixtures.js";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { codeMessage } from "../i18n/codes.js";
import { qrSvg } from "../qr.js";
import { t as uiText, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillTicketView } from "./till-ticket-view.js";
import type {
  InvoiceDeliveryAttempt,
  InvoiceDeliveryStatus,
  OriginalReceiptPrint,
  TillSaleResult,
} from "../api/client.js";

// A mixed-rate ticket with a weighed line: café 2 → 3,00 (21 %), jamón 0,320 kg → 6,40 (10 %).
// Total 9,40; €10 cash tendered → 0,60 change.
const result: TillSaleResult = {
  receiptTrim: {},
  venueAddress: [],
  receiptSettings: { printAddress: false },
  orderLabel: "Table 6",
  orderNumber: 41,
  invoiceNumber: "A/1",
  issuedAt: "2026-08-05T12:34:56.000Z",
  total: "9.40",
  vatBreakdown: [
    { rate: "21.00", base: "2.48", tax: "0.52" },
    { rate: "10.00", base: "5.82", tax: "0.58" },
  ],
  lines: [
    { descriptions: { "es-ES": "Café", en: "Coffee" }, quantity: "2", gross: "3.00" },
    {
      descriptions: { "es-ES": "Jamón", en: "Ham" },
      unitName: { "es-ES": "kg" },
      unitPrecision: 3,
      quantity: "0.32",
      gross: "6.40",
    },
  ],
  tender: { method: "cash", change: "0.60" },
  qr: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=A%2F1&fecha=05-08-2026&importe=9.40",
  qrText: { caption: "QR tributario:", legend: "VERI*FACTU" },
};

const mount = (over: Partial<TillSaleResult> = {}) =>
  mountWidget<TillTicketView>("till-ticket-view", {
    result: { ...result, ...over },
    // Pinned so the "operator UI is English, ticket stays Spanish" test is unambiguous.
    invoiceLocale: "es-ES",
  });

const text = (el: TillTicketView): string => el.shadowRoot!.textContent ?? "";

// setLocale mutates module-level state; put the shipped default (en-GB) back for the other suites.
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("till-ticket-view", () => {
  it("draws the supplied practice marks on either side of the receipt contents", async () => {
    const { el } = await mount({
      receiptPreview: [
        { kind: "text", text: "DOCUMENTO DE PRUEBA", indent: 0 },
        { kind: "rule" },
        { kind: "amount", caption: "2  Plato del día", amount: "9,40 A", indent: { after: "2  " } },
        { kind: "rule" },
        { kind: "text", text: "DOCUMENTO DE PRUEBA", indent: 0 },
      ],
    });
    const article = el.shadowRoot!.querySelector("article")!;
    const body = article.textContent!;
    expect(body.match(/DOCUMENTO DE PRUEBA/g)).toHaveLength(2);
    expect(body.indexOf("Plato del día")).toBeGreaterThan(body.indexOf("DOCUMENTO DE PRUEBA"));
    expect(body.indexOf("9,40 A")).toBeLessThan(body.lastIndexOf("DOCUMENTO DE PRUEBA"));
    expect(body).not.toContain("Jamón");
    const caption = getComputedStyle(article.querySelector(".receipt-amount span")!);
    expect(caption.textIndent).not.toBe("0px");
    expect(caption.paddingInlineStart).not.toBe("0px");
  });

  it("associates supplied headings with the item, continuation and tax columns", async () => {
    const header = {
      units: "Uds.",
      item: "Artículo",
      price: "Precio",
      amount: "Importe",
      rate: "IVA",
    };
    const { el } = await mount({
      receiptPreview: [
        { kind: "align", alignment: "center" },
        { kind: "text", text: "Factura", indent: 0, style: { bold: true } },
        { kind: "align", alignment: "left" },
        {
          kind: "table",
          table: {
            header,
            withRate: true,
            rows: [{ units: "4", item: "Croquetas", price: "1,00", amount: "4,00", rate: "10%" }],
          },
        },
        { kind: "text", text: "<b>Artículo a granel</b>", indent: 0 },
        {
          kind: "table",
          table: {
            withRate: true,
            rows: [
              {
                units: "",
                item: "Descuento",
                itemIndent: 2,
                price: "",
                amount: "−0,50",
                rate: "10%",
              },
            ],
          },
        },
        {
          kind: "taxTable",
          header: { rate: "IVA", base: "Base imponible", tax: "Cuota", total: "Total" },
          rows: [{ rate: "A 10%", base: "3,50", tax: "0,35", total: "3,85" }],
        },
      ],
    });
    const tables = [...el.shadowRoot!.querySelectorAll("article table")];
    expect(getComputedStyle(tables[0]!.previousElementSibling!).fontWeight).toBe("600");
    expect(
      tables.map((table) =>
        [...table.querySelectorAll("th[scope=col]")].map((cell) => cell.textContent!.trim()),
      ),
    ).toEqual([
      ["Uds.", "Artículo", "Precio", "Importe", "IVA"],
      ["Uds.", "Artículo", "Precio", "Importe", "IVA"],
      ["IVA", "Base imponible", "Cuota", "Total"],
    ]);
    expect(
      tables.map((table) => table.querySelector("th[scope=row]")?.textContent?.trim()),
    ).toEqual(["Croquetas", "Descuento", "A 10%"]);
    expect(tables[0]!.querySelector("tbody td")?.textContent).toBe("4");
    expect(el.shadowRoot!.querySelector("article")?.textContent).toContain(
      "<b>Artículo a granel</b>",
    );
    expect(el.shadowRoot!.querySelector("article b")).toBeNull();
  });

  it("leaves the receipt area empty when the answer has no preview", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("article")?.textContent?.trim() ?? "").toBe("");
    expect(el.shadowRoot!.querySelector("[data-test=reprint]")).not.toBeNull();
  });

  it.each([
    ["en-GB", "es-ES", "Café", "9,40 €"],
    ["es-ES", "en-GB", "Coffee", "€9.40"],
  ])("uses %s controls beside the supplied %s receipt", async (ui, locale, name, total) => {
    setLocale(ui);
    const { el } = await mount({
      locale,
      receiptPreview: [{ kind: "amount", caption: name, amount: total, indent: 0 }],
    });
    const article = el.shadowRoot!.querySelector("article")!;
    expect(article.lang).toBe(locale);
    expect(article.textContent).toContain(name);
    expect(article.textContent).toContain(total);
    expect(el.shadowRoot!.querySelector("[data-test=reprint]")!.textContent).toContain(
      uiText("action.reprint", ui),
    );
  });

  it("hides drawer opening on a historical cash receipt even when the device can open it", async () => {
    const { el } = await mount();
    el.canOpenDrawer = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=open-drawer]")).not.toBeNull();
    el.historical = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=open-drawer]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=reprint]")).not.toBeNull();
  });
  it.each([
    [undefined, "Checking the original print status…", null],
    [{ status: "not_queued" }, "The original has not been sent to a printer.", "print-receipt"],
    [
      { status: "queued", jobId: "original", canRetry: false },
      "The original is waiting to print.",
      null,
    ],
    [{ status: "printing", jobId: "original", canRetry: false }, "The original is printing.", null],
    [
      { status: "failed", jobId: "original", canRetry: false },
      "Printing failed. Automatic retry is pending.",
      null,
    ],
    [
      { status: "failed", jobId: "original", canRetry: true },
      "Printing failed. Retry the original.",
      "retry-receipt",
    ],
    [
      { status: "done", jobId: "original", canRetry: false },
      "Printing completed. Hand the original to the customer.",
      "reprint",
    ],
  ] as const)("keeps F1 undelivered with original status %j", async (print, message, action) => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: { ...result, invoiceType: "F1" },
      originalReceiptPrint: print as OriginalReceiptPrint | undefined,
      originalReceiptAvailable: true,
    });
    const warning = el.shadowRoot!.querySelector("[data-test=original-delivery]");
    expect(warning?.textContent).toContain("Full invoice not delivered");
    expect(warning?.textContent).toContain(message);
    for (const name of ["print-receipt", "retry-receipt", "reprint"]) {
      expect(el.shadowRoot!.querySelector(`[data-test=${name}]`) !== null).toBe(name === action);
    }
    expect(el.shadowRoot!.querySelector("[data-test=refresh-receipt]")).not.toBeNull();
    expect(el.result.invoiceNumber).toBe("A/1");
  });

  it.each([
    ["en-GB", "The printer was deleted, so this job will not be retried.", "Automatic retry"],
    [
      "es-ES",
      "La impresora se eliminó, así que este trabajo no se volverá a intentar.",
      "reintento automático",
    ],
  ])(
    "says a failed original's printer was deleted, with no retry, in %s",
    async (locale, message, autoRetry) => {
      setLocale(locale);
      const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
        result: { ...result, invoiceType: "F1" },
        originalReceiptPrint: {
          status: "failed",
          jobId: "original",
          canRetry: false,
          failureCode: "printer.deleted",
        },
        originalReceiptAvailable: true,
      });
      const status = el.shadowRoot!.querySelector("[data-test=original-delivery]")!.textContent!;
      expect(status).toContain(message);
      expect(status).not.toContain(autoRetry);
      for (const name of ["print-receipt", "retry-receipt", "reprint"]) {
        expect(el.shadowRoot!.querySelector(`[data-test=${name}]`)).toBeNull();
      }
      expect(el.shadowRoot!.querySelector("[data-test=refresh-receipt]")).not.toBeNull();
    },
  );

  it.each(["en-GB", "es-ES"])(
    "confirms F1 customer handover independently of printing capability in %s",
    async (locale) => {
      setLocale(locale);
      const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
        result: { ...result, invoiceType: "F1" },
        originalReceiptPrint: { status: "done", jobId: "original", canRetry: false },
        canPrintReceipt: false,
      });
      const button = el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-handover]");
      expect(button).not.toBeNull();
      expect(button!.textContent).toContain(
        locale === "en-GB"
          ? "I handed the original to the customer"
          : "He entregado el original al cliente",
      );
      let event: Event | undefined;
      el.addEventListener("confirm-handover", (e) => {
        event = e;
      });
      button!.click();
      expect(event?.bubbles).toBe(true);
      expect(event?.composed).toBe(true);
      el.originalReceiptBusy = true;
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector("[data-test=confirm-handover]")?.hasAttribute("disabled"),
      ).toBe(true);
      el.originalReceiptBusy = false;
      el.originalReceiptPrint = {
        status: "done",
        jobId: "original",
        canRetry: false,
        handover: { personId: "staff", confirmedAt: "2026-08-05T12:40:00.000Z" },
      };
      await el.updateComplete;
      const status = el.shadowRoot!.querySelector("[data-test=original-delivery]")!.textContent!;
      expect(status).toContain(
        locale === "en-GB" ? "Customer handover confirmed" : "Entrega al cliente confirmada",
      );
      expect(status).not.toContain(
        locale === "en-GB" ? "Full invoice not delivered" : "Factura completa no entregada",
      );
      expect(status).not.toContain(
        locale === "en-GB" ? "Hand the original" : "Entrega el original",
      );
      expect(el.shadowRoot!.querySelector("[data-test=confirm-handover]")).toBeNull();
      expect(el.result.invoiceNumber).toBe("A/1");
    },
  );

  it.each([
    { status: "not_queued" },
    { status: "queued", jobId: "original", canRetry: false },
    { status: "printing", jobId: "original", canRetry: false },
    { status: "failed", jobId: "original", canRetry: true },
  ] as const)(
    "does not offer customer handover before an original completes: %j",
    async (print) => {
      const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
        result: { ...result, invoiceType: "F1" },
        originalReceiptPrint: print,
      });
      expect(el.shadowRoot!.querySelector("[data-test=confirm-handover]")).toBeNull();
    },
  );

  it("keeps F1 status visible without device printing capability and exposes only the status check", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: { ...result, invoiceType: "F1" },
      originalReceiptPrint: { status: "not_queued" },
      canPrintReceipt: false,
    });
    expect(el.shadowRoot!.querySelector("[data-test=original-delivery]")?.textContent).toContain(
      "Factura completa no entregada",
    );
    expect(el.shadowRoot!.querySelector("[data-test=original-delivery]")?.textContent).toContain(
      "El original no se ha enviado a una impresora.",
    );
    expect(el.shadowRoot!.querySelector("[data-test=print-receipt]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=retry-receipt]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=refresh-receipt]")).not.toBeNull();
  });

  it("emits original retry and status check events while preserving the filed result", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: { ...result, invoiceType: "F1" },
      originalReceiptPrint: { status: "failed", jobId: "original", canRetry: true },
    });
    for (const name of ["retry-receipt", "refresh-receipt"]) {
      let event: Event | undefined;
      el.addEventListener(name, (e) => {
        event = e;
      });
      el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`)!.click();
      expect(event?.bubbles).toBe(true);
      expect(event?.composed).toBe(true);
    }
    el.originalReceiptBusy = true;
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector("[data-test=retry-receipt]")?.hasAttribute("disabled"),
    ).toBe(true);
    expect(
      el.shadowRoot!.querySelector("[data-test=refresh-receipt]")?.hasAttribute("disabled"),
    ).toBe(true);
    expect(el.result.invoiceNumber).toBe("A/1");
  });

  it("does not show an F1 delivery warning or retry action for F2", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: { ...result, invoiceType: "F2" },
      originalReceiptPrint: { status: "failed", jobId: "original", canRetry: true },
      originalReceiptAvailable: true,
    });
    expect(el.shadowRoot!.querySelector("[data-test=original-delivery]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=retry-receipt]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=print-receipt]")).not.toBeNull();
  });

  it.each(["light", "dark"] as const)(
    "wraps long supplied invoice text on a phone (%s)",
    async (theme) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const customer = "Customer".repeat(12);
      await page.viewport(390, 844);
      try {
        const { el } = await mountWidget<TillTicketView>(
          "till-ticket-view",
          {
            result: {
              ...result,
              invoiceType: "F1",
              receiptPreview: [{ kind: "text", text: customer, indent: 0 }],
            },
          },
          theme,
        );
        const row = el.shadowRoot!.querySelector<HTMLElement>("article p")!;
        expect(row.textContent).toContain(customer);
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
      } finally {
        await page.viewport(width, height);
      }
    },
  );

  it("registers as a custom element", () => {
    expect(customElements.get("till-ticket-view")).toBe(TillTicketView);
  });

  it("keeps the logo no wider than the ticket and no taller than its own bound", async () => {
    const { el } = await mount({
      receiptTrim: { logo: "venue.png" },
      receiptPreview: [{ kind: "logo" }],
    });
    const logo = el.shadowRoot!.querySelector<HTMLImageElement>("article img.logo")!;
    const style = getComputedStyle(logo);
    expect(style.maxWidth).toBe("100%");
    expect(style.maxHeight).not.toBe("none");
    expect(style.objectFit).toBe("contain");
  });

  it("renders the supplied QR and centers it between its caption and legend", async () => {
    const url = "https://example.test/verify/17";
    const { el } = await mount({
      receiptPreview: [
        { kind: "align", alignment: "center" },
        { kind: "text", text: "QR tributario:", indent: 0 },
        { kind: "qr", text: url },
        { kind: "text", text: "VERI*FACTU", indent: 0 },
        { kind: "rule" },
        { kind: "text", text: "Filed issuer", indent: 0 },
      ],
    });
    const qr = el.shadowRoot!.querySelector("article .qr")!;
    const expected = new DOMParser().parseFromString(qrSvg(url), "image/svg+xml");
    expect(qr.querySelector("path")?.getAttribute("d")).toBe(
      expected.querySelector("path")!.getAttribute("d"),
    );
    expect(qr.previousElementSibling?.textContent?.trim()).toBe("QR tributario:");
    expect(qr.nextElementSibling?.textContent?.trim()).toBe("VERI*FACTU");
    expect(getComputedStyle(qr).textAlign).toBe("center");
    expect(getComputedStyle(qr.previousElementSibling!).textAlign).toBe("center");
  });

  it("keeps outside-card details beside the receipt and the manual reference within it", async () => {
    const { el } = await mount({
      receiptPreview: [{ kind: "text", text: "Ref. 4471", indent: 0 }],
      tender: {
        method: "card",
        charged: "20.90",
        tip: "0.00",
        reference: "4471",
        externalProvider: "other",
        externalMachine: "Bank counter",
      },
    });
    const article = el.shadowRoot!.querySelector("article")!;
    expect(article.textContent).toContain("Ref. 4471");
    expect(article.textContent).not.toContain("Bank counter");
    expect(text(el)).toContain("Bank counter");
    expect(text(el)).toContain(uiText("tender.outside_other"));
  });

  it("emits a composed new-sale event when New sale is pressed", async () => {
    const { el } = await mount();
    let captured: Event | undefined;
    el.addEventListener("new-sale", (e) => (captured = e));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.new-sale")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
  });

  it("emits a composed, bubbling reprint event when Reprint is pressed (no API call from the view)", async () => {
    const { el } = await mount();
    let captured: Event | undefined;
    el.addEventListener("reprint", (e) => (captured = e));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=reprint]")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("offers the original at completion, then emits print-receipt instead of reprint", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result,
      originalReceiptAvailable: true,
    });
    let captured: Event | undefined;
    el.addEventListener("print-receipt", (event) => (captured = event));
    expect(el.shadowRoot!.querySelector("[data-test=reprint]")).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=print-receipt]")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  describe("a bill paid in parts before its invoice", () => {
    it("pairs each outside-card detail with its payment and operation number", async () => {
      const { el } = await mount({
        total: "30.00",
        receiptPreview: [{ kind: "text", text: "TOTAL", indent: 0 }],
        payments: [
          {
            method: "card",
            amount: "10.00",
            tip: "0.00",
            reference: "OP-A",
            externalProvider: "other",
            externalMachine: "Bank counter",
            refunds: [],
          },
          {
            method: "card",
            amount: "20.00",
            tip: "0.00",
            reference: "OP-B",
            externalProvider: "connected_account",
            externalMachine: "Spare Solo",
            refunds: [],
          },
        ],
      });
      const facts = [...el.shadowRoot!.querySelectorAll("[data-outside-payment-fact]")];
      expect(facts).toHaveLength(2);
      expect(facts[0]!.textContent).toContain("OP-A");
      expect(facts[0]!.textContent).toContain("Bank counter");
      expect(facts[1]!.textContent).toContain("OP-B");
      expect(facts[1]!.textContent).toContain("Spare Solo");
      expect(
        el.shadowRoot!.querySelector("article")!.querySelector("[data-outside-card-details]"),
      ).toBeNull();
    });
  });

  const slipButtons = (el: TillTicketView) => [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=payment-slip]"),
  ];
  const slipLabels = (el: TillTicketView) =>
    slipButtons(el).map((button) => button.textContent!.replace(/\s+/gu, " ").trim());
  const firstCard = { id: "pay-1", charged: "4.40", last4: "1111" };
  const secondCard = { id: "pay-2", charged: "5.00", last4: "2222" };

  it("offers one Payment slip button for the sale's one card, naming that payment", async () => {
    const { el: cash } = await mount();
    expect(slipButtons(cash)).toEqual([]);

    const { el: card } = await mount({ paymentSlips: [firstCard] });
    const [button, ...others] = slipButtons(card);
    expect(others).toEqual([]);
    expect(button!.textContent!.trim()).toBe(uiText("action.payment_slip"));
    let captured: CustomEvent | undefined;
    card.addEventListener("payment-slip", (event) => (captured = event as CustomEvent));
    button!.click();
    expect(captured!.detail).toEqual({ capturedPaymentId: "pay-1" });
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it.each(["unpaid", "deferred"] as const)(
    "offers no card slip for an %s tender the server lists no payment for",
    async (method) => {
      for (const over of [{}, { paymentSlips: [] }]) {
        const { el } = await mount({ tender: { method }, ...over });
        expect(slipButtons(el)).toEqual([]);
        expect(el.shadowRoot!.querySelector(".payment-slips")).toBeNull();
      }
    },
  );

  it("offers each card of a split sale separately, and a press names only that card", async () => {
    const { el } = await mount({ paymentSlips: [firstCard, secondCard] });
    const group = el.shadowRoot!.querySelector<HTMLElement>(".payment-slips")!;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.textContent).toContain(uiText("action.payment_slip"));
    const buttons = slipButtons(el);
    expect(slipLabels(el)).toEqual(["Card · 1111 · €4.40", "Card · 2222 · €5.00"]);
    const asked: unknown[] = [];
    el.addEventListener("payment-slip", (event) => asked.push((event as CustomEvent).detail));
    buttons[1]!.click();
    expect(asked).toEqual([{ capturedPaymentId: "pay-2" }]);
  });

  it("names a card with no recorded digits by its amount", async () => {
    const { el } = await mount({
      paymentSlips: [
        { id: "pay-1", charged: "5.00", last4: null },
        { id: "pay-2", charged: "6.00", last4: null },
      ],
    });
    expect(slipLabels(el)).toEqual(["Card · €5.00", "Card · €6.00"]);
  });

  it("numbers only the buttons that would otherwise read the same, keeping their order", async () => {
    const { el } = await mount({
      paymentSlips: [
        { id: "pay-1", charged: "5.00", last4: null },
        { id: "pay-2", charged: "5.00", last4: "1111" },
        { id: "pay-3", charged: "6.00", last4: null },
        { id: "pay-4", charged: "5.00", last4: null },
        { id: "pay-5", charged: "5.00", last4: "1111" },
      ],
    });
    expect(slipLabels(el)).toEqual([
      "Card 1 · €5.00",
      "Card 1 · 1111 · €5.00",
      "Card · €6.00",
      "Card 2 · €5.00",
      "Card 2 · 1111 · €5.00",
    ]);
    const asked: unknown[] = [];
    el.addEventListener("payment-slip", (event) => asked.push((event as CustomEvent).detail));
    slipButtons(el)[3]!.click();
    expect(asked).toEqual([{ capturedPaymentId: "pay-4" }]);
  });

  it("numbers identical buttons in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mount({
      paymentSlips: [
        { id: "pay-1", charged: "5.00", last4: null },
        { id: "pay-2", charged: "5.00", last4: null },
      ],
    });
    expect(slipLabels(el).map((label) => label.replace(/\s/gu, " "))).toEqual([
      "Tarjeta 1 · 5,00 €",
      "Tarjeta 2 · 5,00 €",
    ]);
  });

  it.each([
    ["cash", { method: "cash", amount: "3.00", tip: "0.00", reference: null, refunds: [] }],
    [
      "an outside machine's card",
      {
        method: "card",
        amount: "3.00",
        tip: "0.00",
        reference: "OP-A",
        externalProvider: "other",
        externalMachine: "Bank counter",
        refunds: [],
      },
    ],
  ])("keeps every label when %s was paid first", async (_, earlier) => {
    const { el } = await mount({
      payments: [earlier] as TillSaleResult["payments"],
      paymentSlips: [firstCard, secondCard],
    });
    expect(slipLabels(el)).toEqual(["Card · 1111 · €4.40", "Card · 2222 · €5.00"]);
  });

  it("offers no payment slip on a past receipt", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: { ...result, paymentSlips: [firstCard, secondCard] },
      historical: true,
    });
    expect(slipButtons(el)).toEqual([]);
    expect(el.shadowRoot!.querySelector(".payment-slips")).toBeNull();
  });

  it("hides receipt and payment-slip actions when this enrolled device cannot print them", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: {
        ...result,
        tender: { method: "card", charged: "9.40", tip: "0.00", reference: null },
        paymentSlips: [firstCard, secondCard],
      },
      originalReceiptAvailable: true,
      canPrintReceipt: false,
    });
    expect(el.shadowRoot!.querySelector("[data-test=print-receipt]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=reprint]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=payment-slip]")).toBeNull();
    expect(el.shadowRoot!.querySelector(".payment-slips")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=open-drawer]")).not.toBeNull();
  });

  it("emits a composed, bubbling open-drawer event when Abrir cajón is pressed", async () => {
    const { el } = await mount();
    let captured: Event | undefined;
    el.addEventListener("open-drawer", (e) => (captured = e));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=open-drawer]")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("hides the manual drawer action when the caller cannot open a drawer", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result,
      canOpenDrawer: false,
    });

    expect(el.shadowRoot!.querySelector("[data-test=open-drawer]")).toBeNull();
  });

  it("labels the reprint + open-drawer buttons in the operator-UI locale, flipping with the UI language", async () => {
    // UNLIKE the fiscal ticket body, these OPERATOR actions read the operator-UI `t()`.
    setLocale("es-ES");
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("[data-test=reprint]")!.textContent).toContain(
      "Reimprimir",
    );
    expect(el.shadowRoot!.querySelector("[data-test=open-drawer]")!.textContent).toContain(
      "Abrir cajón",
    );
    setLocale("en");
    const { el: enEl } = await mount();
    expect(enEl.shadowRoot!.querySelector("[data-test=reprint]")!.textContent).toContain("Reprint");
    expect(enEl.shadowRoot!.querySelector("[data-test=open-drawer]")!.textContent).toContain(
      "Open drawer",
    );
  });
});

describe("till-ticket-view: a full invoice's delivery (A231q B5)", () => {
  const noActions: InvoiceDeliveryStatus["actions"] = {
    retryOriginal: null,
    print: null,
    receiptInstead: null,
    email: null,
  };
  const attempt = (over: Partial<InvoiceDeliveryAttempt>): InvoiceDeliveryAttempt => ({
    id: "d1",
    medium: "a4",
    designation: "original",
    status: "queued",
    failureCode: null,
    requestedAt: "2026-08-05T12:35:00.000Z",
    at: null,
    personId: "staff",
    printerHold: null,
    lateSuccess: false,
    ...over,
  });
  const statusOf = (
    current: InvoiceDeliveryAttempt | null,
    actions: Partial<InvoiceDeliveryStatus["actions"]> = {},
  ): InvoiceDeliveryStatus => ({
    current,
    originalCompleted: current?.status === "sent",
    originalPrinterId: current?.medium === "a4" ? "p1" : null,
    actions: { ...noActions, ...actions },
    history: current === null ? [] : [current],
  });
  const a4Offer = {
    printers: [{ id: "p1", name: "Office", kind: "a4" as const }],
    designation: "original" as const,
  };
  const mountF1 = (props: Record<string, unknown>, over: Partial<TillSaleResult> = {}) =>
    mountWidget<TillTicketView>("till-ticket-view", {
      result: { ...result, invoiceType: "F1", ...over },
      originalReceiptPrint: { status: "not_queued" },
      ...props,
    });
  const line = (el: TillTicketView) =>
    el.shadowRoot!.querySelector("[data-test=delivery-status]")?.textContent?.trim();
  const button = (el: TillTicketView, name: string) =>
    el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`);

  it("keeps document choice folded, names A4, and saves Invoice choice without printing", async () => {
    const { el } = await mountF1({
      deliveries: statusOf(null, { print: a4Offer }),
      invoicePrintersEnabled: true,
      invoiceEquipment: {
        role: "invoice",
        selection: "default",
        chosenId: null,
        chosen: null,
        resolved: { id: "p1", name: "Office", available: true },
        default: { id: "p1", name: "Office", kind: "a4" },
        choices: [{ id: "p2", name: "Bar", kind: "receipt" }],
      },
    });
    const opened: Event[] = [];
    const picks: unknown[] = [];
    const prints: Event[] = [];
    el.addEventListener("invoice-printer-open", (event) => opened.push(event));
    el.addEventListener("equipment-change", (event) => picks.push((event as CustomEvent).detail));
    el.addEventListener("print-invoice", (event) => prints.push(event));
    expect(el.shadowRoot!.querySelector("wt-combobox")).toBeNull();
    expect(button(el, "document-print-toggle")).not.toBeNull();
    await userEvent.click(button(el, "document-print-toggle")!);
    await userEvent.click(button(el, "document-invoice")!);
    const field = el.shadowRoot!.querySelector("wt-combobox")!;
    expect(field).not.toBeNull();
    expect(field.options.map((item) => [item.value, item.label])).toEqual([
      ["", "Use default: Office"],
      ["p2", "Bar · receipt paper"],
    ]);
    expect(field.closest('[role="status"]')).toBeNull();
    field.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "p2" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(opened).toHaveLength(1);
    expect(opened[0]!.bubbles && opened[0]!.composed).toBe(true);
    expect(picks).toEqual([{ role: "invoice", selection: { id: "p2" }, via: "list" }]);
    expect(prints).toHaveLength(0);
    expect(button(el, "print-invoice")!.textContent!.trim()).toBe("Print on Office");
  });

  it("shows the default and paper while keeping controls outside delivery announcements", async () => {
    const { el } = await mountF1({
      invoicePrintersEnabled: true,
      invoiceEquipment: {
        role: "invoice",
        selection: "default",
        chosenId: null,
        chosen: null,
        resolved: { id: "p1", name: "Office", available: true },
        default: { id: "p1", name: "Office", kind: "a4" },
        choices: [],
      },
      deliveries: statusOf(attempt({ status: "failed" })),
      deliveryRefusal: {},
    });
    await userEvent.click(button(el, "document-print-toggle")!);
    await userEvent.click(button(el, "document-invoice")!);
    expect(button(el, "invoice-printer-toggle")!.textContent).toContain("Office · A4");
    await el.updateComplete;
    const field = el.shadowRoot!.querySelector("wt-combobox")!;
    await field.updateComplete;
    expect(field.shadowRoot!.querySelector(".value")!.textContent!.trim()).toBe(
      "Use default: Office",
    );
    expect(button(el, "delivery-status")!.closest('[role="status"]')).not.toBeNull();
    expect(
      button(el, "delivery-refused")!.closest('[role="status"], [role="alert"]'),
    ).not.toBeNull();
    expect(field.closest('[role="status"], [role="alert"]')).toBeNull();
  });

  it("does not say again when the failed A4's destination differs from the offered printer", async () => {
    const { el } = await mountF1({
      deliveries: {
        ...statusOf(attempt({ status: "failed" }), {
          print: a4Offer,
          retryOriginal: { medium: "a4" },
        }),
        originalPrinterId: "another",
      },
    });
    expect(button(el, "print-invoice")!.textContent!.trim()).toBe("Print on Office");
  });

  it("keeps printing available on a failed chooser read but blocks an unconfirmed pick", async () => {
    const { el } = await mountF1({
      deliveries: statusOf(null, { print: a4Offer }),
      invoicePrintersEnabled: true,
      invoicePrinterReadFailed: true,
    });
    await userEvent.click(button(el, "document-print-toggle")!);
    await userEvent.click(button(el, "document-invoice")!);
    expect(button(el, "invoice-printer-read-retry")).not.toBeNull();
    expect(button(el, "print-invoice")!.hasAttribute("disabled")).toBe(false);
    Object.assign(el, { invoicePrinterBlocked: true });
    el.requestUpdate();
    await el.updateComplete;
    expect(button(el, "print-invoice")!.hasAttribute("disabled")).toBe(true);
  });

  it.each([
    [
      { status: "queued" },
      "Waiting for the office printer.",
      "Esperando a la impresora de oficina.",
    ],
    [{ status: "sending" }, "Sending the invoice.", "Enviando la factura."],
    [{ medium: "email", status: "queued" }, "Sending the invoice.", "Enviando la factura."],
    [{ medium: "email", status: "sending" }, "Sending the invoice.", "Enviando la factura."],
    [{ status: "sent" }, "Printed on A4.", "Impresa en A4."],
    [{ medium: "email", status: "sent" }, "Sent by email.", "Enviada por correo electrónico."],
    [{ status: "failed" }, "Not delivered.", "No entregada."],
    [{ medium: "email", status: "failed" }, "Not delivered.", "No entregada."],
    [{ status: "unknown" }, "May not have been delivered.", "Puede que no se haya entregado."],
    [
      { medium: "email", status: "unknown" },
      "May not have been delivered.",
      "Puede que no se haya entregado.",
    ],
    [
      { status: "unknown", printerHold: "paper_out" },
      "May still print: check the printer first.",
      "Puede que aún se imprima: comprueba primero la impresora.",
    ],
  ] as const)("words the current attempt %j in English and Spanish", async (over, en, es) => {
    const { el } = await mountF1({ deliveries: statusOf(attempt(over)) });
    expect(line(el)).toBe(en);
    setLocale("es-ES");
    el.requestUpdate();
    await el.updateComplete;
    expect(line(el)).toBe(es);
  });

  it.each([
    ["paper_out", "out of paper", "sin papel"],
    ["paper_jam", "paper jam", "atasco de papel"],
    ["cover_open", "a cover is open", "hay una tapa abierta"],
    ["tray_missing", "a tray is missing", "falta una bandeja"],
    ["ink_or_toner_out", "out of ink or toner", "sin tinta o tóner"],
    ["output_full", "the output tray is full", "la bandeja de salida está llena"],
    ["paused", "paused", "en pausa"],
    ["stopped", "stopped", "detenida"],
  ])(
    "says what the office printer is holding the A4 for (%s), and offers nothing while it does",
    async (hold, en, es) => {
      // B1 offers no action while an A4 is sending, held or not.
      const { el } = await mountF1({
        deliveries: statusOf(attempt({ status: "sending", printerHold: hold })),
      });
      expect(line(el)).toBe(`Waiting at the office printer: ${en}.`);
      for (const name of ["print-invoice", "receipt-instead", "retry-receipt", "print-receipt"])
        expect(button(el, name)).toBeNull();
      setLocale("es-ES");
      el.requestUpdate();
      await el.updateComplete;
      expect(line(el)).toBe(`Esperando en la impresora de oficina: ${es}.`);
    },
  );

  it("says only that the A4 is waiting at the printer for a hold it has no words for", async () => {
    const { el } = await mountF1({
      deliveries: statusOf(attempt({ status: "sending", printerHold: "door_ajar" })),
    });
    expect(line(el)).toBe("Waiting at the office printer.");
    expect(line(el)).not.toContain("{reason}");
  });

  it("leaves a receipt attempt to the original's print status, as before", async () => {
    const { el } = await mountF1({
      deliveries: statusOf(attempt({ medium: "receipt", status: "queued" })),
      originalReceiptPrint: { status: "queued", jobId: "original", canRetry: false },
    });
    expect(button(el, "delivery-status")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=original-delivery]")!.textContent).toContain(
      "The original is waiting to print.",
    );
  });

  it("shows no delivery words before any attempt and while the status is unread", async () => {
    const { el } = await mountF1({ deliveries: statusOf(null) });
    expect(button(el, "delivery-status")).toBeNull();
    el.deliveries = undefined;
    await el.updateComplete;
    expect(button(el, "delivery-status")).toBeNull();
  });

  it("offers the named printer only when the status does, and asks for it", async () => {
    const { el } = await mountF1({ deliveries: statusOf(null) });
    expect(button(el, "print-invoice")).toBeNull();
    el.deliveries = statusOf(null, { print: a4Offer });
    await el.updateComplete;
    expect(button(el, "print-invoice")!.textContent!.trim()).toBe("Print on Office");
    expect(button(el, "print-invoice")!.getAttribute("variant")).toBe("secondary");
    let event: Event | undefined;
    el.addEventListener("print-invoice", (e) => {
      event = e;
    });
    button(el, "print-invoice")!.click();
    expect(event?.bubbles).toBe(true);
    expect(event?.composed).toBe(true);
  });

  it.each(["failed", "unknown"] as const)(
    "offers one button to send a %s A4 original to the office printer again",
    async (status) => {
      const { el } = await mountF1({
        deliveries: statusOf(attempt({ status }), {
          retryOriginal: { medium: "a4" },
          print: a4Offer,
        }),
      });
      const buttons = el.shadowRoot!.querySelectorAll("[data-test=print-invoice]");
      expect(buttons).toHaveLength(1);
      expect(buttons[0]!.textContent!.trim()).toBe("Send to Office again");
      setLocale("es-ES");
      el.requestUpdate();
      await el.updateComplete;
      expect(button(el, "print-invoice")!.textContent!.trim()).toBe("Volver a enviar a Office");
    },
  );

  it("shows an email attempt's status only, even when a retry is offered", async () => {
    const { el } = await mountF1({
      deliveries: statusOf(attempt({ medium: "email", status: "failed" }), {
        retryOriginal: { medium: "email" },
      }),
    });
    expect(line(el)).toBe("Not delivered.");
    for (const name of ["print-invoice", "receipt-instead"]) expect(button(el, name)).toBeNull();
  });

  it("offers the receipt printer instead only while the status does, naming the waiting A4", async () => {
    const { el } = await mountF1({ deliveries: statusOf(attempt({ status: "queued" })) });
    expect(button(el, "receipt-instead")).toBeNull();
    el.deliveries = statusOf(attempt({ status: "queued" }), {
      receiptInstead: { deliveryId: "d1" },
    });
    await el.updateComplete;
    expect(button(el, "receipt-instead")!.textContent!.trim()).toBe(
      "Print on the receipt printer instead",
    );
    let event: CustomEvent | undefined;
    el.addEventListener("receipt-instead", (e) => {
      event = e as CustomEvent;
    });
    button(el, "receipt-instead")!.click();
    expect(event?.detail).toEqual({ deliveryId: "d1" });
    expect(event?.bubbles).toBe(true);
    expect(event?.composed).toBe(true);
    setLocale("es-ES");
    el.requestUpdate();
    await el.updateComplete;
    expect(button(el, "receipt-instead")!.textContent!.trim()).toBe(
      "Imprimir en la impresora de tickets en su lugar",
    );
  });

  it("offers neither action on a device that may not print", async () => {
    const { el } = await mountF1({
      canPrintReceipt: false,
      deliveries: statusOf(attempt({ status: "queued" }), {
        print: a4Offer,
        receiptInstead: { deliveryId: "d1" },
      }),
    });
    expect(line(el)).toBe("Waiting for the office printer.");
    for (const name of ["print-invoice", "receipt-instead"]) expect(button(el, name)).toBeNull();
  });

  it.each(["deliveryBusy", "originalReceiptBusy"] as const)(
    "holds both actions while a request is out (%s), keeping their colour",
    async (busy) => {
      const { el } = await mountF1({
        deliveries: statusOf(attempt({ status: "queued" }), {
          print: a4Offer,
          receiptInstead: { deliveryId: "d1" },
        }),
      });
      for (const name of ["print-invoice", "receipt-instead"])
        expect(button(el, name)!.hasAttribute("disabled")).toBe(false);
      el[busy] = true;
      await el.updateComplete;
      for (const name of ["print-invoice", "receipt-instead"]) {
        expect(button(el, name)!.hasAttribute("disabled")).toBe(true);
        expect(button(el, name)!.getAttribute("variant")).toBe("secondary");
      }
    },
  );

  it("says a status read failed, keeping the last status it read and its actions", async () => {
    const { el } = await mountF1({
      deliveries: statusOf(attempt({ status: "queued" }), { receiptInstead: { deliveryId: "d1" } }),
      deliveriesReadFailed: true,
    });
    expect(button(el, "delivery-read-failed")!.textContent!.trim()).toBe(
      "Could not check the invoice's delivery. Check again.",
    );
    expect(line(el)).toBe("Waiting for the office printer.");
    expect(button(el, "receipt-instead")).not.toBeNull();
    setLocale("es-ES");
    el.requestUpdate();
    await el.updateComplete;
    expect(button(el, "delivery-read-failed")!.textContent!.trim()).toBe(
      "No se ha podido comprobar la entrega de la factura. Vuelve a comprobarla.",
    );
  });

  it.each([
    ["an A4 waits", { status: "queued" }],
    ["an A4 is sending", { status: "sending" }],
    ["an A4 is held", { status: "sending", printerHold: "paper_out" }],
    ["an email is sending", { medium: "email", status: "sending" }],
    ["an A4 has printed", { status: "sent" }],
    ["an email was sent", { medium: "email", status: "sent" }],
  ] as const)("offers no Print original while %s", async (_name, over) => {
    const { el } = await mountF1({ deliveries: statusOf(attempt(over)) });
    expect(button(el, "print-receipt")).toBeNull();
  });

  it.each([
    ["no attempt yet", null],
    ["an A4 failed", attempt({ status: "failed" })],
    ["an A4 may not have printed", attempt({ status: "unknown" })],
    ["an email failed", attempt({ medium: "email", status: "failed" })],
  ] as const)("still offers Print original when %s", async (_name, current) => {
    const { el } = await mountF1({ deliveries: statusOf(current) });
    expect(button(el, "print-receipt")!.textContent!.trim()).toBe("Print original");
  });

  it("says the full invoice was delivered once an A4 or email original completed", async () => {
    const { el } = await mountF1({ deliveries: statusOf(attempt({ status: "sent" })) });
    const section = () => button(el, "original-delivery")!.textContent!;
    expect(section()).toContain("Full invoice delivered");
    expect(section()).not.toContain("Full invoice not delivered");
    setLocale("es-ES");
    el.requestUpdate();
    await el.updateComplete;
    expect(section()).toContain("Factura completa entregada");
    expect(section()).not.toContain("Factura completa no entregada");
  });

  it("keeps the handover heading first when the receipt original was handed over", async () => {
    const { el } = await mountF1({
      deliveries: statusOf(attempt({ medium: "receipt", status: "sent" })),
      originalReceiptPrint: {
        status: "done",
        jobId: "original",
        canRetry: false,
        handover: { personId: "staff", confirmedAt: "2026-08-05T12:40:00.000Z" },
      },
    });
    const section = button(el, "original-delivery")!.textContent!;
    expect(section).toContain("Customer handover confirmed");
    expect(section).not.toContain("Full invoice delivered");
  });

  it.each([
    ["could be retried", { canRetry: true }],
    ["its printer was deleted", { canRetry: false, failureCode: "printer.deleted" }],
  ] as const)(
    "says delivered, and offers no receipt retry, once an email original completed after the receipt original failed and %s",
    async (_name, failed) => {
      const email = attempt({ id: "d2", medium: "email", status: "sent" });
      const { el } = await mountF1({
        deliveries: {
          current: email,
          originalCompleted: true,
          originalPrinterId: null,
          actions: noActions,
          history: [email, attempt({ id: null, medium: "receipt", status: "failed" })],
        },
        originalReceiptPrint: { status: "failed", jobId: "original", ...failed },
      });
      const section = () => button(el, "original-delivery")!.textContent!;
      expect(section()).toContain("Full invoice delivered");
      expect(section()).not.toContain("Full invoice not delivered");
      expect(section()).not.toContain("Printing failed");
      expect(section()).not.toContain("The printer was deleted");
      expect(line(el)).toBe("Sent by email.");
      expect(button(el, "retry-receipt")).toBeNull();
      expect(button(el, "print-receipt")).toBeNull();
    },
  );

  it.each([
    [
      "an email original waits",
      { medium: "email", status: "queued" },
      { receiptInstead: { deliveryId: "d2" } },
    ],
    ["an email original is sending", { medium: "email", status: "sending" }, {}],
    ["an A4 original waits", { status: "queued" }, {}],
    ["an A4 original is sending", { status: "sending" }, {}],
  ] as const)(
    "offers no receipt retry, and leaves out its failure line, while %s after the receipt original failed",
    async (_name, over, actions) => {
      const current = attempt({ id: "d2", ...over });
      const { el } = await mountF1({
        deliveries: {
          current,
          originalCompleted: false,
          originalPrinterId: null,
          actions: { ...noActions, ...actions },
          history: [current, attempt({ id: null, medium: "receipt", status: "failed" })],
        },
        originalReceiptPrint: { status: "failed", jobId: "original", canRetry: true },
      });
      const section = button(el, "original-delivery")!.textContent!;
      expect(section).toContain("Full invoice not delivered");
      expect(section).not.toContain("Printing failed");
      expect(button(el, "retry-receipt")).toBeNull();
      expect(button(el, "print-receipt")).toBeNull();
      expect(button(el, "receipt-instead") !== null).toBe("receiptInstead" in actions);
    },
  );

  it("keeps the receipt original's failure line while that receipt waits for its automatic retry", async () => {
    const current = attempt({ id: null, medium: "receipt", status: "queued" });
    const { el } = await mountF1({
      deliveries: { current, originalCompleted: false, actions: noActions, history: [current] },
      originalReceiptPrint: { status: "failed", jobId: "original", canRetry: false },
    });
    const section = button(el, "original-delivery")!.textContent!;
    expect(section).toContain("Full invoice not delivered");
    expect(section).toContain("Printing failed. Automatic retry is pending.");
    expect(button(el, "retry-receipt")).toBeNull();
  });

  it("offers no receipt retry for an original on a printer this till no longer prints invoices on", async () => {
    const current = attempt({ medium: "receipt", status: "failed" });
    const original = { status: "failed", jobId: "original", canRetry: true } as const;
    const { el } = await mountF1({
      deliveries: { ...statusOf(current), originalPrinterId: "counter" },
      originalReceiptPrint: original,
    });
    expect(button(el, "retry-receipt")).not.toBeNull();
    el.originalReceiptPrint = { ...original, printerWithdrawn: true };
    await el.updateComplete;
    const section = button(el, "original-delivery")!.textContent!;
    expect(section).toContain(
      "Printing failed on a printer this device does not print invoices on.",
    );
    expect(section).not.toContain("Retry the original");
    expect(section).not.toContain("Automatic retry is pending");
    expect(button(el, "retry-receipt")).toBeNull();
  });

  it.each([
    ["an A4", {}],
    ["an email", { medium: "email" }],
  ] as const)(
    "leaves out the receipt's not-sent line while %s attempt is current",
    async (_name, over) => {
      const { el } = await mountF1({ deliveries: statusOf(attempt(over)) });
      expect(button(el, "original-delivery")!.textContent).not.toContain(
        "The original has not been sent to a printer.",
      );
      el.deliveries = statusOf(null);
      await el.updateComplete;
      expect(button(el, "original-delivery")!.textContent).toContain(
        "The original has not been sent to a printer.",
      );
    },
  );

  it("holds the receipt's own buttons while a delivery request is out", async () => {
    const { el } = await mountF1({
      deliveries: statusOf(attempt({ status: "failed" })),
      originalReceiptPrint: { status: "not_queued" },
    });
    expect(button(el, "print-receipt")!.hasAttribute("disabled")).toBe(false);
    expect(button(el, "refresh-receipt")!.hasAttribute("disabled")).toBe(false);
    el.deliveryBusy = true;
    await el.updateComplete;
    expect(button(el, "print-receipt")!.hasAttribute("disabled")).toBe(true);
    expect(button(el, "refresh-receipt")!.hasAttribute("disabled")).toBe(true);
    el.originalReceiptPrint = { status: "failed", jobId: "original", canRetry: true };
    await el.updateComplete;
    expect(button(el, "retry-receipt")!.hasAttribute("disabled")).toBe(true);
    el.originalReceiptPrint = { status: "done", jobId: "original", canRetry: false };
    await el.updateComplete;
    expect(button(el, "confirm-handover")!.hasAttribute("disabled")).toBe(true);
    el.deliveryBusy = false;
    await el.updateComplete;
    expect(button(el, "confirm-handover")!.hasAttribute("disabled")).toBe(false);
  });

  it("labels the A4 action a copy when the status offers a duplicate", async () => {
    const { el } = await mountF1({
      deliveries: statusOf(attempt({ status: "sent" }), {
        print: { ...a4Offer, designation: "duplicate" },
      }),
    });
    expect(button(el, "print-invoice")!.textContent!.trim()).toBe("Print a copy on Office");
    setLocale("es-ES");
    el.requestUpdate();
    await el.updateComplete;
    expect(button(el, "print-invoice")!.textContent!.trim()).toBe("Imprimir una copia en Office");
    el.deliveries = statusOf(null, { print: a4Offer });
    await el.updateComplete;
    expect(button(el, "print-invoice")!.textContent!.trim()).toBe("Imprimir en Office");
  });

  it("names a receipt invoice printer on its print action, a copy included, in English and Spanish", async () => {
    const receiptOffer = {
      printers: [{ id: "r1", name: "Bar printer", kind: "receipt" as const }],
      designation: "original" as const,
    };
    const { el } = await mountF1({ deliveries: statusOf(null, { print: receiptOffer }) });
    expect(button(el, "print-invoice")!.textContent!.trim()).toBe("Print on Bar printer");
    el.deliveries = statusOf(attempt({ medium: "receipt", status: "sent" }), {
      print: { ...receiptOffer, designation: "duplicate" },
    });
    await el.updateComplete;
    expect(button(el, "print-invoice")!.textContent!.trim()).toBe("Print a copy on Bar printer");
    setLocale("es-ES");
    el.requestUpdate();
    await el.updateComplete;
    expect(button(el, "print-invoice")!.textContent!.trim()).toBe(
      "Imprimir una copia en Bar printer",
    );
    el.deliveries = statusOf(null, { print: receiptOffer });
    await el.updateComplete;
    expect(button(el, "print-invoice")!.textContent!.trim()).toBe("Imprimir en Bar printer");
  });

  it("names an A4 invoice printer on its print action", async () => {
    const { el } = await mountF1({ deliveries: statusOf(null, { print: a4Offer }) });
    expect(button(el, "print-invoice")!.textContent!.trim()).toBe("Print on Office");
    expect(button(el, "print-invoice")!.textContent).toContain("Office");
  });

  it("says why a delivery action was refused inside the section, apart from a failed read", async () => {
    const { el } = await mountF1({
      deliveries: statusOf(attempt({}), { receiptInstead: { deliveryId: "d1" } }),
      deliveryRefusal: { code: "invoice_delivery.active" },
      deliveriesReadFailed: true,
    });
    const section = button(el, "original-delivery")!;
    expect(section.querySelector("[data-test=delivery-refused]")!.textContent!.trim()).toBe(
      "This invoice is already waiting for delivery. Check its status before trying again.",
    );
    expect(section.querySelector("[data-test=delivery-read-failed]")).not.toBeNull();
    expect(section.querySelector("[data-test=receipt-instead]")).not.toBeNull();
    el.deliveryRefusal = {};
    await el.updateComplete;
    expect(button(el, "delivery-refused")!.textContent!.trim()).toBe(
      "Could not send the invoice, try again",
    );
    el.deliveryRefusal = undefined;
    await el.updateComplete;
    expect(button(el, "delivery-refused")).toBeNull();
    expect(button(el, "delivery-read-failed")).not.toBeNull();
  });

  it("shows nothing new on a simplified invoice", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: { ...result, invoiceType: "F2" },
      originalReceiptAvailable: true,
      deliveries: statusOf(attempt({ status: "failed" }), {
        retryOriginal: { medium: "a4" },
        print: a4Offer,
        receiptInstead: { deliveryId: "d1" },
      }),
      deliveriesReadFailed: true,
      deliveryRefusal: { code: "invoice_delivery.active" },
    });
    for (const name of [
      "delivery-status",
      "delivery-read-failed",
      "delivery-refused",
      "print-invoice",
      "receipt-instead",
      "original-delivery",
    ])
      expect(button(el, name)).toBeNull();
    expect(button(el, "print-receipt")).not.toBeNull();
  });

  it("keeps a token's space between the section's buttons when they wrap on a phone", async () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    await page.viewport(390, 844);
    setLocale("es-ES");
    try {
      const { el } = await mountF1({
        deliveries: statusOf(attempt({}), { receiptInstead: { deliveryId: "d1" } }),
      });
      const section = button(el, "original-delivery")!;
      const probe = document.createElement("div");
      probe.style.width = "var(--wt-space-2)";
      section.append(probe);
      const space = probe.getBoundingClientRect().width;
      probe.remove();
      const first = button(el, "receipt-instead")!.getBoundingClientRect();
      const second = button(el, "refresh-receipt")!.getBoundingClientRect();
      expect(space).toBeGreaterThan(0);
      expect(second.top).toBeGreaterThanOrEqual(first.bottom);
      expect(second.top - first.bottom).toBeGreaterThanOrEqual(space);
    } finally {
      await page.viewport(width, height);
    }
  });

  describe("email (A231q C3b)", () => {
    const emailOffer = { designation: "original" as const };
    const label = (el: TillTicketView, name: string) => button(el, name)?.textContent?.trim();
    const dialog = (el: TillTicketView) =>
      el.shadowRoot!.querySelector("till-invoice-email-dialog");

    it("offers Send by email when the status offers email, and asks the app to open the form", async () => {
      const { el } = await mountF1({ deliveries: statusOf(null, { email: emailOffer }) });
      expect(label(el, "email-invoice")).toBe("Send by email");
      expect(button(el, "email-invoice")!.getAttribute("variant")).toBe("secondary");
      let opened = 0;
      el.addEventListener("email-invoice", () => opened++);
      button(el, "email-invoice")!.click();
      expect(opened).toBe(1);
      setLocale("es-ES");
      el.requestUpdate();
      await el.updateComplete;
      expect(label(el, "email-invoice")).toBe("Enviar por correo electrónico");
    });

    it("labels the email action a copy once the invoice was delivered", async () => {
      const { el } = await mountF1({
        deliveries: statusOf(attempt({ status: "sent" }), {
          email: { designation: "duplicate" },
        }),
      });
      expect(label(el, "email-invoice")).toBe("Send a copy by email");
      setLocale("es-ES");
      el.requestUpdate();
      await el.updateComplete;
      expect(label(el, "email-invoice")).toBe("Enviar una copia por correo electrónico");
    });

    it("offers to send an ended email again, by its attempt, and the email action to another address", async () => {
      const { el } = await mountF1({
        deliveries: statusOf(attempt({ id: "d7", medium: "email", status: "failed" }), {
          retryOriginal: { medium: "email" },
          email: emailOffer,
        }),
      });
      expect(line(el)).toBe("Not delivered.");
      expect(label(el, "email-again")).toBe("Send the email again");
      expect(button(el, "email-again")!.getAttribute("variant")).toBe("secondary");
      expect(label(el, "email-invoice")).toBe("Send to another address");
      const retried: unknown[] = [];
      el.addEventListener("retry-email", (e) => retried.push((e as CustomEvent).detail));
      button(el, "email-again")!.click();
      expect(retried).toEqual([{ deliveryId: "d7" }]);
      setLocale("es-ES");
      el.requestUpdate();
      await el.updateComplete;
      expect(label(el, "email-again")).toBe("Volver a enviar el correo");
      expect(label(el, "email-invoice")).toBe("Enviar a otra dirección");
    });

    describe("an earlier attempt that was delivered after all", () => {
      const FACT = "A delivery attempt succeeded after all.";
      const CHECK = "Check before trying again: it may already have been delivered.";
      const fact = (el: TillTicketView) => button(el, "delivery-late-success");
      const check = (el: TillTicketView) => button(el, "delivery-late-check");
      const words = (line: HTMLElement | null) => line?.textContent?.trim();
      const delivered = attempt({
        id: "d1",
        medium: "email",
        status: "unknown",
        lateSuccess: true,
      });
      const failedAgain = attempt({ id: "d2", medium: "email", status: "failed" });
      const behind = (
        current: InvoiceDeliveryAttempt,
        earlier: InvoiceDeliveryAttempt = delivered,
      ): InvoiceDeliveryStatus => ({ ...statusOf(current), history: [current, earlier] });

      it("says so beneath a newer failure, which keeps its send-again action", async () => {
        const { el } = await mountF1({
          deliveries: {
            ...behind(failedAgain),
            actions: { ...noActions, retryOriginal: { medium: "email" }, email: emailOffer },
          },
        });
        expect(line(el)).toBe("May not have been delivered.");
        expect(words(fact(el))).toBe(FACT);
        expect(fact(el)!.getAttribute("role")).toBe("status");
        expect(fact(el)!.previousElementSibling).toBe(button(el, "delivery-status"));
        expect(words(check(el))).toBe(CHECK);
        expect(check(el)!.getAttribute("role")).toBe("status");
        expect(check(el)!.previousElementSibling).toBe(fact(el));
        expect(label(el, "email-again")).toBe("Send the email again");
        expect(label(el, "email-invoice")).toBe("Send to another address");
      });

      describe("while the original is not recorded as delivered", () => {
        const heading = (el: TillTicketView) =>
          button(el, "original-delivery")!.querySelector("strong")!.textContent!.trim();

        it.each(["failed", "unknown"] as const)(
          "says it may not have arrived when the newest attempt is %s",
          async (status) => {
            const { el } = await mountF1({
              deliveries: behind(attempt({ id: "d2", medium: "email", status })),
            });
            expect(heading(el)).toBe("Full invoice may not have been delivered");
            expect(line(el)).toBe("May not have been delivered.");
            expect(button(el, "original-delivery")!.textContent).not.toContain("Not delivered.");
          },
        );

        it("says it in Spanish", async () => {
          setLocale("es-ES");
          const { el } = await mountF1({ deliveries: behind(failedAgain) });
          expect(heading(el)).toBe("Puede que la factura completa no se haya entregado");
          expect(line(el)).toBe("Puede que no se haya entregado.");
        });

        it.each([
          ["queued", "Sending the invoice."],
          ["sending", "Sending the invoice."],
        ] as const)(
          "heads a newer %s attempt the same way, which keeps its own line",
          async (status, own) => {
            const { el } = await mountF1({
              deliveries: behind(attempt({ id: "d2", medium: "email", status })),
            });
            expect(heading(el)).toBe("Full invoice may not have been delivered");
            expect(line(el)).toBe(own);
          },
        );

        it("does not ask for a receipt to be retried without checking", async () => {
          const { el } = await mountF1({
            deliveries: behind(attempt({ id: "d2", medium: "receipt", status: "failed" })),
            originalReceiptPrint: { status: "failed", jobId: "original", canRetry: true },
          });
          const section = button(el, "original-delivery")!.textContent!;
          expect(section).toContain("Printing failed. Check before printing again.");
          expect(section).not.toContain("Retry the original.");
          setLocale("es-ES");
          el.requestUpdate();
          await el.updateComplete;
          expect(button(el, "original-delivery")!.textContent).toContain(
            "La impresión falló. Compruébalo antes de volver a imprimir.",
          );
        });

        it("keeps today's words when no attempt was delivered late", async () => {
          const { el } = await mountF1({
            deliveries: behind(failedAgain, { ...delivered, lateSuccess: false }),
          });
          expect(heading(el)).toBe("Full invoice not delivered");
          expect(line(el)).toBe("Not delivered.");
        });

        it("keeps today's receipt failure line when no attempt was delivered late", async () => {
          const { el } = await mountF1({
            deliveries: behind(attempt({ id: "d2", medium: "receipt", status: "failed" }), {
              ...delivered,
              lateSuccess: false,
            }),
            originalReceiptPrint: { status: "failed", jobId: "original", canRetry: true },
          });
          expect(button(el, "original-delivery")!.textContent).toContain(
            "Printing failed. Retry the original.",
          );
        });

        it("warns of nothing once the original was delivered", async () => {
          const copy = attempt({
            id: "d3",
            medium: "email",
            designation: "duplicate",
            status: "failed",
          });
          const original = attempt({ id: "d2", medium: "email", status: "sent" });
          const { el } = await mountF1({
            deliveries: {
              ...statusOf(copy),
              originalCompleted: true,
              history: [copy, original, delivered],
            },
          });
          expect(heading(el)).toBe("Full invoice delivered");
          expect(line(el)).toBe("Not delivered.");
        });
      });

      it.each([
        ["failed", true],
        ["unknown", true],
        ["queued", false],
        ["sending", false],
        ["sent", false],
      ] as const)("behind a newer %s attempt, asks for a check: %s", async (status, asks) => {
        const current = attempt({ id: "d2", medium: "email", status });
        const { el } = await mountF1({ deliveries: behind(current) });
        expect(words(fact(el))).toBe(FACT);
        expect(words(check(el))).toBe(asks ? CHECK : undefined);
      });

      describe("behind a newer queued attempt, with a receipt offered instead", () => {
        const offering = (medium: InvoiceDeliveryAttempt["medium"]): InvoiceDeliveryStatus => ({
          ...behind(attempt({ id: "d2", medium, status: "queued" })),
          actions: { ...noActions, receiptInstead: { deliveryId: "d2" } },
        });

        it.each(["email", "a4"] as const)("asks for a check (%s)", async (medium) => {
          const { el } = await mountF1({ deliveries: offering(medium) });
          expect(button(el, "receipt-instead")).not.toBeNull();
          expect(words(fact(el))).toBe(FACT);
          expect(words(check(el))).toBe(CHECK);
        });

        it("asks for none on a till that cannot print receipts", async () => {
          const { el } = await mountF1({ deliveries: offering("a4"), canPrintReceipt: false });
          expect(button(el, "receipt-instead")).toBeNull();
          expect(words(fact(el))).toBe(FACT);
          expect(check(el)).toBeNull();
        });
      });

      it("asks for no check when a copy failed after the original was delivered", async () => {
        const copy = attempt({
          id: "d3",
          medium: "email",
          designation: "duplicate",
          status: "failed",
        });
        const original = attempt({ id: "d2", medium: "email", status: "sent" });
        const { el } = await mountF1({
          deliveries: {
            ...statusOf(copy),
            originalCompleted: true,
            history: [copy, original, delivered],
          },
        });
        expect(words(fact(el))).toBe(FACT);
        expect(check(el)).toBeNull();
      });

      it("gives the same two lines for a late A4 attempt, whose page is at the printer", async () => {
        const page = attempt({ id: "d1", medium: "a4", status: "unknown", lateSuccess: true });
        const { el } = await mountF1({
          deliveries: behind(attempt({ id: "d2", medium: "a4", status: "failed" }), page),
        });
        expect(words(fact(el))).toBe(FACT);
        expect(words(check(el))).toBe(CHECK);
      });

      it("says both lines in Spanish", async () => {
        setLocale("es-ES");
        const { el } = await mountF1({ deliveries: behind(failedAgain) });
        expect(words(fact(el))).toBe("Un intento de entrega se completó al final.");
        expect(words(check(el))).toBe(
          "Compruébalo antes de intentarlo de nuevo: puede que ya se haya entregado.",
        );
      });

      it("says nothing when no attempt was delivered late", async () => {
        const { el } = await mountF1({
          deliveries: behind(failedAgain, { ...delivered, lateSuccess: false }),
        });
        expect(line(el)).toBe("Not delivered.");
        expect(fact(el)).toBeNull();
        expect(check(el)).toBeNull();
      });

      it("says both for a late receipt alone, which has no delivery words of its own", async () => {
        const receipt = attempt({ medium: "receipt", status: "unknown", lateSuccess: true });
        const { el } = await mountF1({
          deliveries: statusOf(receipt),
          originalReceiptPrint: {
            status: "failed",
            jobId: "original",
            canRetry: false,
            failureCode: "printer.deleted",
          },
        });
        expect(button(el, "delivery-status")).toBeNull();
        expect(words(fact(el))).toBe(FACT);
        expect(words(check(el))).toBe(CHECK);
        expect(check(el)!.previousElementSibling).toBe(fact(el));
      });

      // The server counts a printed receipt as a completed original, so a confirmed handover beside
      // `originalCompleted: false` is a delivery status read before the receipt finished.
      it("asks for no check under a confirmed customer handover", async () => {
        const printed = { status: "done", jobId: "original", canRetry: false } as const;
        const { el } = await mountF1({
          deliveries: behind(failedAgain),
          originalReceiptPrint: printed,
        });
        expect(words(check(el))).toBe(CHECK);
        el.originalReceiptPrint = {
          ...printed,
          handover: { personId: "staff", confirmedAt: "2026-08-05T12:40:00.000Z" },
        };
        await el.updateComplete;
        expect(button(el, "original-delivery")!.textContent).toContain(
          "Customer handover confirmed",
        );
        expect(words(fact(el))).toBe(FACT);
        expect(check(el)).toBeNull();
      });

      describe("under a confirmed customer handover", () => {
        const handedOver = {
          status: "done",
          jobId: "original",
          canRetry: false,
          handover: { personId: "staff", confirmedAt: "2026-08-05T12:40:00.000Z" },
        } as const;

        it.each(["failed", "unknown"] as const)(
          "drops the doubt about a %s attempt, keeping the fact",
          async (status) => {
            const { el } = await mountF1({
              deliveries: behind(attempt({ id: "d2", medium: "email", status })),
              originalReceiptPrint: handedOver,
            });
            const section = button(el, "original-delivery")!.textContent!;
            expect(section).toContain("Customer handover confirmed");
            expect(button(el, "delivery-status")).toBeNull();
            expect(section).not.toContain("Not delivered.");
            expect(words(fact(el))).toBe(FACT);
          },
        );

        it("keeps saying a held page may still print", async () => {
          const held = attempt({
            id: "d2",
            medium: "a4",
            status: "unknown",
            printerHold: "paper_jam",
          });
          const { el } = await mountF1({
            deliveries: behind(held),
            originalReceiptPrint: handedOver,
          });
          expect(line(el)).toBe("May still print: check the printer first.");
        });

        it("keeps a failure's words when nothing was delivered late", async () => {
          const { el } = await mountF1({
            deliveries: behind(failedAgain, { ...delivered, lateSuccess: false }),
            originalReceiptPrint: handedOver,
          });
          expect(line(el)).toBe("Not delivered.");
        });
      });
    });

    it("offers no email again when the retry offered is on paper", async () => {
      const { el } = await mountF1({
        deliveries: statusOf(attempt({ status: "failed" }), {
          retryOriginal: { medium: "a4" },
          print: a4Offer,
        }),
      });
      for (const name of ["email-again", "email-invoice"]) expect(button(el, name)).toBeNull();
    });

    it("offers paper instead of a waiting email, as for a waiting A4", async () => {
      const { el } = await mountF1({
        deliveries: statusOf(attempt({ medium: "email", status: "queued" }), {
          receiptInstead: { deliveryId: "d1" },
        }),
      });
      expect(line(el)).toBe("Sending the invoice.");
      expect(button(el, "receipt-instead")).not.toBeNull();
      expect(button(el, "email-invoice")).toBeNull();
    });

    it("draws no email action on a device without the print-receipt action", async () => {
      const { el } = await mountF1({
        canPrintReceipt: false,
        emailOpen: true,
        deliveries: statusOf(attempt({ medium: "email", status: "failed" }), {
          retryOriginal: { medium: "email" },
          email: emailOffer,
        }),
      });
      for (const name of ["email-again", "email-invoice"]) expect(button(el, name)).toBeNull();
      expect(dialog(el)).toBeNull();
    });

    it.each(["deliveryBusy", "originalReceiptBusy"] as const)(
      "holds both email actions while a request is out (%s), keeping their colour",
      async (busy) => {
        const { el } = await mountF1({
          deliveries: statusOf(attempt({ medium: "email", status: "unknown" }), {
            retryOriginal: { medium: "email" },
            email: emailOffer,
          }),
        });
        for (const name of ["email-again", "email-invoice"])
          expect(button(el, name)!.hasAttribute("disabled")).toBe(false);
        el[busy] = true;
        await el.updateComplete;
        for (const name of ["email-again", "email-invoice"]) {
          expect(button(el, name)!.hasAttribute("disabled")).toBe(true);
          expect(button(el, name)!.getAttribute("variant")).toBe("secondary");
        }
      },
    );

    it("shows the address form while the app has it open, headed as the offer reads", async () => {
      const { el } = await mountF1({ deliveries: statusOf(null, { email: emailOffer }) });
      expect(dialog(el)).toBeNull();
      el.emailOpen = true;
      await el.updateComplete;
      expect(dialog(el)!.copy).toBe(false);
      expect(dialog(el)!.closest("[role=status]")).toBeNull();
      el.deliveries = statusOf(attempt({ status: "sent" }), {
        email: { designation: "duplicate" },
      });
      el.deliveryBusy = true;
      el.emailRefusal = { code: "invoice_delivery.active" };
      await el.updateComplete;
      expect(dialog(el)!.copy).toBe(true);
      expect(dialog(el)!.busy).toBe(true);
      expect(dialog(el)!.refusal).toEqual({ code: "invoice_delivery.active" });
      el.emailOpen = false;
      await el.updateComplete;
      expect(dialog(el)).toBeNull();
    });

    it("never shows the address an email went to", async () => {
      const { el } = await mountF1({
        deliveries: statusOf(attempt({ medium: "email", status: "sent" }), {
          email: { designation: "duplicate" },
        }),
      });
      expect(line(el)).toBe("Sent by email.");
      expect(text(el)).not.toContain("@");
    });
  });
});

describe("A790 recorded document then printer", () => {
  const bar = equipmentItem("bar", "Bar", { kind: "receipt" });
  const office = equipmentItem("office", "Office", { kind: "a4" });
  const mountChoice = (props: Record<string, unknown> = {}, invoiceType: "F1" | "F2" = "F1") =>
    mountWidget<TillTicketView>("till-ticket-view", {
      result: { ...result, invoiceType },
      invoicePrintersEnabled: true,
      originalReceiptPrint: { status: "not_queued" },
      originalReceiptAvailable: true,
      receiptEquipment: { ...roleOf("receipt", bar, [bar]), default: bar },
      invoiceEquipment: roleOf("invoice", office, [office]),
      ...props,
    });
  const part = (el: TillTicketView, key: string) =>
    el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${key}]`);
  const press = async (el: TillTicketView, key: string) => {
    const control = part(el, key);
    expect(control, key).not.toBeNull();
    await userEvent.click(control!);
    await el.updateComplete;
  };

  it("opens F1 document choices without printing, then Receipt's named destination and Back", async () => {
    const { el } = await mountChoice();
    const actions: string[] = [];
    for (const type of ["print-receipt", "reprint", "print-invoice"])
      el.addEventListener(type, () => actions.push(type));
    expect(part(el, "print-receipt")).toBeNull();
    expect(part(el, "print-invoice")).toBeNull();
    await press(el, "document-print-toggle");
    expect(part(el, "document-receipt")).not.toBeNull();
    expect(part(el, "document-invoice")).not.toBeNull();
    await press(el, "document-receipt");
    expect(el.shadowRoot!.querySelector("wt-combobox")!.name).toBe("receiptPrinterId");
    expect(part(el, "print-receipt")!.textContent!.trim()).toBe("Print on Bar");
    await press(el, "document-back");
    expect(part(el, "print-receipt")).toBeNull();
    expect(actions).toEqual([]);
    await press(el, "document-receipt");
    await press(el, "print-receipt");
    expect(actions).toEqual(["print-receipt"]);
  });

  it.each([
    ["not_queued", "print-receipt"],
    ["done", "reprint"],
    ["queued", "reprint"],
    ["printing", "reprint"],
  ] as const)("a later F2 receipt follows its server history: %s", async (status, action) => {
    const { el } = await mountChoice(
      {
        historical: true,
        historicalDelivery: true,
        originalReceiptAvailable: false,
        originalReceiptPrint:
          status === "not_queued" ? { status } : { status, jobId: "original", canRetry: false },
      },
      "F2",
    );
    await press(el, "document-print-toggle");
    expect(part(el, action)).not.toBeNull();
    expect(part(el, action === "reprint" ? "print-receipt" : "reprint")).toBeNull();
  });

  it("lets a later F2 receipt retry a failed print-status read", async () => {
    const { el } = await mountChoice(
      {
        historical: true,
        historicalDelivery: true,
        originalReceiptPrint: undefined,
        originalReceiptReadFailed: true,
      },
      "F2",
    );
    expect(part(el, "refresh-receipt")).not.toBeNull();
    const checked = vi.fn();
    el.addEventListener("refresh-receipt", checked);
    part(el, "refresh-receipt")!.click();
    expect(checked).toHaveBeenCalledOnce();
  });

  it("keeps copies for a past F2 receipt with no order status", async () => {
    const { el } = await mountChoice({
      historical: true,
      historicalDelivery: false,
      result: { ...result, invoiceType: "F2" },
      originalReceiptPrint: undefined,
      originalReceiptAvailable: false,
    });
    await press(el, "document-print-toggle");
    expect(part(el, "reprint")).not.toBeNull();
    expect(part(el, "print-receipt")).toBeNull();
  });

  it("opens F2 directly at its Receipt printer and explicitly confirms a copy", async () => {
    const { el } = await mountChoice(
      {
        originalReceiptAvailable: false,
        originalReceiptPrint: { status: "done", jobId: "original", canRetry: false },
      },
      "F2",
    );
    const copies: Event[] = [];
    el.addEventListener("reprint", (event) => copies.push(event));
    await press(el, "document-print-toggle");
    expect(part(el, "document-invoice")).toBeNull();
    expect(part(el, "reprint")!.textContent!.trim()).toBe("Print a copy on Bar");
    await press(el, "reprint");
    expect(copies).toHaveLength(1);
  });

  it.each([
    ["not queued", { status: "not_queued" }, null, "print-receipt"],
    ["done receipt", { status: "done", jobId: "j", canRetry: false }, null, "reprint"],
    ["queued", { status: "queued", jobId: "j", canRetry: false }, null, null],
    ["failed", { status: "failed", jobId: "j", canRetry: true }, null, null],
    ["unresolved", undefined, null, null],
    ["completed email", { status: "not_queued" }, { originalCompleted: true }, "reprint"],
    ["active invoice", { status: "not_queued" }, { current: { status: "sending" } }, null],
  ])(
    "Receipt availability follows %s",
    async (_name, originalReceiptPrint, deliveries, expected) => {
      const { el } = await mountChoice({
        originalReceiptPrint,
        deliveries:
          deliveries === null
            ? null
            : {
                current: null,
                originalCompleted: false,
                originalPrinterId: null,
                history: [],
                actions: { print: null, retryOriginal: null, receiptInstead: null, email: null },
                ...deliveries,
              },
      });
      await press(el, "document-print-toggle");
      await press(el, "document-receipt");
      expect(part(el, "print-receipt") !== null).toBe(expected === "print-receipt");
      expect(part(el, "reprint") !== null).toBe(expected === "reprint");
      if (_name === "failed") expect(part(el, "retry-receipt")).not.toBeNull();
    },
  );

  it("keeps a missing explicit selection unresolved and offers Refresh instead of choosing the only printer", async () => {
    const { el } = await mountChoice(
      {
        receiptEquipment: {
          ...roleOf("receipt", null, [bar]),
          selection: "item",
          chosenId: "removed",
          default: bar,
        },
      },
      "F2",
    );
    await press(el, "document-print-toggle");
    expect(part(el, "print-receipt")!.hasAttribute("disabled")).toBe(true);
    expect(el.shadowRoot!.querySelector("wt-combobox")!.value).toBe("removed");
    expect(part(el, "invoice-printer-read-retry")).not.toBeNull();
    el.receiptEquipment = roleOf("receipt", null, []);
    el.invoicePrinterReadFailed = true;
    await el.updateComplete;
    expect(part(el, "print-receipt")!.hasAttribute("disabled")).toBe(true);
    expect(part(el, "document-back")).not.toBeNull();
  });

  const noPrinter = (el: TillTicketView) => part(el, "receipt-no-printer")?.textContent?.trim();
  const done: OriginalReceiptPrint = { status: "done", jobId: "original", canRetry: false };

  it.each([
    ["an F2 copy", "F2", done, "reprint", codeMessage("receipt.no_printer")],
    ["an F1 copy", "F1", done, "reprint", codeMessage("receipt.no_printer")],
    [
      "an F1 original",
      "F1",
      { status: "not_queued" },
      "print-receipt",
      codeMessage("invoice_delivery.receipt_unavailable"),
    ],
    [
      "an F2 original",
      "F2",
      { status: "not_queued" },
      "print-receipt",
      uiText("document.no_receipt_printer"),
    ],
  ] as const)(
    "says what to do beside %s's disabled button once the read finds no receipt printer",
    async (_name, invoiceType, originalReceiptPrint, action, words) => {
      const { el } = await mountChoice(
        {
          originalReceiptPrint,
          originalReceiptAvailable: originalReceiptPrint.status === "not_queued",
          receiptEquipment: roleOf("receipt", null, [bar]),
        },
        invoiceType,
      );
      await press(el, "document-print-toggle");
      if (invoiceType === "F1") await press(el, "document-receipt");
      expect(part(el, action)!.hasAttribute("disabled")).toBe(true);
      expect(noPrinter(el)).toBe(words);
    },
  );

  it("says nothing about a missing printer while the read is out, after it fails, or with a printer", async () => {
    const { el } = await mountChoice(
      { originalReceiptAvailable: false, originalReceiptPrint: done, receiptEquipment: undefined },
      "F2",
    );
    await press(el, "document-print-toggle");
    expect(part(el, "reprint")!.hasAttribute("disabled")).toBe(true);
    expect(noPrinter(el)).toBeUndefined();
    el.receiptEquipment = roleOf("receipt", null, [bar]);
    el.invoicePrinterLoading = true;
    await el.updateComplete;
    expect(noPrinter(el)).toBeUndefined();
    el.invoicePrinterLoading = false;
    el.invoicePrinterReadFailed = true;
    await el.updateComplete;
    expect(noPrinter(el)).toBeUndefined();
    el.invoicePrinterReadFailed = false;
    await el.updateComplete;
    expect(noPrinter(el)).toBe(codeMessage("receipt.no_printer"));
    el.receiptEquipment = roleOf("receipt", bar, [bar]);
    await el.updateComplete;
    expect(part(el, "reprint")!.hasAttribute("disabled")).toBe(false);
    expect(noPrinter(el)).toBeUndefined();
  });

  const printerOff = (el: TillTicketView) => part(el, "receipt-printer-off")?.textContent?.trim();

  it("says a switched-off receipt printer is switched off, not missing, while another can be chosen", async () => {
    const off = equipmentItem("bar", "Bar", { kind: "receipt", available: false });
    const patio = equipmentItem("patio", "Patio", { kind: "receipt" });
    const { el } = await mountChoice(
      {
        originalReceiptAvailable: false,
        originalReceiptPrint: done,
        receiptEquipment: roleOf("receipt", off, [patio]),
      },
      "F2",
    );
    await press(el, "document-print-toggle");
    expect(part(el, "reprint")!.hasAttribute("disabled")).toBe(true);
    expect(noPrinter(el)).toBeUndefined();
    expect(printerOff(el)).toBe(
      uiText("pay_equipment.printer_switched_off").replace("{item}", "Bar"),
    );
    el.invoicePrinterLoading = true;
    await el.updateComplete;
    expect(printerOff(el)).toBeUndefined();
  });

  it("adds nothing to the empty list's own line when the profile lists no receipt printer", async () => {
    const { el } = await mountChoice(
      {
        originalReceiptAvailable: false,
        originalReceiptPrint: done,
        receiptEquipment: roleOf("receipt", null, []),
      },
      "F2",
    );
    await press(el, "document-print-toggle");
    expect(part(el, "reprint")!.hasAttribute("disabled")).toBe(true);
    expect(text(el)).toContain(uiText("document.no_printers"));
    expect(noPrinter(el)).toBeUndefined();
    expect(printerOff(el)).toBeUndefined();
    expect(part(el, "receipt-no-printers")).toBeNull();
    await press(el, "invoice-printer-toggle");
    expect(part(el, "receipt-no-printers")!.textContent!.trim()).toBe(
      uiText("document.no_printers_note"),
    );
    expect(text(el)).not.toContain(uiText("document.no_printers"));
  });

  it("says the only receipt printer is switched off, with nothing else to choose", async () => {
    const off = equipmentItem("bar", "Bar", { kind: "receipt", available: false });
    const { el } = await mountChoice(
      {
        originalReceiptAvailable: false,
        originalReceiptPrint: done,
        receiptEquipment: roleOf("receipt", off, []),
      },
      "F2",
    );
    await press(el, "document-print-toggle");
    expect(part(el, "reprint")!.hasAttribute("disabled")).toBe(true);
    expect(noPrinter(el)).toBeUndefined();
    expect(part(el, "receipt-no-printers")).toBeNull();
    expect(printerOff(el)).toBe(uiText("document.printer_off_no_other").replace("{item}", "Bar"));
  });

  it("says nothing about the printer while a printer choice is being saved", async () => {
    const { el } = await mountChoice(
      {
        originalReceiptAvailable: false,
        originalReceiptPrint: done,
        receiptEquipment: roleOf("receipt", null, [bar]),
      },
      "F2",
    );
    await press(el, "document-print-toggle");
    expect(noPrinter(el)).toBe(codeMessage("receipt.no_printer"));
    el.invoicePrinterBlocked = true;
    await el.updateComplete;
    expect(noPrinter(el)).toBeUndefined();
  });

  it("asks before taking another device's Receipt printer and sends takeOver only after Take", async () => {
    const carried = equipmentItem("belt", "Belt", {
      kind: "receipt",
      portable: true,
      heldBy: { deviceId: "other", deviceName: "Patio", personName: null },
    });
    const { el } = await mountChoice({ receiptEquipment: roleOf("receipt", bar, [bar, carried]) });
    const changes: unknown[] = [];
    el.addEventListener("equipment-change", (event) => changes.push((event as CustomEvent).detail));
    await press(el, "document-print-toggle");
    await press(el, "document-receipt");
    const field = el.shadowRoot!.querySelector("wt-combobox")!;
    const pick = async () => {
      await userEvent.click(field.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
      await field.updateComplete;
      const option = [...field.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (row) => row.textContent!.includes("Belt"),
      )!;
      await userEvent.click(option);
    };
    await pick();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-equipment-confirm]")!.textContent).toContain(
      "Patio",
    );
    expect(changes).toEqual([]);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-equipment-cancel]")!);
    await el.updateComplete;
    expect(changes).toEqual([]);
    expect(field.value).toBe("bar");
    expect(part(el, "print-receipt")!.textContent).toContain("Bar");
    await pick();
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-equipment-take]")!);
    expect(changes).toEqual([
      { role: "receipt", selection: { id: "belt" }, via: "list", takeOver: true },
    ]);
  });
});

describe("a corrective invoice", () => {
  const replacementOfFull = { invoiceType: "R4" as const, invoiceNumber: "R/4" };

  it("offers no full-invoice (A4) choice on a replacement of a full invoice", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: { ...result, ...replacementOfFull },
      originalReceiptPrint: { status: "not_queued" },
      invoicePrintersEnabled: true,
    });
    const toggle = el.shadowRoot!.querySelector<HTMLElement>("[data-test=document-print-toggle]")!;
    await userEvent.click(toggle);
    expect(el.shadowRoot!.querySelector("[data-test=document-invoice]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=email-invoice]")).toBeNull();
    // The toggle goes straight to the receipt: no document menu is offered.
    expect(el.shadowRoot!.querySelector("[data-test=document-receipt]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=print-receipt]")).not.toBeNull();
    // The menu is never reached for an R4 through the screen; opened directly, it still has no A4.
    (el as unknown as { printDocument: null }).printDocument = null;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=document-receipt]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=document-invoice]")).toBeNull();
  });

  it("treats a replacement of a full invoice's receipt as a receipt's original, not a full invoice's", async () => {
    // With no print status read yet, a full invoice offers no receipt print; a receipt offers its
    // original while the till still holds it.
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: { ...result, ...replacementOfFull },
      originalReceiptAvailable: true,
      invoicePrintersEnabled: true,
    });
    await userEvent.click(
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=document-print-toggle]")!,
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=print-receipt]")).not.toBeNull();
  });
});
