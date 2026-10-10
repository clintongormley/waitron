import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillTicketView } from "./till-ticket-view.js";
import type { TicketIssuer } from "./till-ticket-view.js";
import type { OriginalReceiptPrint, TillSaleResult } from "../api/client.js";
import type { ReceiptConfig } from "../layout.js";

// es-ES currency formatting separates the amount and € with a non-breaking space (U+00A0, or a
// narrow no-break U+202F on some ICU builds); normalise both to a plain space before asserting.
const norm = (s: string): string => s.replace(/[\u00A0\u202F]/g, " ");

// A mixed-rate ticket with a weighed line: café 2 → 3,00 (21 %), jamón 0,320 kg → 6,40 (10 %).
// Total 9,40; €10 cash tendered → 0,60 change.
const result: TillSaleResult = {
  receiptTrim: {},
  venueAddress: [],
  venueReceiptSettings: {},
  orderLabel: "Mesa 6",
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

const issuer: TicketIssuer = { venueName: "Deli Delicioso SL", nif: "B12345678" };

const mount = (over: Partial<TillSaleResult> = {}, receipt?: ReceiptConfig) =>
  mountWidget<TillTicketView>("till-ticket-view", {
    result: { ...result, ...over, ...(receipt ? { receiptTrim: receipt } : {}) },
    issuer,
    // Pinned so the "operator UI is English, ticket stays Spanish" test is unambiguous.
    invoiceLocale: "es-ES",
  });

const text = (el: TillTicketView): string => norm(el.shadowRoot!.textContent ?? "");

// setLocale mutates module-level state; put the shipped default (en-GB) back for the other suites.
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("till-ticket-view", () => {
  it("retains F2 date rendering even when the payload carries an issue offset", async () => {
    const baseline = await mount({ invoiceType: "F2" });
    const want = baseline.el.shadowRoot!.querySelectorAll(".meta-row")[1]!.textContent;
    const { el } = await mount({ invoiceType: "F2", issuedOffsetMinutes: 60 });
    expect(el.shadowRoot!.querySelectorAll(".meta-row")[1]!.textContent).toBe(want);
  });
  it.each([
    [60, "1 mar 2026, 0:05"],
    [0, "28 feb 2026, 23:05"],
    [-480, "28 feb 2026, 15:05"],
  ])("shows saved F1 issue offset %s independently of the browser", async (offset, want) => {
    const { el } = await mount({
      invoiceType: "F1",
      issuedAt: "2026-02-28T23:05:00.000Z",
      issuedOffsetMinutes: offset,
    });
    expect(el.shadowRoot!.querySelectorAll(".meta-row")[1]!.textContent).toContain(want);
  });

  it.each([
    ["es-ES", "Fecha de operación", "28 feb 2026"],
    ["ca-ES", "Data de l'operació", "28 de febr. 2026"],
    ["gl-ES", "Data da operación", "28 feb 2026"],
    ["eu-ES", "Eragiketaren data", "28 feb 2026"],
    ["en-GB", "Fecha de operación", "28 Feb 2026"],
  ])("shows the saved operation day in the filed language %s", async (locale, label, date) => {
    setLocale(locale === "es-ES" ? "en-GB" : "es-ES");
    const { el } = await mount({
      invoiceType: "F1",
      locale,
      issuedAt: "2026-03-01T00:05:00.000+01:00",
      operationDate: "2026-02-28",
    });
    const row = el.shadowRoot!.querySelector("[data-test=operation-date]");
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain(label);
    expect(row!.textContent).toContain(date);
    expect(el.shadowRoot!.querySelector(".invoice-number")!.textContent).toBe("A/1");
  });

  it.each([undefined, "F1", "F2"] as const)(
    "omits the operation-date row for %s without a distinct saved day",
    async (invoiceType) => {
      const { el } = await mount({ invoiceType });
      expect(el.shadowRoot!.querySelector("[data-test=operation-date]")).toBeNull();
      expect(text(el)).toContain("Fecha");
    },
  );

  it("does not show a saved operation day on an F2", async () => {
    const { el } = await mount({ invoiceType: "F2", operationDate: "2026-02-28" });
    expect(el.shadowRoot!.querySelector("[data-test=operation-date]")).toBeNull();
    expect(text(el)).not.toContain("28 feb 2026");
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
      issuer,
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
      "La impresora se eliminó, por lo que no se volverá a intentar este trabajo.",
      "reintento automático",
    ],
  ])(
    "says a failed original's printer was deleted, with no retry, in %s",
    async (locale, message, autoRetry) => {
      setLocale(locale);
      const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
        issuer,
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
        issuer,
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
        issuer,
        result: { ...result, invoiceType: "F1" },
        originalReceiptPrint: print,
      });
      expect(el.shadowRoot!.querySelector("[data-test=confirm-handover]")).toBeNull();
    },
  );

  it("keeps F1 status visible without device printing capability and exposes only the status check", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      issuer,
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
      issuer,
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
      issuer,
      result: { ...result, invoiceType: "F2" },
      originalReceiptPrint: { status: "failed", jobId: "original", canRetry: true },
      originalReceiptAvailable: true,
    });
    expect(el.shadowRoot!.querySelector("[data-test=original-delivery]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=retry-receipt]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=print-receipt]")).not.toBeNull();
  });

  it.each([
    ["es-ES", "IVA incluido"],
    ["ca-ES", "IVA inclòs"],
    ["gl-ES", "IVE incluído"],
    ["eu-ES", "BEZa barne"],
    ["en-GB", "IVA incluido"],
  ])("identifies VAT-inclusive F1 reductions in %s", async (locale, included) => {
    const invoice = {
      ...result,
      total: "10.30",
      vatBreakdown: [{ rate: "21.00", base: "8.51", tax: "1.79" }],
      lines: [
        {
          descriptions: { "es-ES": "Plato", en: "Dish" },
          quantity: "1",
          gross: "10.30",
          listGross: "12.00",
          net: {
            unitPrice: "8.51",
            priceQuantity: "1.000",
            base: "8.51",
            rate: "21.00",
            tax: "1.79",
          },
          adjustments: [{ kind: "discount" as const, percentBp: 1000, amount: "1.20" }],
        },
        {
          descriptions: { "es-ES": "Extra", en: "Extra" },
          quantity: "1",
          gross: "0.00",
          listGross: "1.10",
          parentLineNo: 1,
          net: {
            unitPrice: "0.00",
            priceQuantity: "1.000",
            base: "0.00",
            rate: "10.00",
            tax: "0.00",
          },
          adjustments: [{ kind: "comp" as const, amount: "1.10" }],
        },
      ],
      billAdjustments: [{ kind: "discount" as const, amount: "0.50" }],
    };
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      issuer,
      invoiceLocale: locale,
      result: { ...invoice, invoiceType: "F1" },
    });
    const reductions = [...el.shadowRoot!.querySelectorAll(".adjustment, .bill-adjustment")];
    expect(reductions).toHaveLength(3);
    for (const row of reductions) expect(row.textContent).toContain(`(${included})`);
    const expected =
      locale === "en-GB" ? ["-€1.20", "-€1.10", "-€0.50"] : ["-1,20 €", "-1,10 €", "-0,50 €"];
    expect(reductions.map((row) => norm(row.querySelector(".line-gross")!.textContent!))).toEqual(
      expected,
    );
    el.result = { ...invoice, invoiceType: "F2" };
    await el.updateComplete;
    expect(text(el)).not.toContain(`(${included})`);
  });

  it("shows saved VAT in each F1 dish and extra row", async () => {
    const { el } = await mount({
      invoiceType: "F1",
      lines: [
        {
          ...result.lines[0]!,
          net: {
            unitPrice: "1.24",
            priceQuantity: "1.000",
            base: "2.48",
            rate: "21.00",
            tax: "0.52",
          },
        },
        {
          ...result.lines[1]!,
          parentLineNo: 1,
          net: {
            unitPrice: "18.18",
            priceQuantity: "1.000",
            base: "5.82",
            rate: "10.00",
            tax: "0.58",
          },
        },
      ],
    });
    const facts = [...el.shadowRoot!.querySelectorAll(".invoice-facts")].map((node) =>
      norm([...node.querySelectorAll("span")].map((span) => span.textContent).join(" "))
        .replace(/\s+/g, " ")
        .trim(),
    );
    expect(facts[0]).toContain("IVA 21.00% 0,52 €");
    expect(facts[1]).toContain("IVA 10.00% 0,58 €");
  });

  it("keeps the F2 gross layout even when net facts are present", async () => {
    const { el } = await mount({
      invoiceType: "F2",
      lines: [
        {
          ...result.lines[0]!,
          net: { unitPrice: "1.24", priceQuantity: "1.000", base: "2.48", rate: "21.00" },
        },
      ],
    });
    expect(text(el)).not.toContain("Factura completa");
    expect(el.shadowRoot!.querySelector(".invoice-facts")).toBeNull();
    expect(norm(el.shadowRoot!.querySelector(".line-gross")!.textContent!)).toBe("3,00 €");
  });

  it.each(["ca-ES", "gl-ES", "eu-ES"])(
    "shows F1 labels and a sub-unit price quantity in %s",
    async (locale) => {
      const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
        issuer,
        invoiceLocale: locale,
        result: {
          ...result,
          invoiceType: "F1",
          lines: [
            {
              descriptions: { [locale]: "Ham" },
              quantity: "0.32",
              gross: "6.40",
              unitName: { es: "kg" },
              net: { unitPrice: "1.82", priceQuantity: "0.100", base: "5.82", rate: "10.00" },
            },
          ],
        },
      });
      const priceLabels = {
        "ca-ES": "Preu sense IVA",
        "gl-ES": "Prezo sen IVE",
        "eu-ES": "BEZik gabeko prezioa",
      };
      expect(text(el)).toContain(priceLabels[locale as keyof typeof priceLabels]);
      expect(
        norm(el.shadowRoot!.querySelector(".invoice-facts span:last-child")!.textContent!)
          .replace(/\s+/g, " ")
          .trim(),
      ).toBe("1,82 € / 0.1 kg");
    },
  );

  it("shows the filed combined quantity for an F1 extra", async () => {
    const { el } = await mount({
      invoiceType: "F1",
      lines: [
        {
          descriptions: { "es-ES": "Plato" },
          quantity: "2",
          gross: "3.00",
          net: { unitPrice: "1.24", priceQuantity: "1.000", base: "2.48", rate: "21.00" },
        },
        {
          descriptions: { "es-ES": "Extra" },
          quantity: "4",
          parentLineNo: 1,
          gross: "6.40",
          net: { unitPrice: "1.45", priceQuantity: "1.000", base: "5.82", rate: "10.00" },
        },
      ],
    });
    expect(el.shadowRoot!.querySelector(".line.option")!.textContent).toContain("Extra 4");
    expect(el.shadowRoot!.querySelector(".line.option")!.textContent).not.toContain("x2");
  });

  it.each(["es-ES", "en-GB"])(
    "shows filed F1 net prices and price quantities (%s)",
    async (locale) => {
      const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
        issuer,
        invoiceLocale: locale,
        result: {
          ...result,
          invoiceType: "F1",
          lines: [
            {
              descriptions: { "es-ES": "Jamón", "en-GB": "Ham" },
              quantity: "0.32",
              unitName: { es: "kg" },
              gross: "6.40",
              net: { unitPrice: "18.18", priceQuantity: "1.000", base: "5.82", rate: "10.00" },
            },
            {
              descriptions: { "es-ES": "Extra", "en-GB": "Extra" },
              quantity: "2",
              parentLineNo: 1,
              gross: "3.00",
              net: { unitPrice: "1.24", priceQuantity: "1.000", base: "2.48", rate: "21.00" },
            },
          ],
        },
      });
      expect(text(el)).toContain("Factura completa");
      const facts = [...el.shadowRoot!.querySelectorAll(".invoice-facts")].map((node) =>
        norm([...node.querySelectorAll("span")].map((span) => span.textContent).join(" "))
          .replace(/\s+/g, " ")
          .trim(),
      );
      expect(facts).toHaveLength(2);
      expect(facts[0]).toContain(
        `Precio sin IVA ${locale === "es-ES" ? "18,18 €" : "€18.18"} / 1 kg`,
      );
      expect(facts[0]).toContain(`Base 10.00% ${locale === "es-ES" ? "5,82 €" : "€5.82"}`);
      expect(facts[1]).toContain(`Base 21.00% ${locale === "es-ES" ? "2,48 €" : "€2.48"}`);
      expect(el.shadowRoot!.querySelector(".lines")!.textContent).not.toContain(
        locale === "es-ES" ? "6,40" : "6.40",
      );
    },
  );

  it.each(["light", "dark"] as const)(
    "wraps long F1 identity text on a phone (%s)",
    async (theme) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      await page.viewport(390, 844);
      try {
        const { el } = await mountWidget<TillTicketView>(
          "till-ticket-view",
          {
            issuer,
            result: {
              ...result,
              invoiceType: "F1",
              issuer: {
                venueName: "Filed Venue SL",
                nif: "B87654321",
                domicile: "Calle fiscal original 27, Madrid",
              },
              recipient: {
                legalName: "Customer".repeat(12),
                taxId: "B11223344",
                address: "Avenida del cliente original 123, Madrid",
                countryCode: "ES",
              },
            },
          },
          theme,
        );
        const recipient = el.shadowRoot!.querySelector<HTMLElement>(".recipient")!;
        expect(recipient.textContent).toContain("Customer".repeat(12));
        expect(recipient.scrollWidth).toBeLessThanOrEqual(recipient.clientWidth);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
      } finally {
        await page.viewport(width, height);
      }
    },
  );

  it.each([
    { invoiceType: "F1", domicile: "Calle Fiscal 27", showLocation: true },
    { invoiceType: "F1", domicile: undefined, showLocation: true },
    { invoiceType: "F2", domicile: "Calle Fiscal 27", showLocation: true },
    { invoiceType: "F2", domicile: undefined, showLocation: true },
  ] as const)(
    "keeps filed F1 domicile separate from the current location address on $invoiceType with domicile=$domicile",
    async ({ invoiceType, domicile, showLocation }) => {
      for (const locale of ["es-ES", "en-GB"]) {
        const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
          result: {
            ...result,
            locale,
            invoiceType,
            issuer: { ...issuer, ...(domicile === undefined ? {} : { domicile }) },
            venueAddress: ["Location Street 45", "28001 Madrid"],
            receiptTrim: { phone: "910000000", email: "venue@example.com" },
          },
          issuer,
          invoiceLocale: locale,
        });
        const header = norm(el.shadowRoot!.querySelector(".issuer")!.textContent ?? "");
        expect(header.includes("Location Street 45")).toBe(showLocation);
        expect(header.includes("28001 Madrid")).toBe(showLocation);
        expect(header.includes("Calle Fiscal 27")).toBe(
          invoiceType === "F1" && domicile !== undefined,
        );
        expect(header).toContain("910000000");
        expect(header).toContain("venue@example.com");
      }
    },
  );

  it("shows the filed F1 domicile and recipient instead of the current issuer", async () => {
    const { el } = await mount({
      invoiceType: "F1",
      issuer: {
        venueName: "Filed Venue SL",
        nif: "B87654321",
        domicile: "Calle fiscal original 27, Madrid",
      },
      recipient: {
        legalName: "Filed Customer SL",
        taxId: "B11223344",
        address: "Avenida original 123, Madrid",
        countryCode: "ES",
      },
    });
    const content = text(el);
    expect(content).toContain("Filed Venue SL");
    expect(content).toContain("Calle fiscal original 27, Madrid");
    expect(content).toContain("Filed Customer SL");
    expect(content).toContain("NIF: B11223344");
    expect(content).toContain("Avenida original 123, Madrid");
    expect(content).not.toContain("Deli Delicioso SL");
    const article = el.shadowRoot!.querySelector("article")!;
    expect(article.querySelectorAll(".qr")).toHaveLength(1);
    const sections = [...article.children];
    expect(sections.indexOf(article.querySelector(".qr-block")!)).toBeLessThan(
      sections.indexOf(article.querySelector(".issuer")!),
    );
    expect(sections.indexOf(article.querySelector(".meta")!)).toBeLessThan(
      sections.indexOf(article.querySelector(".recipient")!),
    );
  });

  it("registers as a custom element", () => {
    expect(customElements.get("till-ticket-view")).toBe(TillTicketView);
  });

  it("marks a practice receipt as a simulated payment with no real charge", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result,
      issuer,
      invoiceLocale: "es-ES",
      simulated: true,
    });
    expect(el.shadowRoot!.querySelector("[data-test=simulation-notice]")?.textContent).toContain(
      "SIN COBRO REAL",
    );
  });

  it("prints the issuer venue name and NIF (RD 1619/2012 art. 7.1.d)", async () => {
    const { el } = await mount();
    const t = text(el);
    expect(t).toContain("Deli Delicioso SL");
    expect(t).toContain("NIF");
    expect(t).toContain("B12345678");
  });

  it("prefers the issuer stored with the filed invoice over current boot identity", async () => {
    const { el } = await mount({
      issuer: { venueName: "Filed Venue SL", nif: "B87654321" },
    });
    const t = text(el);
    expect(t).toContain("Filed Venue SL");
    expect(t).toContain("B87654321");
    expect(t).not.toContain("Deli Delicioso SL");
    expect(t).not.toContain("B12345678");
  });

  it("shows the filed trading name above the legal issuer when it was printed", async () => {
    const { el } = await mount({
      issuer: { venueName: "Filed Venue SL", nif: "B87654321" },
      receiptHeader: { tradingName: "Terrace Bar", printTradingName: true },
    });
    const header = el.shadowRoot!.querySelector(".issuer")!;
    expect([...header.querySelectorAll("p")].map((row) => row.textContent!.trim())).toEqual([
      "Terrace Bar",
      "Filed Venue SL",
      "NIF: B87654321",
    ]);
  });

  it("prints the invoice number + series and the formatted issue date (art. 7.1.a, 7.1.b)", async () => {
    const { el } = await mount();
    const expectedDate = new Intl.DateTimeFormat("es-ES", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(result.issuedAt));
    expect(text(el)).toContain("A/1");
    expect(text(el)).toContain(norm(expectedDate));
  });

  it("prints the order grouping label and number so split documents can be collected together", async () => {
    const { el } = await mount();
    expect(text(el)).toContain("Mesa 6 · Pedido 41");

    const { el: unlabelled } = await mount({ orderLabel: null, orderNumber: 42 });
    expect(text(unlabelled)).toContain("Pedido 42");
  });

  it("identifies each good from the FILED lines: name (invoice locale), quantity and per-line gross (art. 7.1.e)", async () => {
    const { el } = await mount();
    const rows = el.shadowRoot!.querySelectorAll(".line");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Café");
    expect(rows[0]!.textContent).toContain("2");
    expect(norm(rows[0]!.textContent!)).toContain("3,00 €");
    expect(rows[1]!.textContent).toContain("Jamón");
    expect(rows[1]!.textContent).toContain("0.32 kg");
    expect(norm(rows[1]!.textContent!)).toContain("6,40 €");
  });

  it("renders the SERVER's filed lines, not any client basket — a diverging line list follows result.lines", async () => {
    // Overriding `lines` to a DIFFERENT composition shows the rows track the filed result.
    const { el } = await mount({
      lines: [{ descriptions: { "es-ES": "Agua" }, quantity: "3", gross: "6.00" }],
    });
    const rows = el.shadowRoot!.querySelectorAll(".line");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Agua");
    expect(rows[0]!.textContent).toContain("3");
    expect(norm(rows[0]!.textContent!)).toContain("6,00 €");
    expect(el.shadowRoot!.textContent).not.toContain("Café");
    expect(el.shadowRoot!.textContent).not.toContain("Jamón");
  });

  it("groups a filed dish's option lines under it — dish at its price, options indented at their delta (ordering modifiers, Task 14)", async () => {
    // A PAID option (+0.50) and a FREE option (0.00), both children of the dish (lineNo 1).
    const { el } = await mount({
      lines: [
        {
          descriptions: { "es-ES": "Hamburguesa" },
          quantity: "1",
          gross: "10.00",
          parentLineNo: null,
        },
        { descriptions: { "es-ES": "Extra queso" }, quantity: "1", gross: "0.50", parentLineNo: 1 },
        { descriptions: { "es-ES": "Sin cebolla" }, quantity: "1", gross: "0.00", parentLineNo: 1 },
      ],
    });
    const rows = el.shadowRoot!.querySelectorAll(".line");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("Hamburguesa");
    expect(rows[0]!.classList.contains("option")).toBe(false);
    expect(norm(rows[0]!.textContent!)).toContain("10,00 €");
    // The free option shows 0,00 €, never omitted.
    expect(rows[1]!.classList.contains("option")).toBe(true);
    expect(rows[1]!.textContent).toContain("Extra queso");
    expect(norm(rows[1]!.textContent!)).toContain("0,50 €");
    expect(rows[2]!.classList.contains("option")).toBe(true);
    expect(rows[2]!.textContent).toContain("Sin cebolla");
    expect(norm(rows[2]!.textContent!)).toContain("0,00 €");
  });

  it("shows an xN badge for an option taken more than once per dish, and none for a plain option (per-option quantity)", async () => {
    // FILED lines carry the COMBINED count on the child (dishQty × optionQty).
    const { el } = await mount({
      lines: [
        {
          descriptions: { "es-ES": "Hamburguesa" },
          quantity: "2",
          gross: "20.00",
          parentLineNo: null,
        },
        {
          descriptions: { "es-ES": "Extra chupito" },
          quantity: "4",
          gross: "2.00",
          parentLineNo: 1,
        },
        { descriptions: { "es-ES": "Sin cebolla" }, quantity: "2", gross: "0.00", parentLineNo: 1 },
      ],
    });
    const rows = el.shadowRoot!.querySelectorAll(".line");
    expect(rows[1]!.textContent).toContain("Extra chupito");
    expect(rows[1]!.textContent).toContain("x2"); // 4 / 2 = 2 → badge
    expect(rows[2]!.textContent).toContain("Sin cebolla");
    expect(rows[2]!.textContent).not.toContain(" x2"); // 2 / 2 = 1 → no badge
  });

  it("shows a weighted extra's filed physical amount and frozen unit without a pick-count badge", async () => {
    const { el } = await mount({
      lines: [
        {
          descriptions: { "es-ES": "Tostada" },
          quantity: "1",
          gross: "2.00",
          parentLineNo: null,
        },
        {
          descriptions: { "es-ES": "Jamón" },
          quantity: "0.150",
          gross: "0.03",
          unitName: { es: "kg" },
          unitPrecision: 3,
          parentLineNo: 1,
        },
      ],
      total: "2.03",
    });
    const rows = el.shadowRoot!.querySelectorAll(".line");
    expect(rows[1]!.textContent).toContain("Jamón");
    expect(rows[1]!.textContent).toContain("0.150 kg");
    expect(rows[1]!.textContent).not.toContain("x");
  });

  it("shows a filed Each extra as x3 instead of its translated unit abbreviation", async () => {
    const { el } = await mount({
      lines: [
        { descriptions: { "es-ES": "Tostada" }, quantity: "1", gross: "2.00", parentLineNo: null },
        {
          descriptions: { "es-ES": "Queso" },
          quantity: "3",
          gross: "1.50",
          parentLineNo: 1,
          unitName: { es: "pzas" },
          unitPrecision: 0,
          soldInEach: true,
        },
      ],
      total: "3.50",
    });
    const row = el.shadowRoot!.querySelectorAll(".line")[1]!;
    expect(row.textContent).toContain("Queso x3");
    expect(row.textContent).not.toContain("3 pzas");
  });

  it("keeps an integral volume amount and unit when the filed identity is not Each", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: {
        ...result,
        lines: [
          { descriptions: { "en-GB": "Tea" }, quantity: "1", gross: "2.00", parentLineNo: null },
          {
            descriptions: { "en-GB": "Milk" },
            quantity: "150",
            gross: "1.50",
            parentLineNo: 1,
            unitName: { en: "ml" },
            unitPrecision: 0,
          },
        ],
      },
      issuer,
      invoiceLocale: "en-GB",
    });
    const row = el.shadowRoot!.querySelectorAll(".line")[1]!;
    expect(row.textContent).toContain("Milk 150 ml");
    expect(row.textContent).not.toContain("Milk x150");
  });

  it("shows the taxable base per rate, plus the (allowed extra) cuota per rate (art. 7.1.f)", async () => {
    const { el } = await mount();
    const t = text(el);
    expect(t).toContain("Base 21.00%");
    expect(t).toContain("2,48 €"); // base at 21 %
    expect(t).toContain("Base 10.00%");
    expect(t).toContain("5,82 €"); // base at 10 %
    expect(t).toContain("IVA 21.00%");
    expect(t).toContain("0,52 €"); // cuota at 21 %
    expect(t).toContain("IVA 10.00%");
    expect(t).toContain("0,58 €"); // cuota at 10 %
  });

  it("shows the total and the operational efectivo/cambio lines (art. 7.1.g + allowed extras)", async () => {
    const { el } = await mount();
    const t = text(el);
    expect(t).toContain("TOTAL");
    expect(t).toContain("9,40 €");
    expect(t).toContain("Efectivo");
    expect(t).toContain("10,00 €"); // tendered = total + change
    expect(t).toContain("Cambio");
    expect(t).toContain("0,60 €");
  });

  describe("card tender (design §3b)", () => {
    it("keeps card identity off the fiscal ticket while retaining the card tender", async () => {
      const { el } = await mount({
        tender: {
          method: "card",
          charged: "20.90",
          tip: "0.00",
          reference: null,
        },
      });
      const t = text(el);
      expect(t).toContain("Tarjeta");
      expect(t).not.toContain("VISA");
      expect(t).not.toContain("5838");
      expect(t).not.toContain("Sin contacto");
      expect(t).not.toContain("328600");
      expect(t).not.toContain("Efectivo");
    });

    it("shows Propina/Cobrado only when a tip rode on the card", async () => {
      const { el } = await mount({
        tender: {
          method: "card",
          charged: "21.40",
          tip: "0.50",
          reference: null,
        },
      });
      const t = text(el);
      expect(t).toContain("Propina");
      expect(norm(t)).toContain("0,50 €");
      expect(t).toContain("Cobrado");
      expect(norm(t)).toContain("21,40 €");
    });

    it("omits Propina/Cobrado when the card carries no tip", async () => {
      const { el } = await mount({
        tender: {
          method: "card",
          charged: "20.90",
          tip: "0.00",
          reference: null,
        },
      });
      const t = text(el);
      expect(t).not.toContain("Propina");
      expect(t).not.toContain("Cobrado");
      const rows = el.shadowRoot!.querySelectorAll(".tender-row");
      expect(rows).toHaveLength(1);
    });

    it("shows the operator's manual reference when present", async () => {
      const { el } = await mount({
        tender: { method: "card", charged: "20.90", tip: "0.00", reference: "4471" },
      });
      expect(text(el)).toContain("Ref. 4471");
    });

    it("still shows the cash Efectivo/Cambio rows for a cash sale, unchanged", async () => {
      const { el } = await mount({ tender: { method: "cash", change: "0.60" } });
      const t = text(el);
      expect(t).toContain("Efectivo");
      expect(t).toContain("Cambio");
    });

    it("renders no tender extras for an invoice issued before payment", async () => {
      const { el } = await mount({ tender: { method: "unpaid" } });
      const t = text(el);
      expect(t).not.toContain("Efectivo");
      expect(t).not.toContain("Cambio");
      expect(t).not.toContain("Tarjeta");
      expect(el.shadowRoot!.querySelector("[data-test=payment-slip]")).toBeNull();
    });
  });

  it("renders the QR from the verification URL and the VERI*FACTU legend", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("svg")).not.toBeNull();
    expect(text(el)).toContain("VERI*FACTU");
  });

  it("shows «QR tributario:» centred, directly above the QR, in an English operator UI too", async () => {
    setLocale("en-GB");
    const { el } = await mount();
    const qr = el.shadowRoot!.querySelector("svg")!.closest(".qr")!;
    const caption = qr.previousElementSibling as HTMLElement | null;
    expect(caption?.textContent?.trim()).toBe("QR tributario:");
    expect(getComputedStyle(caption!).textAlign).toBe("center");
  });

  it("shows neither the caption nor the legend when no QR is shown, even if the words are given", async () => {
    const { el } = await mount({ qr: "" });
    expect(text(el)).not.toContain("QR tributario");
    expect(text(el)).not.toContain("VERI*FACTU");
  });

  it("shows no QR and no legend when the regime minted no verification URL", async () => {
    const { el } = await mount({ qr: "", qrText: undefined });
    expect(el.shadowRoot!.querySelector("svg")).toBeNull();
    expect(el.shadowRoot!.querySelector(".legend")).toBeNull();
    expect(text(el)).not.toContain("VERI*FACTU");
  });

  it("shows the caption and the legend the sale carries, not words of its own", async () => {
    const { el } = await mount({ qrText: { caption: "CAP-X", legend: "LEG-Y" } });
    const top = el.shadowRoot!.querySelector(".qr-block")!;
    expect(top.querySelector(".qr-caption")!.textContent).toBe("CAP-X");
    expect(top.querySelector(".legend")!.textContent).toBe("LEG-Y");
    expect(text(el)).not.toContain("VERI*FACTU");
    expect(text(el)).not.toContain("QR tributario");
  });

  // AEAT's QR specification v0.5.0 §3: the QR goes at the start of the invoice, before the
  // invoice's own content, with «QR tributario:» above it and VERI*FACTU directly under it.
  describe("the QR comes first on an invoice that carries one", () => {
    /** The ticket's top-level blocks in order, each as its class name, with the QR block spelt out. */
    const blocks = (el: TillTicketView): string[] =>
      [...el.shadowRoot!.querySelector("article.ticket")!.children].map((child) =>
        child.matches(".qr-block")
          ? `qr-block[${[...child.children].map((part) => part.className).join(",")}]`
          : child.className,
      );

    it("shows the caption, the QR and the legend as the ticket's first content, before the issuer", async () => {
      const { el } = await mount({}, { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias" });
      expect(blocks(el).slice(0, 2)).toEqual(["qr-block[qr-caption,qr,legend]", "issuer"]);
      const top = el.shadowRoot!.querySelector(".qr-block")!;
      expect(top.querySelector(".qr-caption")!.textContent).toBe("QR tributario:");
      expect(top.querySelector(".qr svg")).not.toBeNull();
      expect(top.querySelector(".legend")!.textContent).toBe("VERI*FACTU");
      expect(el.shadowRoot!.querySelectorAll(".legend")).toHaveLength(1);
      expect(blocks(el).slice(-2)).toEqual(["tender", "footer-message"]);
    });

    it("keeps the practice notice above the QR block on a simulated ticket", async () => {
      const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
        result,
        issuer,
        invoiceLocale: "es-ES",
        simulated: true,
      });
      expect(blocks(el).slice(0, 3)).toEqual([
        "simulation-notice",
        "qr-block[qr-caption,qr,legend]",
        "issuer",
      ]);
    });

    it("shows a QR the regime gives no words for on its own, before the issuer", async () => {
      const { el } = await mount({ qrText: undefined });
      expect(blocks(el).slice(0, 2)).toEqual(["qr-block[qr]", "issuer"]);
    });

    it("prints a sale with no QR issuer-first, and no legend anywhere: the footer follows the tender", async () => {
      const { el } = await mount({ qr: "", qrText: undefined }, { footerMessage: "Gracias" });
      const all = blocks(el);
      expect(all[0]).toBe("issuer");
      expect(all.slice(-2)).toEqual(["tender", "footer-message"]);
      expect(el.shadowRoot!.querySelector(".legend")).toBeNull();
    });
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
      issuer,
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
    const tenderRows = (el: TillTicketView): string[] =>
      [...el.shadowRoot!.querySelectorAll(".tender .tender-row")].map((row) =>
        norm(row.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim(),
      );

    // The bottle: €30.00 paid by three people at €10.00 each — cash from a €20.00 note, a hand-keyed
    // card with a €1.00 tip on top, and exact cash.
    it("lists every payment with what was handed over, its change and its tip, not only the first", async () => {
      const { el } = await mount({
        total: "30.00",
        tender: { method: "cash", change: "10.00" },
        payments: [
          {
            method: "cash",
            amount: "10.00",
            tip: "0.00",
            tendered: "20.00",
            change: "10.00",
            refunds: [],
          },
          { method: "card", amount: "11.00", tip: "1.00", reference: "OP-9", refunds: [] },
          {
            method: "cash",
            amount: "10.00",
            tip: "0.00",
            tendered: "10.00",
            change: "0.00",
            refunds: [],
          },
        ],
      });

      expect(tenderRows(el)).toEqual([
        "Efectivo 20,00 €",
        "Cambio 10,00 €",
        "Tarjeta 11,00 €",
        "Ref. OP-9",
        "Propina 1,00 €",
        "Efectivo 10,00 €",
      ]);
    });

    // €20.00 charged, €5.00 given back: the card's amount is already net of the refund, so the row
    // shows the original charge and the refund beneath it, as the printed receipt does.
    it("shows a card payment's original charge and each refund given back from it", async () => {
      const { el } = await mount({
        total: "15.00",
        tender: { method: "card", charged: "15.00", tip: "0.00", reference: null },
        payments: [
          {
            method: "card",
            amount: "15.00",
            tip: "0.00",
            reference: null,
            refunds: [
              { amount: "4.00", tip: "0.00" },
              { amount: "1.00", tip: "0.00" },
            ],
          },
        ],
      });

      expect(tenderRows(el)).toEqual([
        "Tarjeta 20,00 €",
        "Devolución -4,00 €",
        "Devolución -1,00 €",
      ]);
    });

    it("shows cash handed over, not the total plus the first payment's change", async () => {
      const { el } = await mount({
        total: "40.00",
        tender: { method: "cash", change: "0.00" },
        payments: [
          {
            method: "cash",
            amount: "40.00",
            tip: "0.00",
            tendered: "50.00",
            change: "0.00",
            refunds: [{ amount: "10.00", tip: "0.00" }],
          },
        ],
      });

      expect(tenderRows(el)).toEqual(["Efectivo 50,00 €", "Devolución -10,00 €"]);
    });
  });

  it("offers a separate payment slip action only for card tenders", async () => {
    const { el: cash } = await mount();
    expect(cash.shadowRoot!.querySelector("[data-test=payment-slip]")).toBeNull();

    const { el: card } = await mount({
      tender: { method: "card", charged: "9.40", tip: "0.00", reference: null },
    });
    let captured: Event | undefined;
    card.addEventListener("payment-slip", (event) => (captured = event));
    card.shadowRoot!.querySelector<HTMLElement>("[data-test=payment-slip]")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("hides receipt and payment-slip actions when this enrolled device cannot print them", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: {
        ...result,
        tender: { method: "card", charged: "9.40", tip: "0.00", reference: null },
      },
      issuer,
      originalReceiptAvailable: true,
      canPrintReceipt: false,
    });
    expect(el.shadowRoot!.querySelector("[data-test=print-receipt]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=reprint]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=payment-slip]")).toBeNull();
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
      issuer,
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

  it("renders the fiscal labels in the INVOICE locale (Spanish) even when the operator UI is English", async () => {
    setLocale("en");
    const { el } = await mount();
    const t = text(el);
    expect(t).toContain("Efectivo"); // es — the operator-UI word would be "Cash"
    expect(t).toContain("Cambio"); // es — the operator-UI word would be "Change"
    expect(t).toContain("Café"); // product name in the invoice locale, not "Coffee"
    expect(t).not.toContain("Cash");
    expect(t).not.toContain("Change");
    expect(t).not.toContain("Coffee");
  });

  describe("the top block mirrors the paper (W111)", () => {
    const LOGO = `${"d".repeat(64)}.png`;
    const full: ReceiptConfig = {
      headerSubtitle: "El mejor jamón",
      phone: "+34 912 345 678",
      email: "hola@deli.es",
      logo: LOGO,
    };
    const mountTop = (receipt: ReceiptConfig, venueAddress: string[], locale = "es-ES") =>
      mountWidget<TillTicketView>("till-ticket-view", {
        result: {
          ...result,
          locale,
          receiptHeader: { tradingName: "La Tienda", printTradingName: true },
          receiptTrim: receipt,
          venueAddress,
          venueReceiptSettings: { printAddress: receipt.printAddress },
        },
        issuer,
        invoiceLocale: locale,
      });
    const headerLines = (el: TillTicketView) =>
      [...el.shadowRoot!.querySelector(".issuer")!.children].map((child) =>
        child instanceof HTMLImageElement
          ? `img ${child.getAttribute("src")}`
          : norm(child.textContent!.trim()),
      );

    it("draws the logo, names, slogan, address, phone and email above the NIF, in the paper's order", async () => {
      const { el } = await mountTop(full, ["Calle Mayor 1", "28013 Madrid"]);
      expect(headerLines(el)).toEqual([
        `img /media/${LOGO}`,
        "La Tienda",
        "El mejor jamón",
        "Deli Delicioso SL",
        "Calle Mayor 1",
        "28013 Madrid",
        "Tel. +34 912 345 678",
        "hola@deli.es",
        "NIF: B12345678",
      ]);
      const logo = el.shadowRoot!.querySelector<HTMLImageElement>(".issuer img")!;
      expect(logo.alt).toBe("");
      expect(getComputedStyle(el.shadowRoot!.querySelector(".issuer")!).textAlign).toBe("center");
    });

    it("draws none of the new lines when the receipt sets none and no address prints", async () => {
      const { el } = await mountTop({}, []);
      expect(headerLines(el)).toEqual(["La Tienda", "Deli Delicioso SL", "NIF: B12345678"]);
    });

    it("keeps the logo no wider than the ticket and no taller than its own bound", async () => {
      const { el } = await mountTop({ logo: LOGO }, []);
      const logo = el.shadowRoot!.querySelector<HTMLImageElement>(".issuer img")!;
      const style = getComputedStyle(logo);
      expect(style.maxWidth).toBe("100%");
      expect(style.maxHeight).not.toBe("none");
      expect(style.objectFit).toBe("contain");
    });

    it("prints the phone's label in the receipt's language", async () => {
      const { el } = await mountTop({ phone: "943 000 000" }, [], "eu-ES");
      expect(headerLines(el)).toContain("Tel. 943 000 000");
    });
  });

  describe("receipt trim (design §8)", () => {
    const following = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    it("renders headerSubtitle before the legal name and footerMessage after the payment lines", async () => {
      const { el } = await mount(
        {},
        { headerSubtitle: "Calle Mayor 1, Madrid", footerMessage: "Gracias por su visita" },
      );
      const sub = el.shadowRoot!.querySelector(".header-subtitle");
      const foot = el.shadowRoot!.querySelector(".footer-message");
      expect(sub!.textContent).toContain("Calle Mayor 1, Madrid");
      expect(foot!.textContent).toContain("Gracias por su visita");
      const venue = el.shadowRoot!.querySelector(".issuer .venue")!;
      expect(el.shadowRoot!.querySelector(".issuer .header-subtitle")).not.toBeNull();
      expect(following(sub!, venue)).toBe(true);
      const tender = el.shadowRoot!.querySelector(".tender")!;
      expect(following(tender, foot!)).toBe(true);
    });

    it("renders neither slot (no empty node) when the receipt config is absent", async () => {
      const { el } = await mount();
      expect(el.shadowRoot!.querySelector(".header-subtitle")).toBeNull();
      expect(el.shadowRoot!.querySelector(".footer-message")).toBeNull();
    });

    it("renders neither slot when the receipt config is empty ({})", async () => {
      const { el } = await mount({}, {});
      expect(el.shadowRoot!.querySelector(".header-subtitle")).toBeNull();
      expect(el.shadowRoot!.querySelector(".footer-message")).toBeNull();
    });

    it("renders only the field that is present (footer only)", async () => {
      const { el } = await mount({}, { footerMessage: "Wifi: DELI-2026" });
      expect(el.shadowRoot!.querySelector(".header-subtitle")).toBeNull();
      expect(el.shadowRoot!.querySelector(".footer-message")!.textContent).toContain(
        "Wifi: DELI-2026",
      );
    });

    it("FISCAL-SAFETY: a receipt config cannot suppress or reorder any mandated art. 7.1 element, the QR or the legend", async () => {
      // The whole immutable core must still render, in its fixed positions, even WITH both trim fields set.
      const { el } = await mount({}, { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias" });
      const t = text(el);
      // 7.1.d issuer venue + NIF
      expect(t).toContain("Deli Delicioso SL");
      expect(t).toContain("NIF");
      expect(t).toContain("B12345678");
      // 7.1.a número/serie + 7.1.b fecha
      expect(t).toContain("A/1");
      // 7.1.e goods identification — both filed lines still present
      expect(el.shadowRoot!.querySelectorAll(".line")).toHaveLength(2);
      expect(t).toContain("Café");
      expect(t).toContain("Jamón");
      // 7.1.f tipo + base per rate (both rates)
      expect(t).toContain("Base 21.00%");
      expect(t).toContain("Base 10.00%");
      expect(t).toContain("IVA 21.00%");
      expect(t).toContain("IVA 10.00%");
      // 7.1.g total
      expect(t).toContain("TOTAL");
      expect(t).toContain("9,40 €");
      // «QR tributario:» caption (AEAT QR specification v0.5.0 §3) + QR + VERI*FACTU legend
      expect(t).toContain("QR tributario:");
      expect(el.shadowRoot!.querySelector("svg")).not.toBeNull();
      expect(t).toContain("VERI*FACTU");
      // The trim renders ONLY in its two slots — the core order is untouched: the issuer header still
      // precedes the meta block, and the footer trim follows the payment lines.
      const header = el.shadowRoot!.querySelector(".issuer")!;
      const meta = el.shadowRoot!.querySelector(".meta")!;
      const tender = el.shadowRoot!.querySelector(".tender")!;
      const foot = el.shadowRoot!.querySelector(".footer-message")!;
      expect(following(header, meta)).toBe(true);
      expect(following(tender, foot)).toBe(true);
    });
  });
});

it("shows saved nonprice modifier answers literally without inventing charge rows", async () => {
  const { el } = await mount({
    lines: [
      {
        ...result.lines[0]!,
        optionSnapshots: [
          {
            listName: { es: "Dedicatoria" },
            listCustomerName: null,
            listKitchenName: null,
            labelName: { es: "<b>Happy day</b>" },
            labelCustomerName: null,
            labelKitchenName: null,
          },
          {
            listName: { es: "Guarnición" },
            listCustomerName: null,
            listKitchenName: null,
            labelName: { es: "Ensalada" },
            labelCustomerName: null,
            labelKitchenName: null,
          },
        ],
      },
    ],
  });
  const answers = [...el.shadowRoot!.querySelectorAll(".modifier-answer")];
  expect(answers.map((answer) => answer.textContent?.trim())).toEqual([
    "Dedicatoria: <b>Happy day</b>",
    "Guarnición: Ensalada",
  ]);
  expect(
    el.shadowRoot!.querySelectorAll(".modifier-answer b, .modifier-answer .line-gross"),
  ).toHaveLength(0);
});

it("resolves a filed line's unit abbreviation from a BARE content-language key", async () => {
  // Only `descriptions` is re-keyed onto the venue's invoice locales
  // (`toInvoiceLineDescriptions`, `packages/catalogue/src/invoice-descriptions.ts`); a line's
  // `unit_name` keeps the bare content-language keys it was stored under, so an exact-key lookup
  // against "es-ES" misses every one of them and shows whichever language happens to come first.
  const { el } = await mount({
    lines: [
      {
        descriptions: { "es-ES": "Jamón" },
        unitName: { ca: "u", en: "ea", es: "ud" },
        unitPrecision: 3,
        quantity: "0.32",
        gross: "6.40",
      },
    ],
  });
  expect(norm(el.shadowRoot!.querySelector(".line-qty")!.textContent ?? "").trim()).toBe("0.32 ud");
});

it("names a filed line from its first stored description when none is in the invoice locale", async () => {
  const { el } = await mount({
    lines: [{ descriptions: { en: "Water", ca: "Aigua" }, quantity: "1", gross: "2.00" }],
  });
  expect(el.shadowRoot!.querySelector(".line-name")!.textContent).toBe("Water");
});

it("prints an empty name, not a crash, for a filed line with no descriptions at all", async () => {
  const { el } = await mount({
    lines: [{ descriptions: {}, quantity: "1", gross: "2.00" }],
  });
  const rows = el.shadowRoot!.querySelectorAll(".line");
  expect(rows).toHaveLength(1);
  expect(rows[0]!.querySelector(".line-name")!.textContent).toBe("");
  expect(norm(rows[0]!.textContent!)).toContain("2,00 €");
});

it("shows a dish's frozen options answers in the DINER's wording", async () => {
  // Three different texts per name, so the assertion fails if the receipt reads the staff or the
  // kitchen side by mistake (CLAUDE.md §3).
  const { el } = await mount({
    lines: [
      {
        ...result.lines[0]!,
        optionSnapshots: [
          {
            listName: { es: "Punto personal" },
            listCustomerName: { "es-ES": "¿Cómo lo quiere?" },
            listKitchenName: "PTO",
            labelName: { es: "Poco personal" },
            labelCustomerName: { "es-ES": "Poco hecho" },
            labelKitchenName: "PH",
          },
        ],
      },
    ],
  });
  expect(
    [...el.shadowRoot!.querySelectorAll(".modifier-answer")].map((answer) =>
      answer.textContent?.trim(),
    ),
  ).toEqual(["¿Cómo lo quiere?: Poco hecho"]);
});

describe("till-ticket-view: a line given away or discounted (service plan Task 11)", () => {
  // Every row prints its list price and each amount taken off is its own line, as on paper
  // (`apps/server/src/receipt-ticket.ts`).
  const adjusted: Partial<TillSaleResult> = {
    total: "25.50",
    lines: [
      {
        descriptions: { "es-ES": "Hamburguesa" },
        quantity: "1",
        gross: "0.00",
        listGross: "12.00",
        adjustments: [{ kind: "comp", amount: "12.00" }],
      },
      {
        descriptions: { "es-ES": "Aceitunas" },
        quantity: "1",
        gross: "0.00",
        listGross: "1.50",
        parentLineNo: 1,
        adjustments: [{ kind: "comp", amount: "1.50" }],
      },
      {
        descriptions: { "es-ES": "Rioja" },
        quantity: "1",
        gross: "24.00",
        listGross: "30.00",
        adjustments: [{ kind: "discount", percentBp: 2000, amount: "6.00" }],
      },
      { descriptions: { "es-ES": "Pan" }, quantity: "1", gross: "2.50" },
    ],
    billAdjustments: [{ kind: "discount", amount: "1.00" }],
  };
  const rowText = (row: Element) =>
    norm(row.textContent!)
      .replace(/[ \n\t]+/g, " ")
      .trim();

  it("shows each dish at its list price, with what was taken off on its own line after its options", async () => {
    const { el } = await mount(adjusted);
    const rows = [...el.shadowRoot!.querySelectorAll(".lines > li")];

    expect(rows.map(rowText)).toEqual([
      "Hamburguesa 1 12,00 €",
      "Aceitunas 1,50 €",
      "Invitación -12,00 €",
      "Invitación -1,50 €",
      "Rioja 1 30,00 €",
      "Descuento 20% -6,00 €",
      "Pan 1 2,50 €",
      "Descuento -1,00 €",
    ]);
  });

  it("shows no struck-through price", async () => {
    const { el } = await mount(adjusted);

    expect(el.shadowRoot!.querySelectorAll("s")).toHaveLength(0);
  });

  it("writes a percentage in the invoice locale, to two decimals at most", async () => {
    const { el } = await mount({
      lines: [
        {
          descriptions: { "es-ES": "Rioja" },
          quantity: "1",
          gross: "26.25",
          listGross: "30.00",
          adjustments: [{ kind: "discount", percentBp: 1250, amount: "3.75" }],
        },
        {
          descriptions: { "es-ES": "Vermut" },
          quantity: "3",
          gross: "8.00",
          listGross: "9.00",
          adjustments: [{ kind: "discount", percentBp: 1111, amount: "1.00" }],
        },
      ],
    });
    const entries = [...el.shadowRoot!.querySelectorAll(".lines > .adjustment")];

    expect(entries.map(rowText)).toEqual(["Descuento 12,5% -3,75 €", "Descuento 11,11% -1,00 €"]);
  });

  it("shows a discount on the whole bill once, after the goods and before the VAT breakdown", async () => {
    const { el } = await mount(adjusted);
    const bill = [...el.shadowRoot!.querySelectorAll(".bill-adjustment")];
    const firstVat = el.shadowRoot!.querySelector(".vat-row")!;
    const lastGoods = [...el.shadowRoot!.querySelectorAll(".lines > li:not(.bill-adjustment)")].at(
      -1,
    )!;

    expect(bill.map(rowText)).toEqual(["Descuento -1,00 €"]);
    expect(
      lastGoods.compareDocumentPosition(bill[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      bill[0]!.compareDocumentPosition(firstVat) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("till-ticket-view: the sale's own language", () => {
  const rows = (el: TillTicketView, selector: string): string[] =>
    [...el.shadowRoot!.querySelectorAll(selector)].map((row) =>
      norm(row.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    );
  // Measured in Playwright's Chromium 153 and Chrome 154: neither formats Galician or Basque
  // numbers or dates, so those sales are formatted the Spanish way.
  const spanishDate = norm(
    new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(result.issuedAt),
    ),
  );
  const catalan: Partial<TillSaleResult> = {
    locale: "ca-ES",
    lines: [
      { descriptions: { "ca-ES": "Cafè" }, quantity: "2", gross: "3.00" },
      { descriptions: { "ca-ES": "Pernil" }, quantity: "1", gross: "6.40" },
    ],
  };

  it("prints its fixed words in the language the sale was filed in, not the till's boot language", async () => {
    const { el } = await mount(catalan);
    const t = text(el);

    expect(rows(el, ".meta-row")[0]).toBe("Factura A/1");
    expect(rows(el, ".meta-row")[1]).toBe(
      `Data ${norm(
        new Intl.DateTimeFormat("ca-ES", { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(result.issuedAt),
        ),
      )}`,
    );
    expect(rows(el, ".order-group")).toEqual(["Mesa 6 · Comanda 41"]);
    expect(el.shadowRoot!.querySelector("article")!.getAttribute("lang")).toBe("ca-ES");
    expect(rows(el, ".lines > li")).toEqual(["Cafè 2 3,00 €", "Pernil 1 6,40 €"]);
    expect(rows(el, ".vat-row")).toEqual([
      "Base 21.00% 2,48 €",
      "IVA 21.00% 0,52 €",
      "Base 10.00% 5,82 €",
      "IVA 10.00% 0,58 €",
    ]);
    expect(rows(el, ".total-row")).toEqual(["TOTAL 9,40 €"]);
    expect(rows(el, ".tender .tender-row")).toEqual(["Efectiu 10,00 €", "Canvi 0,60 €"]);
    for (const spanish of ["Fecha", "Pedido", "Efectivo", "Cambio"]) {
      expect(t).not.toContain(spanish);
    }
  });

  it("keeps the VERI*FACTU legend and AEAT's QR caption word for word", async () => {
    const { el } = await mount(catalan);

    expect(el.shadowRoot!.querySelector(".legend")!.textContent).toBe("VERI*FACTU");
    expect(el.shadowRoot!.querySelector(".qr-caption")!.textContent).toBe("QR tributario:");
  });

  it("names a card, its reference, tip and charge in the sale's language", async () => {
    const { el } = await mount({
      locale: "eu-ES",
      tender: { method: "card", charged: "9.90", tip: "0.50", reference: "4471" },
    });

    expect(rows(el, ".meta-row")[1]).toBe(`Data ${spanishDate}`);
    expect(el.shadowRoot!.querySelector("article")!.getAttribute("lang")).toBe("eu-ES");
    expect(rows(el, ".tender .tender-row")).toEqual([
      "Txartela",
      "Erref. 4471",
      "Eskupekoa 0,50 €",
      "Kobratua 9,90 €",
    ]);
  });

  it("names each payment of a bill paid in parts, and its refund, in the sale's language", async () => {
    const { el } = await mount({
      locale: "eu-ES",
      total: "21.00",
      tender: { method: "cash", change: "10.00" },
      payments: [
        {
          method: "cash",
          amount: "10.00",
          tip: "0.00",
          tendered: "20.00",
          change: "10.00",
          refunds: [],
        },
        {
          method: "card",
          amount: "11.00",
          tip: "1.00",
          reference: "OP-9",
          refunds: [{ amount: "2.00", tip: "0.00" }],
        },
      ],
    });

    expect(rows(el, ".tender .tender-row")).toEqual([
      "Eskudirua 20,00 €",
      "Itzulia 10,00 €",
      "Txartela 13,00 €",
      "Erref. OP-9",
      "Eskupekoa 1,00 €",
      "Itzulketa -2,00 €",
    ]);
  });

  it("names a comp and a discount in the sale's language", async () => {
    const { el } = await mount({
      locale: "ca-ES",
      lines: [
        {
          descriptions: { "ca-ES": "Hamburguesa" },
          quantity: "1",
          gross: "0.00",
          listGross: "12.00",
          adjustments: [{ kind: "comp", amount: "12.00" }],
        },
        {
          descriptions: { "ca-ES": "Rioja" },
          quantity: "1",
          gross: "24.00",
          listGross: "30.00",
          adjustments: [{ kind: "discount", percentBp: 2000, amount: "6.00" }],
        },
      ],
      billAdjustments: [{ kind: "discount", amount: "1.00" }],
    });

    expect(rows(el, ".lines > li")).toEqual([
      "Hamburguesa 1 12,00 €",
      "Invitació -12,00 €",
      "Rioja 1 30,00 €",
      "Descompte 20% -6,00 €",
      "Descompte -1,00 €",
    ]);
  });

  it("marks a practice receipt in the sale's language, with the screen's long dash", async () => {
    const practice = (over: Partial<TillSaleResult>) =>
      mountWidget<TillTicketView>("till-ticket-view", {
        result: { ...result, ...over },
        issuer,
        invoiceLocale: "es-ES",
        simulated: true,
      });
    const notice = (el: TillTicketView) =>
      el.shadowRoot!.querySelector("[data-test=simulation-notice]")!.textContent!.trim();

    expect(notice((await practice({ locale: "ca-ES" })).el)).toBe("PROVA — SENSE COBRAMENT REAL");
    expect(notice((await practice({})).el)).toBe("PRUEBA — SIN COBRO REAL");
  });

  it("falls back to the till's boot language when the result names none", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: {
        ...result,
        lines: [{ descriptions: { "gl-ES": "Café" }, quantity: "1", gross: "9.40" }],
        tender: { method: "card", charged: "9.40", tip: "0.00", reference: null },
      },
      issuer,
      invoiceLocale: "gl-ES",
    });

    expect(rows(el, ".vat-row")).toContain("IVE 21.00% 0,52 €");
    expect(rows(el, ".tender .tender-row")).toEqual(["Tarxeta"]);
  });
});
