import { createCanvas } from "@napi-rs/canvas";
import jsQR from "jsqr";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
import {
  getCountryPack,
  RECIPIENT_IDENTIFIER_LABELS,
  receiptLabelsFor,
} from "@waitron/country-packs";
import type { ReceiptLogoRaster } from "@waitron/shared";
import { CUSTOMER_PANEL_FRACTION, layoutA4Invoice, layoutInvoiceHeader } from "./invoice-layout.js";
import {
  INVOICE_PAGE_HEIGHT,
  invoiceTextWidth,
  type InvoicePage,
  type InvoicePageElement,
} from "./invoice-page.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { renderInvoiceRaster } from "./invoice-raster.js";
import { receiptDateTime, receiptDay } from "./receipt-dates.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import type { TillSaleLine } from "./till-sale.js";
import { receiptFacts } from "./receipt-facts.js";
import { formatMoney, formatVatRate } from "./receipt-money.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./testing/full-invoice-fixture.js";
import * as receiptCases from "./testing/receipt-cases.js";
import { sampleDocument } from "./sample-receipt.js";

type Text = Extract<InvoicePageElement, { kind: "text" }>;
type Box = Extract<InvoicePageElement, { kind: "box" }>;
type Qr = Extract<InvoicePageElement, { kind: "qr" }>;
type Rule = Extract<InvoicePageElement, { kind: "rule" }>;

const RIGHT = 595.28 - 36;
const QR_SIZE = (35 * 72) / 25.4;
const labels = receiptLabelsFor("es-ES");
const fixture = (): ReceiptDocumentInput => structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
const { issuer, orderLabel } = FULL_INVOICE_DOCUMENT_FIXTURE.result;
const { headerSubtitle } = FULL_INVOICE_DOCUMENT_FIXTURE.receipt;
const header = (input: ReceiptDocumentInput, logo?: ReceiptLogoRaster | null) =>
  layoutInvoiceHeader(receiptFacts(input), logo);
const texts = (elements: readonly InvoicePageElement[]): Text[] =>
  elements.filter((element): element is Text => element.kind === "text");
const qrOf = (elements: readonly InvoicePageElement[]): Qr =>
  elements.find((element): element is Qr => element.kind === "qr")!;
const textRight = (text: Text): number =>
  text.x + invoiceTextWidth(text.text, text.size, text.weight);
const named = (elements: readonly InvoicePageElement[], value: string): Text => {
  const found = texts(elements).find((text) => text.text === value);
  expect(found, value).toBeDefined();
  return found!;
};

/** Every shared receipt case, built; an export that is not a case builder is skipped. */
const receiptCaseInputs = (): [string, ReceiptDocumentInput][] =>
  Object.entries(receiptCases).flatMap(([name, build]): [string, ReceiptDocumentInput][] =>
    typeof build === "function" ? [[name, build()]] : [],
  );

/** The area an element covers: a text line takes its line height. */
const area = (element: InvoicePageElement) => {
  switch (element.kind) {
    case "text":
      return {
        left: element.x,
        top: element.y,
        right: textRight(element),
        bottom: element.y + element.size * 1.4,
      };
    case "qr": {
      const side = element.modules.length * element.moduleSize;
      return { left: element.x, top: element.y, right: element.x + side, bottom: element.y + side };
    }
    case "rule":
      return {
        left: element.x,
        top: element.y,
        right: element.x + element.width,
        bottom: element.y + element.thickness,
      };
    default:
      return {
        left: element.x,
        top: element.y,
        right: element.x + element.width,
        bottom: element.y + element.height,
      };
  }
};

describe("layoutInvoiceHeader", () => {
  it("draws the QR at the left margin, 35 mm square, with its words above and below at body size and its quiet zone clear", () => {
    const { elements } = header(fixture());
    const qr = qrOf(elements);
    const side = qr.modules.length * qr.moduleSize;
    const quiet = 4 * qr.moduleSize;
    expect(qr.x).toBe(36);
    expect(side).toBeCloseTo(QR_SIZE, 6);
    const { caption, legend } = FULL_INVOICE_DOCUMENT_FIXTURE.result.qrText!;
    const above = named(elements, caption!);
    const below = named(elements, legend!);
    expect([above.size, below.size]).toEqual([9, 9]);
    expect(above.x).toBe(36);
    expect(below.x).toBe(36);
    expect(above.y).toBeLessThan(qr.y);
    expect(below.y).toBeGreaterThan(qr.y + side);
    const zone = {
      left: qr.x - quiet,
      top: qr.y - quiet,
      right: qr.x + side + quiet,
      bottom: qr.y + side + quiet,
    };
    for (const element of elements) {
      if (element === qr) continue;
      const covered = area(element);
      const overlaps =
        covered.left < zone.right &&
        covered.right > zone.left &&
        covered.top < zone.bottom &&
        covered.bottom > zone.top;
      expect(overlaps, JSON.stringify({ ...element, modules: undefined })).toBe(false);
    }
  });

  it("starts the letterhead with the legal name, bold and 18 pt at the right edge, when no logo and no trading name print", () => {
    const input = fixture();
    input.receiptHeader = { tradingName: "La Buena", printTradingName: false };
    const { elements } = header(input, null);
    const letterhead = texts(elements).filter((text) => Math.abs(textRight(text) - RIGHT) < 0.01);
    const [first] = letterhead;
    expect(first).toMatchObject({ text: input.result.issuer!.venueName, weight: "bold", size: 18 });
    expect(texts(elements).some((text) => text.text.includes(`${labels.nif} B12345678`))).toBe(
      true,
    );
    expect(elements.some((element) => element.kind === "logo")).toBe(false);
  });

  it("puts the logo above a bold 18 pt trading name, then the legal name and NIF on one line, all at the right edge", () => {
    const logo: ReceiptLogoRaster = { widthDots: 16, heightDots: 8, bits: new Uint8Array(16) };
    const { elements } = header(fixture(), logo);
    const drawn = elements.find((element) => element.kind === "logo")!;
    const placed = area(drawn);
    expect(placed.right).toBeCloseTo(RIGHT, 6);
    const trading = named(elements, "La Buena");
    expect(trading).toMatchObject({ weight: "bold", size: 18 });
    expect(textRight(trading)).toBeCloseTo(RIGHT, 6);
    expect(trading.y).toBeGreaterThanOrEqual(placed.bottom);
    const legal = named(elements, `${issuer!.venueName} · ${labels.nif} B12345678`);
    expect(legal.y).toBeGreaterThan(trading.y);
    expect(textRight(legal)).toBeCloseTo(RIGHT, 6);
    const subtitle = named(elements, headerSubtitle!);
    expect(subtitle.y).toBeGreaterThan(trading.y);
    expect(subtitle.y).toBeLessThan(legal.y);
    const contact = named(elements, `${labels.phone} 910000000 · venue@example.test`);
    expect(textRight(contact)).toBeCloseTo(RIGHT, 6);
  });

  it("wraps a full invoice's domicile right-aligned under the legal name", () => {
    const { elements } = header(fixture());
    const domicile = issuer!.domicile!;
    const legal = named(elements, `${issuer!.venueName} · ${labels.nif} B12345678`);
    const lines = texts(elements).filter(
      (text) => text.text.length > 1 && domicile.includes(text.text),
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((line) => line.text).join(" ")).toBe(domicile);
    for (const line of lines) {
      expect(textRight(line)).toBeCloseTo(RIGHT, 6);
      expect(line.y).toBeGreaterThan(legal.y);
    }
  });

  it("titles the band with the invoice heading and number, bold 17 pt, under a 1.5 pt rule and over a 0.75 pt one", () => {
    const { elements } = header(fixture());
    const title = named(elements, `${labels.invoiceHeading} FF/1`);
    expect(title).toMatchObject({ weight: "bold", size: 17, x: 36 });
    const rules = elements.filter((element): element is Rule => element.kind === "rule");
    const heavy = rules.find((rule) => rule.thickness === 1.5)!;
    const light = rules.find((rule) => rule.thickness === 0.75 && rule.y > title.y)!;
    expect(heavy.y).toBeLessThan(title.y);
    expect([heavy.x, heavy.width]).toEqual([36, RIGHT - 36]);
    expect(light.y).toBeGreaterThan(title.y + 17);
  });

  it("puts muted 8 pt labels over 10 pt values for the date and the order, with the order label as stored", () => {
    const { elements } = header(fixture());
    const pairs: [string, string][] = [
      [labels.date, receiptDateTime("2026-08-17T22:34:00.000Z", "es-ES", 120)],
      [labels.order, "41"],
    ];
    for (const [label, value] of pairs) {
      const over = named(elements, label);
      const under = named(elements, value);
      expect(over).toMatchObject({ tone: "muted", size: 8 });
      expect(under).toMatchObject({ tone: "ink", size: 10 });
      expect(under.x).toBe(over.x);
      expect(under.y).toBeGreaterThan(over.y);
    }
    expect(named(elements, orderLabel!)).toMatchObject({ tone: "ink", size: 10 });
  });

  it("adds a pair to the band for a duplicate, a take-away and a sale day", () => {
    const plain = texts(header(fixture()).elements).map((text) => text.text);
    const saleDay = receiptDay("2026-08-16", "es-ES");
    for (const absent of [labels.duplicate, labels.takeAway, labels.saleDate, saleDay]) {
      expect(plain).not.toContain(absent);
    }
    const duplicate = fixture();
    duplicate.duplicate = true;
    expect(named(header(duplicate).elements, labels.duplicate)).toMatchObject({ size: 10 });
    const takeAway = fixture();
    takeAway.result.takeAway = true;
    expect(named(header(takeAway).elements, labels.takeAway)).toMatchObject({ size: 10 });
    const sale = fixture();
    sale.result.saleDay = "2026-08-16";
    const { elements } = header(sale);
    const over = named(elements, labels.saleDate);
    const under = named(elements, saleDay);
    expect(over).toMatchObject({ tone: "muted", size: 8 });
    expect(under).toMatchObject({ tone: "ink", size: 10, x: over.x });
    expect(under.y).toBeGreaterThan(over.y);
  });

  it("titles a corrective with the corrective heading and names the invoice it corrects below the band", () => {
    const input = fixture();
    input.result.invoiceType = "R5";
    input.result.corrects = {
      invoiceNumber: "A/7",
      issuedAt: "2026-08-16T20:00:00.000Z",
      issuedOffsetMinutes: 120,
    };
    const { elements } = header(input);
    const title = named(elements, `${labels.correctiveInvoice} FF/1`);
    expect(title).toMatchObject({ weight: "bold", size: 17 });
    const date = receiptDateTime("2026-08-16T20:00:00.000Z", "es-ES", 120);
    const corrected = named(elements, `${labels.correctsInvoice} A/7 · ${date}`);
    expect(corrected.y).toBeGreaterThan(title.y);
    expect(texts(elements).some((text) => text.text.startsWith(labels.rectificationAmount))).toBe(
      false,
    );

    input.result.corrects.inFull = true;
    const inFull = header(input).elements;
    named(inFull, `${labels.replacesInvoiceInFull} A/7 · ${date}`);
    expect(texts(inFull).some((text) => text.text.startsWith(labels.rectificationAmount))).toBe(
      true,
    );
  });

  it("draws the customer in a shaded panel about 60 % of the text width, which grows as a long name wraps", () => {
    const short = fixture();
    short.result.recipient!.legalName = "Customer Ltd";
    const shortHeader = header(short);
    const shortPanel = shortHeader.elements.find(
      (element): element is Box => element.kind === "box",
    )!;
    expect(shortPanel).toMatchObject({
      fill: "panel",
      x: 36,
      width: (RIGHT - 36) * CUSTOMER_PANEL_FRACTION,
    });
    expect(named(shortHeader.elements, labels.customer)).toMatchObject({ tone: "muted" });
    expect(named(shortHeader.elements, "Customer Ltd")).toMatchObject({ weight: "bold" });

    const long = fixture();
    long.result.recipient!.legalName = `${"Customer with a very long name ".repeat(4)}Limited`;
    const { elements, bottom } = header(long);
    const panel = elements.find((element): element is Box => element.kind === "box")!;
    const name = texts(elements).filter((text) => text.weight === "bold" && text.y > panel.y);
    expect(name.length).toBeGreaterThan(1);
    expect(name.map((line) => line.text).join(" ")).toBe(long.result.recipient!.legalName);
    expect(panel.height).toBeGreaterThan(shortPanel.height);
    for (const line of texts(elements).filter((text) => text.y >= panel.y)) {
      expect(line.x).toBeGreaterThanOrEqual(panel.x);
      expect(textRight(line)).toBeLessThanOrEqual(panel.x + panel.width);
      expect(line.y + line.size).toBeLessThanOrEqual(panel.y + panel.height);
    }
    expect(bottom).toBeGreaterThan(panel.y + panel.height);
  });

  it("gives a simplified invoice no customer panel and no domicile", () => {
    const input = fixture();
    input.result.invoiceType = "F2";
    const { elements } = header(input);
    expect(elements.some((element) => element.kind === "box")).toBe(false);
    expect(texts(elements).some((text) => issuer!.domicile!.includes(text.text))).toBe(false);
    expect(texts(elements).map((text) => text.text)).not.toContain(labels.customer);
  });

  describe("the letterhead's address and contact lines", () => {
    /** The letterhead's lines after the NIF, up to the band's title. */
    const contactLines = (
      receipt: ReceiptDocumentInput["receipt"],
      domicile: string | undefined,
      invoiceType: "F1" | "F2",
    ): string[] => {
      const input = fixture();
      input.receiptHeader = undefined;
      input.receipt = receipt;
      input.result.qr = "";
      input.result.invoiceType = invoiceType;
      input.result.issuer = {
        venueName: "Legal SL",
        nif: "B12345678",
        ...(domicile === undefined ? {} : { domicile }),
      };
      const shown = texts(header(input).elements).map((text) => text.text);
      const nif = shown.findIndex((text) => text.endsWith(`${labels.nif} B12345678`));
      const title = shown.findIndex((text) => text.endsWith(" FF/1"));
      return shown.slice(nif + 1, title);
    };
    const phone = `${labels.phone} 912 345 678`;

    it("puts a full invoice's registered address, then its phone and email on one line", () => {
      expect(
        contactLines({ phone: "912 345 678", email: "hola@labuena.es" }, "Filed domicile", "F1"),
      ).toEqual(["Filed domicile", `${phone} · hola@labuena.es`]);
    });

    it("leaves out of a full invoice's letterhead the parts that are not set", () => {
      expect(contactLines({ email: "hola@labuena.es" }, "Filed domicile", "F1")).toEqual([
        "Filed domicile",
        "hola@labuena.es",
      ]);
      expect(contactLines({ phone: "912 345 678" }, undefined, "F1")).toEqual([phone]);
      expect(contactLines({}, undefined, "F1")).toEqual([]);
    });

    it("gives a simplified invoice its phone and email but no registered address", () => {
      expect(
        contactLines({ phone: "912 345 678", email: "hola@labuena.es" }, "Filed domicile", "F2"),
      ).toEqual([`${phone} · hola@labuena.es`]);
    });
  });

  it("puts a practice document's bordered box above the QR", () => {
    const input = fixture();
    input.simulated = true;
    input.simulatedCardPayment = true;
    const { elements } = header(input);
    const qr = qrOf(elements);
    const quiet = 4 * qr.moduleSize;
    const practice = named(elements, labels.practice);
    const noCharge = named(elements, labels.noRealCharge);
    expect(practice).toMatchObject({ tone: "ink" });
    const border = elements.filter(
      (element): element is Rule => element.kind === "rule" && element.y < qr.y,
    );
    const top = Math.min(...border.map((rule) => rule.y));
    const bottom = Math.max(...border.map((rule) => rule.y + rule.thickness));
    const left = Math.min(...border.map((rule) => rule.x));
    const right = Math.max(...border.map((rule) => rule.x + rule.width));
    expect(border).toHaveLength(4);
    expect([left, right]).toEqual([36, RIGHT]);
    for (const line of [practice, noCharge]) {
      expect(line.y).toBeGreaterThan(top);
      expect(line.y + line.size).toBeLessThan(bottom);
    }
    expect(bottom).toBeLessThanOrEqual(qr.y - quiet);
    const plain = header(fixture()).elements;
    expect(qrOf(plain).y).toBeLessThan(qr.y);
  });

  it("lets the letterhead use the whole width when there is no QR, and drops parts that are not set", () => {
    const input = fixture();
    input.result.qr = "";
    input.receipt = {};
    input.result.orderLabel = null;
    input.result.orderNumber = 0;
    const { elements } = header(input);
    expect(elements.some((element) => element.kind === "qr")).toBe(false);
    const shown = texts(elements).map((text) => text.text);
    expect(shown).not.toContain(labels.order);
    expect(shown.some((text) => text.includes(labels.phone))).toBe(false);
    expect(shown).not.toContain(headerSubtitle!);
    const domicile = FULL_INVOICE_DOCUMENT_FIXTURE.result.issuer!.domicile!;
    const lines = texts(elements).filter((text) => domicile.includes(text.text));
    expect(Math.min(...lines.map((line) => line.x))).toBeLessThan(36 + QR_SIZE);
  });

  it("leaves out the QR's words when the record has none", () => {
    const input = fixture();
    delete input.result.qrText;
    const { elements } = header(input);
    const qr = qrOf(elements);
    expect(texts(elements).filter((text) => text.x === 36 && text.y < qr.y)).toEqual([]);
  });

  it("boxes a test page's notice above the QR", () => {
    const input = fixture();
    input.testPage = { printer: "Office" };
    const { elements } = header(input);
    expect(named(elements, labels.paymentNotice).y).toBeLessThan(qrOf(elements).y);
    expect(texts(elements).map((text) => text.text)).not.toContain(labels.practice);
  });

  it("shrinks a logo wider than the letterhead's room to fit it", () => {
    const logo: ReceiptLogoRaster = {
      widthDots: 2000,
      heightDots: 100,
      bits: new Uint8Array(25000),
    };
    const drawn = header(fixture(), logo).elements.find((element) => element.kind === "logo")!;
    const placed = area(drawn);
    expect(placed.right).toBeCloseTo(RIGHT, 6);
    expect(placed.left).toBeGreaterThan(36 + QR_SIZE);
    expect((placed.right - placed.left) / (placed.bottom - placed.top)).toBeCloseTo(20, 6);
  });

  it("moves the band's pairs under a title too wide to share the line, and onto further rows when they crowd", () => {
    const input = fixture();
    input.result.invoiceNumber = "A-VERY-LONG-INVOICE-SERIES/2026/000001";
    input.result.orderLabel = "Terrace beside the big fountain in the courtyard";
    input.result.saleDay = "2026-08-16";
    input.result.takeAway = true;
    input.duplicate = true;
    const { elements } = header(input);
    const title = named(
      elements,
      `${labels.invoiceHeading} A-VERY-LONG-INVOICE-SERIES/2026/000001`,
    );
    const duplicate = named(elements, labels.duplicate);
    expect(duplicate.x).toBe(36);
    expect(duplicate.y).toBeGreaterThan(title.y + 17);
    const takeAway = named(elements, labels.takeAway);
    expect(takeAway.y).toBeGreaterThan(duplicate.y + 10);
    for (const text of texts(elements)) expect(textRight(text)).toBeLessThanOrEqual(RIGHT + 1e-6);
  });

  it("wraps a band value wider than the band", () => {
    const input = fixture();
    input.result.orderLabel = "Table ".repeat(40).trim();
    const { elements, bottom } = header(input);
    const lines = texts(elements).filter((text) => text.text.startsWith("Table"));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((line) => line.text).join(" ")).toBe(input.result.orderLabel);
    const light = elements.find(
      (element): element is Rule => element.kind === "rule" && element.thickness === 0.75,
    )!;
    expect(light.y).toBeGreaterThan(Math.max(...lines.map((line) => line.y + line.size)));
    expect(bottom).toBeGreaterThan(light.y);
  });

  it("titles a simplified invoice with the simplified-invoice heading", () => {
    const input = fixture();
    input.result.invoiceType = "F2";
    const { elements } = header(input);
    named(elements, `${labels.simplifiedInvoice} FF/1`);
    expect(texts(elements).map((text) => text.text)).not.toContain(`${labels.invoiceHeading} FF/1`);
  });

  it("puts the duplicate tag first after the title, before the date", () => {
    const input = fixture();
    input.duplicate = true;
    const { elements } = header(input);
    const title = named(elements, `${labels.invoiceHeading} FF/1`);
    const duplicate = named(elements, labels.duplicate);
    const date = named(elements, labels.date);
    expect(duplicate.x).toBeGreaterThan(textRight(title));
    expect(duplicate.x).toBeLessThan(date.x);
  });

  it("never draws one text over another, whatever the title's length", () => {
    const corrective = (number: string, locale = "es-ES", inFull = false): ReceiptDocumentInput => {
      const input = fixture();
      input.invoiceLocale = locale;
      input.result.invoiceType = "R5";
      input.result.invoiceNumber = number;
      input.result.corrects = {
        invoiceNumber: "A/7",
        issuedAt: "2026-08-16T20:00:00.000Z",
        ...(inFull ? { inFull: true as const } : {}),
      };
      return input;
    };
    const crowded = fixture();
    crowded.duplicate = true;
    crowded.result.takeAway = true;
    crowded.result.saleDay = "2026-08-16";
    crowded.simulated = true;
    const inputs: [string, ReceiptDocumentInput][] = [
      ["fixture", fixture()],
      ["crowded", crowded],
      ...["FF/1", "FR/12", "R/12", "RX/123", "RX/12345", "RXY/2026/0001"].flatMap(
        (number): [string, ReceiptDocumentInput][] =>
          ["es-ES", "en-GB", "ca-ES", "gl-ES", "eu-ES"].map((locale) => [
            `corrective ${number} ${locale}`,
            corrective(number, locale, number.length % 2 === 0),
          ]),
      ),
      ...receiptCaseInputs(),
    ];
    for (const [name, input] of inputs) {
      const drawn = texts(header(input).elements).map((text) => ({ text, at: area(text) }));
      for (const [index, one] of drawn.entries()) {
        for (const other of drawn.slice(index + 1)) {
          const overlaps =
            one.at.left < other.at.right - 0.01 &&
            other.at.left < one.at.right - 0.01 &&
            one.at.top < other.at.bottom - 0.01 &&
            other.at.top < one.at.bottom - 0.01;
          expect(overlaps, `${name}: "${one.text.text}" and "${other.text.text}"`).toBe(false);
        }
      }
    }
  });

  it("reports a bottom below every element it drew", () => {
    const { elements, bottom } = header(fixture());
    for (const element of elements) expect(area(element).bottom).toBeLessThanOrEqual(bottom);
  });
});

const money = (value: string): string => formatMoney(value, "es-ES");
const allElements = (pages: readonly InvoicePage[]): InvoicePageElement[] =>
  pages.flatMap((page) => page.elements);
const lastPage = (pages: readonly InvoicePage[]): InvoicePageElement[] => pages.at(-1)!.elements;
const anyText = (elements: readonly InvoicePageElement[], match: (text: string) => boolean) =>
  texts(elements).some((text) => match(text.text));
const paidLine = (elements: readonly InvoicePageElement[]) =>
  anyText(elements, (text) => text === labels.paid || text.startsWith(`${labels.paid} `));
const ACCOUNT = { iban: "ES9121000418450200051332", bankName: "OPENBANK" };
const GROUPED = "ES91 2100 0418 4502 0005 1332";
const dishName = Object.values(FULL_INVOICE_DOCUMENT_FIXTURE.result.lines[0]!.descriptions)[0]!;

const deferredInput = (account: { iban: string; bankName: string | null } | null) => {
  const input = fixture();
  input.result.tender = { method: "deferred" };
  input.result.owed = "19.69";
  input.deferredPayment = { account };
  return input;
};

/** A copy of the fixture with `count` more lines of water, enough to run onto later pages. */
const longInvoice = (count: number): ReceiptDocumentInput => {
  const input = fixture();
  const water = input.result.lines[1]!;
  input.result.lines = [
    ...input.result.lines,
    ...Array.from({ length: count }, () => structuredClone(water)),
  ];
  return input;
};

const rowBottoms = (elements: readonly InvoicePageElement[], summaryTop: number) =>
  elements.flatMap((element) =>
    element.kind === "rule" && element.y < summaryTop ? [element.y + element.thickness] : [],
  );

/** The layout's gap above the VAT summary, and between the closing block and the footer message. */
const SPACING_ABOVE = 16;
const MESSAGE_GAP = 8;

/** What the closing block needs under the last row: its spacing, its own height, and the footer
 *  message with its gap. */
const closingNeeds = (elements: readonly InvoicePageElement[], summary: Text): number => {
  const message = named(elements, FULL_INVOICE_DOCUMENT_FIXTURE.receipt.footerMessage!);
  const block = elements.filter((element) => element !== message && element.y >= summary.y);
  const blockHeight = Math.max(...block.map((element) => area(element).bottom)) - summary.y;
  const messageHeight = area(message).bottom - area(message).top;
  return SPACING_ABOVE + blockHeight + MESSAGE_GAP + messageHeight;
};

const expectNoOverlapOrOverflow = (name: string, pages: readonly InvoicePage[]): void => {
  for (const [number, page] of pages.entries()) {
    for (const element of page.elements) {
      expect(area(element).right, `${name} page ${number + 1}`).toBeLessThanOrEqual(RIGHT + 1e-6);
      expect(area(element).bottom, `${name} page ${number + 1}`).toBeLessThanOrEqual(
        INVOICE_PAGE_HEIGHT - 36 + 1e-6,
      );
    }
    const drawn = texts(page.elements).map((text) => ({ text, at: area(text) }));
    for (const [index, one] of drawn.entries()) {
      for (const other of drawn.slice(index + 1)) {
        const overlaps =
          one.at.left < other.at.right - 0.01 &&
          other.at.left < one.at.right - 0.01 &&
          one.at.top < other.at.bottom - 0.01 &&
          other.at.top < one.at.bottom - 0.01;
        expect(overlaps, `${name}: "${one.text.text}" and "${other.text.text}"`).toBe(false);
      }
    }
  }
};

const setMenuLine = (
  name: string,
  gross: string,
  setMenuRole: "set_menu" | "dish" | undefined,
  extra: Partial<TillSaleLine> = {},
): TillSaleLine => ({
  descriptions: { "es-ES": name },
  quantity: "1",
  gross,
  parentLineNo: null,
  ...(setMenuRole === undefined ? {} : { setMenuRole }),
  ...extra,
});

/** The texts on each table row whose description is `name`, left to right. */
const rowsNamed = (elements: readonly InvoicePageElement[], name: string): string[][] =>
  texts(elements)
    .filter((text) => text.text === name)
    .sort((one, other) => one.y - other.y)
    .map((cell) =>
      texts(elements)
        .filter((text) => text.y === cell.y)
        .sort((one, other) => one.x - other.x)
        .map((text) => text.text),
    );

describe("layoutA4Invoice", () => {
  it("prints each row's VAT-included amount in the last column, adding up to a bold 18 pt TOTAL under a 1.5 pt rule", () => {
    const [page] = layoutA4Invoice(fixture());
    const elements = page!.elements;
    const summaryTop = named(elements, labels.taxRateColumn).y;
    const amounts = texts(elements).filter(
      (text) => text.y < summaryTop && text.text.endsWith("€"),
    );
    const rightmost = Math.max(...amounts.map(textRight));
    const column = amounts
      .filter((text) => Math.abs(textRight(text) - rightmost) < 0.01)
      .sort((one, other) => one.y - other.y)
      .map((text) => text.text);
    expect(column).toEqual([money("12.10"), money("-1.21"), money("8.80")]);

    const total = named(elements, labels.total);
    const amount = texts(elements).find(
      (text) => text.y === total.y && text.text === money("19.69"),
    )!;
    expect([total.weight, total.size, amount.weight, amount.size]).toEqual([
      "bold",
      18,
      "bold",
      18,
    ]);
    expect(textRight(amount)).toBeCloseTo(RIGHT, 6);
    const heavy = elements.filter(
      (element): element is Rule =>
        element.kind === "rule" && element.thickness === 1.5 && element.y > summaryTop,
    );
    expect(heavy).toHaveLength(1);
    expect(heavy[0]!.y).toBeLessThan(total.y);
    expect(heavy[0]!.x).toBeGreaterThanOrEqual(36 + (RIGHT - 36) / 2 - 1e-6);
  });

  it("heads the table with a shaded bold row of the six full-invoice columns", () => {
    const [page] = layoutA4Invoice(fixture());
    const elements = page!.elements;
    const shaded = elements.filter(
      (element): element is Box => element.kind === "box" && element.fill === "heading",
    );
    expect(shaded).toHaveLength(1);
    const headings = texts(elements).filter(
      (text) => text.y >= shaded[0]!.y && text.y < shaded[0]!.y + shaded[0]!.height,
    );
    for (const heading of headings) expect(heading.weight).toBe("bold");
    const words = headings.map((text) => text.text).join(" ");
    for (const column of [
      labels.descriptionColumn,
      labels.quantityColumn,
      labels.unitPriceExVatColumn,
      labels.totalExVatColumn,
      labels.vatColumn,
      labels.totalWithVatColumn,
    ]) {
      for (const word of column.split(" ")) expect(words).toContain(word);
    }
  });

  it("indents a discount row in muted text", () => {
    const [page] = layoutA4Invoice(fixture());
    const dish = named(page!.elements, dishName);
    const discount = texts(page!.elements).find((text) =>
      text.text.startsWith(`${labels.discount} `),
    )!;
    expect(discount.tone).toBe("muted");
    expect(discount.x).toBeGreaterThan(dish.x);
  });

  it("indents a dish's answer in muted text, with no figures on its row", () => {
    const input = fixture();
    input.result.lines[0]!.optionSnapshots = [
      {
        listName: { "es-ES": "Cooking" },
        listCustomerName: null,
        listKitchenName: null,
        labelName: { "es-ES": "Rare" },
        labelCustomerName: null,
        labelKitchenName: null,
      },
    ];
    const [page] = layoutA4Invoice(input);
    const dish = named(page!.elements, dishName);
    const answer = named(page!.elements, "Cooking: Rare");
    expect(answer.tone).toBe("muted");
    expect(answer.x).toBeGreaterThan(dish.x);
    const sameRow = texts(page!.elements).filter((text) => text.y === answer.y);
    expect(sameRow).toEqual([answer]);
  });

  it("gives a simplified invoice the four VAT-included columns", () => {
    const pages = layoutA4Invoice(receiptCases.simplifiedAdvanceTakenOff());
    const words = texts(allElements(pages))
      .map((text) => text.text)
      .join(" ");
    for (const column of [labels.descriptionColumn, labels.quantityColumn, labels.amountColumn]) {
      expect(words).toContain(column);
    }
    expect(words).not.toContain(labels.totalExVatColumn);
    expect(words).toContain(money("120.00"));
  });

  it("puts the guests line under TOTAL and the footer message at the foot of the page", () => {
    const input = fixture();
    input.guests = 2;
    const elements = lastPage(layoutA4Invoice(input));
    const total = named(elements, labels.total);
    const guests = texts(elements).find((text) => text.text.startsWith(`2 ${labels.guests}`))!;
    expect(guests.y).toBeGreaterThan(total.y);
    const message = named(elements, FULL_INVOICE_DOCUMENT_FIXTURE.receipt.footerMessage!);
    expect(message.tone).toBe("muted");
    expect(area(message).bottom).toBeCloseTo(INVOICE_PAGE_HEIGHT - 36, 6);
    input.guests = 1;
    const one = lastPage(layoutA4Invoice(input));
    expect(
      anyText(one, (text) => text.startsWith(`1 ${labels.guest} · ${labels.perPerson} `)),
    ).toBe(true);
  });

  it("opens a paid bill's footer with Pagado and how it was paid", () => {
    const elements = lastPage(layoutA4Invoice(fixture()));
    named(elements, labels.paymentMethodHeading);
    named(
      elements,
      `${labels.paid} · ${labels.cash} ${money("20.00")} · ${labels.change} ${money("0.31")}`,
    );
  });

  it("lists an owed bill's payments and the owed amount in bold, without Pagado", () => {
    const input = fixture();
    input.result.tender = { method: "unpaid" };
    input.result.payments = [
      {
        method: "cash",
        amount: "10.00",
        tip: "0.00",
        tendered: "10.00",
        change: "0.00",
        refunds: [],
      },
    ];
    input.result.owed = "9.69";
    const elements = lastPage(layoutA4Invoice(input));
    named(elements, `${labels.cash} ${money("10.00")}`);
    expect(named(elements, `${labels.owed} ${money("9.69")}`).weight).toBe("bold");
    expect(paidLine(elements)).toBe(false);
  });

  it("tells a deferred bill how to pay, with the IBAN and the bank on one line, and neither Pagado nor owed", () => {
    const elements = lastPage(layoutA4Invoice(deferredInput(ACCOUNT)));
    const instruction = labels.transferInstruction.replace("{number}", "FF/1");
    const words = texts(elements)
      .map((text) => text.text)
      .join(" ");
    expect(words).toContain(`${labels.deferredPayment}.`);
    expect(words.replace(/\s+/g, " ")).toContain(instruction);
    named(elements, `${labels.iban}: ${GROUPED}   ${labels.bankName}: OPENBANK`);
    expect(paidLine(elements)).toBe(false);
    expect(anyText(elements, (text) => text.includes(labels.owed))).toBe(false);
  });

  it("prints the IBAN alone when the account has no bank name", () => {
    const elements = lastPage(layoutA4Invoice(deferredInput({ ...ACCOUNT, bankName: null })));
    named(elements, `${labels.iban}: ${GROUPED}`);
    expect(anyText(elements, (text) => text.includes(labels.bankName))).toBe(false);
  });

  it("prints the deferred-payment words alone when no account is set", () => {
    const elements = lastPage(layoutA4Invoice(deferredInput(null)));
    named(elements, `${labels.deferredPayment}.`);
    expect(anyText(elements, (text) => text.includes(labels.iban))).toBe(false);
  });

  it("gives a full comp no Pagado and no footer", () => {
    const input = receiptCases.fullComp();
    // A fully comped sale records no tender (packages/core/src/settle-sale.ts, before `settledAt`).
    input.result.tender = { method: "unpaid" };
    const elements = lastPage(layoutA4Invoice(input));
    expect(paidLine(elements)).toBe(false);
    expect(anyText(elements, (text) => text === labels.paymentMethodHeading)).toBe(false);
  });

  it("lists card payments with their card, authorization, reference, tip and refunds", () => {
    const input = fixture();
    input.result.payments = [
      {
        method: "card",
        amount: "12.69",
        tip: "1.00",
        reference: "R1",
        card: { scheme: "visa", last4: "4034", entryMode: "contactless", authCode: "123456" },
        refunds: [{ amount: "2.00", tip: "0.00" }],
      },
      { method: "card", amount: "5.00", tip: "0.00", reference: null, refunds: [] },
    ];
    const elements = lastPage(layoutA4Invoice(input));
    const first = [
      `${labels.paid} · Visa ****4034 (${labels.paymentContactless}) ${money("14.69")}`,
      `${labels.paymentAuthorization} 123456`,
      `${labels.reference} R1`,
      `${labels.tip} ${money("1.00")}`,
    ].join(" · ");
    named(elements, first);
    named(elements, `${labels.card} ${money("5.00")}`);
    named(elements, `${labels.refund} ${money("-2.00")}`);
  });

  it("describes a card tender, with what was charged when it carried a tip", () => {
    const input = fixture();
    input.result.tender = {
      method: "card",
      charged: "20.69",
      tip: "1.00",
      reference: "R2",
      card: { scheme: "visa", last4: "4034", entryMode: "chip", authCode: null },
    };
    named(
      lastPage(layoutA4Invoice(input)),
      [
        `${labels.paid} · Visa ****4034 (${labels.paymentChip}) ${money("20.69")}`,
        `${labels.reference} R2`,
        `${labels.tip} ${money("1.00")}`,
        `${labels.charged} ${money("20.69")}`,
      ].join(" · "),
    );
    input.result.tender = { method: "card", charged: "19.69", tip: "0.00", reference: null };
    named(lastPage(layoutA4Invoice(input)), `${labels.paid} · ${labels.card}`);
  });

  it("names a deferred tender as deferred even without the account read", () => {
    const input = fixture();
    input.result.tender = { method: "deferred" };
    const elements = lastPage(layoutA4Invoice(input));
    named(elements, `${labels.deferredPayment}.`);
    expect(paidLine(elements)).toBe(false);
  });

  it("prices a simplified dish each, per unit, and letters its rates in the summary", () => {
    const input = receiptCases.simplifiedAdvanceTakenOff();
    input.result.lines = [
      { descriptions: { "es-ES": "Coffee" }, quantity: "2", gross: "5.00", unitPriceGross: "2.50" },
      {
        descriptions: { "es-ES": "Ham" },
        quantity: "0.5",
        unitName: { "es-ES": "kg" },
        gross: "10.00",
        unitPriceGross: "20.00",
      },
    ];
    delete input.result.billAdjustments;
    const words = texts(allElements(layoutA4Invoice(input))).map((text) => text.text);
    expect(words).toContain(money("2.50"));
    expect(words).toContain(`${money("20.00")}/kg`);
    const lettered = texts(
      allElements(layoutA4Invoice(receiptCases.simplifiedDishDiscountOverExtraAtAnotherRate())),
    ).map((text) => text.text);
    expect(lettered).toContain("A 10%");
    expect(lettered).toContain(`${money("10.00")} A`);
  });

  it("lists a full invoice's set menu and surcharge, leaves a covered dish off or without figures, and still adds up to TOTAL", () => {
    const input = fixture();
    const net = (base: string, tax: string) => ({
      unitPrice: base,
      priceQuantity: "1.000",
      base,
      tax,
      rate: "10",
    });
    input.result.total = "20.50";
    input.result.vatBreakdown = [{ rate: "10", base: "18.64", tax: "1.86" }];
    input.result.lines = [
      setMenuLine("Daily menu", "14.00", "set_menu", { net: net("12.73", "1.27") }),
      setMenuLine("Hake", "0.00", "dish", { net: net("0.00", "0.00") }),
      setMenuLine("Soup", "0.00", "dish", { net: net("0.00", "0.00") }),
      setMenuLine("Bread", "1.50", undefined, { parentLineNo: 3, net: net("1.36", "0.14") }),
      setMenuLine("Sirloin", "5.00", "dish", { net: net("4.55", "0.45") }),
    ];
    const [page] = layoutA4Invoice(input);
    const elements = page!.elements;
    expect(rowsNamed(elements, "Hake")).toEqual([]);
    expect(rowsNamed(elements, "Soup")).toEqual([["Soup", "1", formatVatRate("10", "es-ES")]]);
    expect(rowsNamed(elements, "Sirloin")).toEqual([
      ["Sirloin", "1", money("4.55"), money("4.55"), formatVatRate("10", "es-ES"), money("5.00")],
    ]);
    const summaryTop = named(elements, labels.taxRateColumn).y;
    const amounts = texts(elements).filter(
      (text) => text.y < summaryTop && text.text.endsWith("€"),
    );
    const rightmost = Math.max(...amounts.map(textRight));
    const column = amounts
      .filter((text) => Math.abs(textRight(text) - rightmost) < 0.01)
      .sort((one, other) => one.y - other.y)
      .map((text) => text.text);
    expect(column).toEqual([money("14.00"), money("1.50"), money("5.00")]);
    const total = named(elements, labels.total);
    expect(texts(elements).some((text) => text.y === total.y && text.text === money("20.50"))).toBe(
      true,
    );
  });

  it("takes an unfiled line's share of a bill discount off under it, so the last column still adds up to TOTAL", () => {
    const [page] = layoutA4Invoice(receiptCases.billDiscountOverTwoRatesWithAnUnfiledLine());
    const elements = page!.elements;
    const summaryTop = named(elements, labels.taxRateColumn).y;
    const amounts = texts(elements).filter(
      (text) => text.y < summaryTop && text.text.endsWith("€"),
    );
    const rightmost = Math.max(...amounts.map(textRight));
    const column = amounts
      .filter((text) => Math.abs(textRight(text) - rightmost) < 0.01)
      .sort((one, other) => one.y - other.y)
      .map((text) => text.text);
    expect(column).toEqual([money("30.00"), money("-3.00"), money("2.50"), money("-0.25")]);
    const total = named(elements, labels.total);
    expect(texts(elements).some((text) => text.y === total.y && text.text === money("29.25"))).toBe(
      true,
    );
  });

  it("puts a plus before a simplified page's surcharge and its price each, and leaves a covered dish's amount blank", () => {
    const input = fixture();
    input.result.invoiceType = "F2";
    input.result.total = "44.50";
    input.result.vatBreakdown = [{ rate: "10", base: "40.45", tax: "4.05" }];
    const each = { unitPriceGross: "5.00" };
    input.result.lines = [
      setMenuLine("Daily menu", "14.00", "set_menu", { unitPriceGross: "14.00" }),
      setMenuLine("Daily menu", "14.00", "set_menu", { unitPriceGross: "14.00" }),
      setMenuLine("Hake", "0.00", "dish"),
      setMenuLine("Soup", "0.00", "dish"),
      setMenuLine("Bread", "1.50", undefined, { parentLineNo: 4 }),
      setMenuLine("Sirloin", "5.00", "dish", each),
      setMenuLine("Sirloin", "5.00", "dish", each),
      setMenuLine("Sirloin", "5.00", undefined, each),
    ];
    const elements = allElements(layoutA4Invoice(input));
    expect(rowsNamed(elements, "Hake")).toEqual([]);
    expect(rowsNamed(elements, "Soup")).toEqual([["Soup", "1"]]);
    expect(rowsNamed(elements, "Sirloin")).toEqual([
      ["Sirloin", "2", `+${money("5.00")}`, `+${money("10.00")}`],
      ["Sirloin", "1", money("5.00")],
    ]);
  });

  it("boxes a practice invoice's warning both at the top of page 1 and above the footer on the last page", () => {
    const input = longInvoice(60);
    input.simulated = true;
    input.simulatedCardPayment = true;
    const pages = layoutA4Invoice(input);
    expect(pages.length).toBeGreaterThan(1);
    const top = texts(pages[0]!.elements).filter((text) => text.text === labels.practice);
    expect(top).toHaveLength(1);
    const qr = qrOf(pages[0]!.elements);
    expect(top[0]!.y).toBeLessThan(qr.y);
    const last = lastPage(pages);
    const bottom = named(last, labels.practice);
    named(last, labels.noRealCharge);
    expect(bottom.y).toBeGreaterThan(named(last, labels.paymentMethodHeading).y);
    const message = named(last, FULL_INVOICE_DOCUMENT_FIXTURE.receipt.footerMessage!);
    expect(area(bottom).bottom).toBeLessThan(message.y);
    const frame = last.filter(
      (element): element is Rule =>
        element.kind === "rule" &&
        element.y <= bottom.y &&
        element.y + element.thickness > bottom.y,
    );
    expect(frame.length).toBe(2);
  });

  it("keeps a practice invoice's foot notice on the page of TOTAL on either side of the page break", () => {
    const practice = (count: number): InvoicePage[] => {
      const input = longInvoice(count);
      input.simulated = true;
      input.simulatedCardPayment = true;
      return layoutA4Invoice(input);
    };
    const lastPageOf = (pages: InvoicePage[], value: string): number =>
      pages.reduce(
        (found, page, index) =>
          texts(page.elements).some((text) => text.text === value) ? index : found,
        -1,
      );
    const rowsOn = (page: InvoicePage): boolean =>
      page.elements.some((element) => element.kind === "box" && element.fill === "heading");
    let count = 1;
    while (count < 200 && practice(count).length === 1) count++;
    const moved = practice(count);
    expect(moved.map(rowsOn)).toEqual([true, false]);
    for (const [shape, pages, page] of [
      ["one row before the break", practice(count - 1), 0],
      ["the first row that moves the closing block", moved, 1],
      ["one row after the break", practice(count + 1), 1],
    ] as const) {
      expect(pages, shape).toHaveLength(page + 1);
      expect(lastPageOf(pages, labels.total), shape).toBe(page);
      expect(lastPageOf(pages, labels.paymentMethodHeading), shape).toBe(page);
      expect(lastPageOf(pages, labels.noRealCharge), shape).toBe(page);
      const elements = pages[page]!.elements;
      const notices = texts(elements).filter((text) => text.text === labels.practice);
      expect(notices, shape).toHaveLength(page === 0 ? 2 : 1);
      const foot = notices.at(-1)!;
      expect(foot.y, shape).toBeGreaterThan(named(elements, labels.total).y);
      expect(area(foot).bottom, shape).toBeLessThan(
        named(elements, FULL_INVOICE_DOCUMENT_FIXTURE.receipt.footerMessage!).y,
      );
      expectNoOverlapOrOverflow(shape, pages);
    }
  });

  it("ends a test page with its notice and the printer's name", () => {
    const input = fixture();
    input.testPage = { printer: "Office printer" };
    const elements = lastPage(layoutA4Invoice(input));
    const notices = texts(elements).filter((text) => text.text === labels.paymentNotice);
    expect(notices).toHaveLength(2);
    const printer = named(elements, "Office printer");
    expect(printer.y).toBeGreaterThan(notices[1]!.y);
    expect(printer.y).toBeGreaterThan(named(elements, labels.total).y);
  });

  it("heads the VAT summary with its own full words", () => {
    const words = texts(lastPage(layoutA4Invoice(fixture()))).map((text) => text.text);
    for (const heading of [
      labels.taxRateColumn,
      labels.vatSummaryBaseColumn,
      labels.vatSummaryAmountColumn,
      labels.taxTotalColumn,
    ]) {
      expect(words.join(" ")).toContain(heading);
    }
  });

  it("leaves the footer out when there is no payment of its own and nothing refunded", () => {
    const input = fixture();
    input.result.tender = { method: "unpaid" };
    const elements = lastPage(layoutA4Invoice(input));
    expect(anyText(elements, (text) => text === labels.paymentMethodHeading)).toBe(false);
    expect(paidLine(elements)).toBe(false);
  });

  it("moves the summary, TOTAL and footer to a page of their own when they do not fit under the last row", () => {
    let pages: InvoicePage[] = [];
    let count = 1;
    for (; count < 200; count++) {
      pages = layoutA4Invoice(longInvoice(count));
      const shadedOnLast = lastPage(pages).some(
        (element) => element.kind === "box" && element.fill === "heading",
      );
      if (pages.length === 3 && !shadedOnLast) break;
    }
    expect(pages).toHaveLength(3);
    const [first, second, third] = pages.map((page) => page.elements);

    const summary = named(third!, labels.taxRateColumn);
    named(third!, labels.total);
    named(third!, labels.paymentMethodHeading);
    const lastRow = Math.max(...rowBottoms(second!, INVOICE_PAGE_HEIGHT));
    const room = INVOICE_PAGE_HEIGHT - 36 - lastRow;
    expect(room).toBeLessThan(closingNeeds(third!, summary));

    // One line fewer: the block fits under the last row, so it stays on page 2.
    const fewer = layoutA4Invoice(longInvoice(count - 1));
    expect(fewer).toHaveLength(2);
    const stays = named(fewer[1]!.elements, labels.taxRateColumn);
    const above = Math.max(...rowBottoms(fewer[1]!.elements, stays.y));
    expect(stays.y - above).toBeCloseTo(SPACING_ABOVE, 6);
    expect(INVOICE_PAGE_HEIGHT - 36 - above).toBeGreaterThanOrEqual(
      closingNeeds(fewer[1]!.elements, stays),
    );

    for (const page of [first!, second!]) {
      const shaded = page.find(
        (element): element is Box => element.kind === "box" && element.fill === "heading",
      )!;
      expect(shaded).toBeDefined();
      const rowsAbove = texts(page).filter((text) => text.y < shaded.y && text.text.endsWith("€"));
      expect(rowsAbove).toEqual([]);
    }
    expect(pages.flatMap((page) => page.elements).filter((e) => e.kind === "qr")).toHaveLength(1);
    expect(first!.some((element) => element.kind === "qr")).toBe(true);
    for (const [index, page] of [second!, third!].entries()) {
      const opening = [...texts(page)].sort((one, other) => one.y - other.y)[0]!;
      expect(opening.text).toBe(
        labels.continuedPage
          .replace("{title}", `${labels.invoiceHeading} FF/1`)
          .replace("{page}", String(index + 2))
          .replace("{pages}", "3"),
      );
      expect(opening.tone).toBe("muted");
    }
    expectNoOverlapOrOverflow("three pages", pages);
  });

  it("keeps every element inside the right margin and no text over another, on every page", () => {
    const owed = fixture();
    owed.result.owed = "1.00";
    owed.guests = 3;
    const inputs: [string, ReceiptDocumentInput][] = [
      ["fixture", fixture()],
      ["owed", owed],
      ["deferred", deferredInput(ACCOUNT)],
      ["long", longInvoice(60)],
      ...receiptCaseInputs(),
    ];
    for (const [name, input] of inputs) expectNoOverlapOrOverflow(name, layoutA4Invoice(input));
  });

  it("renders to a PDF whose text carries the table, TOTAL and Pagado", async () => {
    const bytes = await renderInvoicePdf(fixture());
    const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
    const pdf = await loading.promise;
    try {
      expect(pdf.numPages).toBe(1);
      const content = await (await pdf.getPage(1)).getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ")
        .replace(/\s+/g, " ");
      for (const value of [
        money("12.10"),
        money("-1.21"),
        money("8.80"),
        money("19.69"),
        labels.total,
        `${labels.paid} · ${labels.cash}`,
      ]) {
        expect(text).toContain(value.replace(/\s+/g, " "));
      }
    } finally {
      await loading.destroy();
    }
  });
});

/** Each page of the rendered PDF: its text, its glyph runs, and its pixels at two per point. */
async function renderedPdf(input: ReceiptDocumentInput) {
  const bytes = await renderInvoicePdf(input);
  const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ")
        .replace(/\s+/g, " ");
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport })
        .promise;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      pages.push({
        text,
        viewport,
        content,
        pixels,
        qr: jsQR(pixels.data, canvas.width, canvas.height),
      });
    }
    return { bytes, pages, metadata: await pdf.getMetadata() };
  } finally {
    await loading.destroy();
  }
}

const MM = 72 / 25.4;
const QR_CODES = [
  {
    name: "sample sale",
    input: () => sampleDocument(FULL_INVOICE_DOCUMENT_FIXTURE.result.qrText!, "es-ES"),
    modules: 33,
  },
  { name: "AEAT validation URL", input: fixture, modules: 45 },
];

/** A grey raster page as the RGBA image jsQR reads. */
const rgbaOf = (page: { width: number; height: number; pixels: Buffer }) => {
  const rgba = new Uint8ClampedArray(page.width * page.height * 4);
  for (let pixel = 0; pixel < page.pixels.length; pixel++)
    rgba.set([page.pixels[pixel]!, page.pixels[pixel]!, page.pixels[pixel]!, 255], pixel * 4);
  return rgba;
};

describe("layoutA4Invoice, printed", () => {
  it("renders A4 pages dated at the invoice's issue, the same bytes every time, with both parties", async () => {
    const { bytes, pages, metadata } = await renderedPdf(fixture());
    const info = metadata.info as { CreationDate: string; ModDate: string };
    expect([info.CreationDate, info.ModDate]).toEqual(["D:20260817223400Z", "D:20260817223400Z"]);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.viewport.width / 2).toBeCloseTo(595.28, 2);
    expect(pages[0]!.viewport.height / 2).toBeCloseTo(841.89, 2);
    const recipient = FULL_INVOICE_DOCUMENT_FIXTURE.result.recipient!;
    for (const value of [issuer!.venueName, "B12345678", recipient.legalName, recipient.taxId])
      expect(pages[0]!.text).toContain(value);
    expect(pages[0]!.text).not.toContain(FULL_INVOICE_DOCUMENT_FIXTURE.venueAddress![0]);
    expect((await renderedPdf(fixture())).bytes).toEqual(bytes);
  });

  it.each(QR_CODES)(
    "draws the $name's QR on page 1 as a 35 mm square at level M that decodes to the filed text",
    async ({ input, modules }) => {
      const qrElement = qrOf(layoutA4Invoice(input())[0]!.elements);
      expect(qrElement.modules).toHaveLength(modules);
      expect(qrElement.modules.length * qrElement.moduleSize).toBeCloseTo(QR_SIZE, 6);

      const { pages } = await renderedPdf(input());
      const page = pages[0]!;
      const qr = page.qr!;
      expect(qr.data).toBe(input().result.qr);
      expect(qr.version * 4 + 17).toBe(modules);
      const dark = (row: number, col: number): boolean => {
        const x = Math.floor(
          qr.location.topLeftCorner.x +
            ((col + 0.5) * (qr.location.topRightCorner.x - qr.location.topLeftCorner.x)) / modules,
        );
        const y = Math.floor(
          qr.location.topLeftCorner.y +
            ((row + 0.5) * (qr.location.bottomLeftCorner.y - qr.location.topLeftCorner.y)) /
              modules,
        );
        return page.pixels.data[(y * page.pixels.width + x) * 4]! < 128;
      };
      let format = 0;
      for (let bit = 0; bit < 15; bit++) {
        const row = bit < 6 ? bit : bit < 8 ? bit + 1 : modules - 15 + bit;
        if (dark(row, 8)) format |= 1 << bit;
      }
      expect((format ^ 0b101010000010010) >> 13, "drawn QR correction level M").toBe(0);

      const pitch = (qr.location.bottomLeftCorner.y - qr.location.topLeftCorner.y) / modules;
      const row = Math.floor(qr.location.topLeftCorner.y + 3.5 * pitch);
      // Its quiet zone is clear, so dark dots within four modules of its corners are the QR's own.
      const across: number[] = [];
      const from = Math.ceil(qr.location.topLeftCorner.x - 4 * pitch);
      const to = Math.floor(qr.location.topRightCorner.x + 4 * pitch);
      for (let x = from; x < to; x++)
        if (page.pixels.data[(row * page.pixels.width + x) * 4]! < 128) across.push(x);
      const millimetres = (across.at(-1)! - across[0]! + 1) / 2 / MM;
      expect(Math.abs(millimetres - 35), `${millimetres} mm`).toBeLessThanOrEqual(35 / modules / 2);
      const legend = page.content.items.find(
        (item) => "str" in item && item.str === FULL_INVOICE_DOCUMENT_FIXTURE.result.qrText!.legend,
      );
      expect(legend && "height" in legend ? legend.height : undefined).toBeCloseTo(9, 1);
    },
  );

  it("moves a row that does not fit above the page foot onto the next page whole", () => {
    const words = "Mineral water from a spring high in the northern mountains, bottled at source";
    const name = `${words} ${words} ${words}`;
    let moved = 0;
    for (let count = 20; count <= 60; count++) {
      const input = longInvoice(count);
      input.result.lines.at(-1)!.descriptions = { "es-ES": name, "en-GB": name };
      const pages = layoutA4Invoice(input);
      const holding = pages.flatMap((page, number) =>
        texts(page.elements)
          .filter((text) => text.text.length > 1 && name.includes(text.text))
          .map((text) => ({ number, text })),
      );
      expect(holding.map(({ text }) => text.text).join(" "), `${count} items`).toBe(name);
      expect(new Set(holding.map(({ number }) => number)).size, `${count} items`).toBe(1);
      for (const { text } of holding)
        expect(text.y + text.size, `${count} items`).toBeLessThanOrEqual(INVOICE_PAGE_HEIGHT - 36);
      const { number, text: first } = holding[0]!;
      const heading = pages[number]!.elements.find(
        (element): element is Box => element.kind === "box" && element.fill === "heading",
      );
      const rowsAbove = texts(pages[number]!.elements).filter(
        (text) => heading !== undefined && text.y > heading.y + heading.height && text.y < first.y,
      );
      if (number > 0 && rowsAbove.length === 0) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it("wraps long unbroken item names onto later pages inside the margins, drawing the QR on page 1 only", async () => {
    const marker = "ABCDEFGHIJ".repeat(25);
    const input = fixture();
    input.result.lines = Array.from({ length: 35 }, (_, index) => ({
      ...FULL_INVOICE_DOCUMENT_FIXTURE.result.lines[0]!,
      descriptions: { "es-ES": `Dish ${index} ${marker}` },
    }));
    const { pages } = await renderedPdf(input);
    expect(pages.length).toBeGreaterThan(1);
    const text = pages.map((page) => page.text).join(" ");
    expect(text).toContain("Dish 34");
    expect(text).toContain(labels.total);
    expect(text.replace(/\s/g, "").split(marker)).toHaveLength(36);
    expect(pages.filter((page) => page.qr !== null)).toHaveLength(1);
    expect(pages[0]!.qr?.data).toBe(FULL_INVOICE_DOCUMENT_FIXTURE.result.qr);
    for (const page of pages) {
      for (const item of page.content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        expect(item.transform[4]).toBeGreaterThanOrEqual(35);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(RIGHT + 1);
        expect(item.transform[5]).toBeGreaterThan(35);
        expect(item.transform[5] + item.height).toBeLessThan(INVOICE_PAGE_HEIGHT - 35);
      }
    }
  });

  it("keeps an unbroken customer name whole and treats a whitespace-only subtitle as none", async () => {
    const name = "ABCDEFGHIJ".repeat(90);
    const input = fixture();
    input.receipt.headerSubtitle = " ";
    input.result.recipient!.legalName = name;
    const { pages, bytes } = await renderedPdf(input);
    expect(
      pages
        .map((page) => page.text)
        .join("")
        .replace(/\s/g, ""),
    ).toContain(name);
    for (const page of pages)
      for (const item of page.content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(RIGHT + 1);
      }
    input.receipt.headerSubtitle = "";
    expect((await renderedPdf(input)).bytes).toEqual(bytes);
  });

  it("wraps the contact line at its separator, keeping the phone and the email whole", () => {
    const email =
      "reservations.private.events.and.bookings@a-long-restaurant-group-name.example.test";
    for (const phone of ["910000000", "932 000 111"]) {
      const input = fixture();
      input.receipt.phone = phone;
      input.receipt.email = email;
      const shown = texts(header(input).elements).map((text) => text.text);
      const at = shown.indexOf(`${labels.phone} ${phone}`);
      expect(at, phone).toBeGreaterThan(0);
      expect(shown[at + 1]).toBe(email);
    }
  });

  it("word-wraps only an address too long for a line by itself, keeping a two-word country whole and never leaving a separator at a line's end", () => {
    const words =
      "Long Avenue of the original customer number 123 by the railway station third floor ";
    const country = new Intl.DisplayNames(["es-ES"], { type: "region" }).of("GB")!;
    expect(country).toContain(" ");
    let countryAlone = 0;
    for (let length = 20; length <= 220; length++) {
      const address = words.repeat(3).slice(0, length).trim();
      const input = fixture();
      input.result.recipient!.address = address;
      input.result.recipient!.countryCode = "GB";
      const { elements } = header(input);
      const panel = elements.find(
        (element): element is Box => element.kind === "box" && element.fill === "panel",
      )!;
      const identifier = texts(elements).find((text) =>
        text.text.endsWith(`: ${input.result.recipient!.taxId}`),
      )!;
      const lines = texts(elements)
        .filter((text) => text.y > identifier.y && text.y < panel.y + panel.height)
        .map((text) => text.text);
      const shape = `${length}: ${JSON.stringify(lines)}`;
      expect(lines.join(" ").replace(" · ", " "), shape).toBe(`${address} ${country}`);
      expect(
        lines.filter((line) => line.startsWith("·") || line.endsWith("·")),
        shape,
      ).toEqual([]);
      expect(
        lines.some((line) => line === country || line.endsWith(` · ${country}`)),
        shape,
      ).toBe(true);
      if (lines.at(-1) === country) countryAlone++;
    }
    expect(countryAlone, "lengths that put the country on a line of its own").toBeGreaterThan(0);
  });

  it.each([false, true])(
    "prints the no-real-charge line on a practice invoice only when its card payment was simulated (%s)",
    (simulatedCardPayment) => {
      const input = fixture();
      input.simulated = true;
      input.simulatedCardPayment = simulatedCardPayment;
      const shown = texts(allElements(layoutA4Invoice(input))).map((text) => text.text);
      expect(shown).toContain(labels.practice);
      expect(shown.includes(labels.noRealCharge)).toBe(simulatedCardPayment);
    },
  );

  it("prints no practice notice on a real invoice", () => {
    const shown = texts(allElements(layoutA4Invoice(fixture()))).map((text) => text.text);
    expect(shown).not.toContain(labels.practice);
    expect(shown).not.toContain(labels.noRealCharge);
  });

  it("prints neither the QR's caption nor its legend when the record has no QR", () => {
    const input = fixture();
    input.result.qr = "";
    const { caption, legend } = FULL_INVOICE_DOCUMENT_FIXTURE.result.qrText!;
    expect([caption, legend].every((word) => word !== undefined)).toBe(true);
    const elements = allElements(layoutA4Invoice(input));
    expect(elements.some((element) => element.kind === "qr")).toBe(false);
    const shown = texts(elements).map((text) => text.text);
    expect(shown).not.toContain(caption);
    expect(shown).not.toContain(legend);
  });

  it("sums each VAT rate's base and tax into its own row of the summary", () => {
    const elements = layoutA4Invoice(fixture())[0]!.elements;
    const heading = named(elements, labels.taxRateColumn);
    const total = named(elements, labels.total);
    const rows = new Map<number, Text[]>();
    for (const text of texts(elements))
      if (text.tone === "ink" && text.y > heading.y && text.y < total.y)
        rows.set(text.y, [...(rows.get(text.y) ?? []), text]);
    const shown = [...rows.entries()]
      .sort(([one], [other]) => one - other)
      .map(([, cells]) => cells.sort((one, other) => one.x - other.x).map((text) => text.text));
    expect(shown).toEqual([
      [formatVatRate("21", "es-ES"), money("9.00"), money("1.89"), money("10.89")],
      [formatVatRate("10", "es-ES"), money("8.00"), money("0.80"), money("8.80")],
    ]);
  });

  it("prints the guests and the amount each pays under TOTAL", () => {
    const input = fixture();
    input.guests = 4;
    const shown = texts(lastPage(layoutA4Invoice(input))).map((text) => text.text);
    expect(shown).toContain(`4 ${labels.guests} · ${labels.perPerson} ${money("4.92")}`);
  });

  it("prints the filed domicile and never the venue's current address, and no logo without a picture", () => {
    for (const domicile of ["Filed fiscal street", undefined]) {
      const input = fixture();
      input.venueAddress = ["Optional current street"];
      input.result.issuer!.domicile = domicile;
      const pages = layoutA4Invoice(input);
      const shown = texts(allElements(pages)).map((text) => text.text);
      expect(shown.some((text) => text.includes("Optional current street"))).toBe(false);
      expect(shown.includes("Filed fiscal street"), String(domicile)).toBe(domicile !== undefined);
      expect(allElements(pages).filter((element) => element.kind === "logo")).toEqual([]);
    }
  });

  it("draws the table's shaded bold heading at the top of every page its rows continue onto", () => {
    const headingBox = (elements: readonly InvoicePageElement[]): Box =>
      elements.find(
        (element): element is Box => element.kind === "box" && element.fill === "heading",
      )!;
    /** The heading's words, each with its place across the page and within the shaded row. */
    const headingCells = (elements: readonly InvoicePageElement[]) => {
      const box = headingBox(elements);
      return texts(elements)
        .filter((text) => text.y > box.y && text.y < box.y + box.height)
        .map((text) => [text.text, text.weight, text.x.toFixed(6), (text.y - box.y).toFixed(6)]);
    };
    const pages = layoutA4Invoice(longInvoice(80));
    expect(pages.length).toBeGreaterThan(2);
    let continued = 0;
    for (const [number, page] of pages.entries()) {
      const rows = page.elements.filter(
        (element): element is Rule => element.kind === "rule" && element.thickness === 0.5,
      );
      const headings = page.elements.filter(
        (element): element is Box => element.kind === "box" && element.fill === "heading",
      );
      for (const shaded of headings)
        expect(
          rows.some((rule) => rule.y > shaded.y),
          `page ${number + 1}: a heading with no row under it`,
        ).toBe(true);
      if (rows.length === 0) continue;
      if (number > 0) continued++;
      const heading = headingBox(page.elements);
      expect(heading, `page ${number + 1}`).toBeDefined();
      expect(Math.min(...rows.map((rule) => rule.y))).toBeGreaterThan(heading.y);
      expect(headingCells(page.elements), `page ${number + 1}`).toEqual(
        headingCells(pages[0]!.elements),
      );
    }
    expect(continued).toBeGreaterThan(0);
    const first = headingCells(pages[0]!.elements);
    expect(first.length).toBeGreaterThanOrEqual(6);
    expect(first.every(([, weight]) => weight === "bold")).toBe(true);
  });

  it("keeps the VAT summary whole on the page of TOTAL, wherever the items end", () => {
    const simplified = (count: number, headerFacts: number): ReceiptDocumentInput => {
      const at21 = Math.ceil(count / 2);
      const at10 = count - at21;
      const input = fixture();
      const { headerSubtitle: subtitle, phone, email, ...rest } = input.receipt;
      input.receipt = {
        ...rest,
        ...Object.fromEntries(
          Object.entries({ headerSubtitle: subtitle, phone, email }).slice(0, headerFacts),
        ),
      };
      input.result.invoiceType = "F2";
      input.result.recipient = undefined;
      input.result.total = (at21 * 1.21 + at10 * 1.1).toFixed(2);
      input.result.vatBreakdown = [
        { rate: "21", base: `${at21}.00`, tax: (at21 * 0.21).toFixed(2) },
        { rate: "10", base: `${at10}.00`, tax: (at10 * 0.1).toFixed(2) },
      ];
      input.result.lines = Array.from({ length: count }, (_, at) => ({
        descriptions: { "es-ES": `Item ${at + 1}` },
        quantity: "1",
        gross: at < at21 ? "1.21" : "1.10",
        vatRate: at < at21 ? "21.00" : "10.00",
      }));
      return input;
    };
    const pageOf = (pages: InvoicePage[], value: string): number =>
      pages.findIndex((page) => texts(page.elements).some((text) => text.text === value));
    let movedWhole = 0;
    for (let count = 2; count <= 45; count++)
      for (let headerFacts = 0; headerFacts <= 3; headerFacts++) {
        const pages = layoutA4Invoice(simplified(count, headerFacts));
        const at21 = Math.ceil(count / 2);
        const heading = pageOf(pages, labels.taxRateColumn);
        const shape = `${count} items, ${headerFacts} header lines`;
        expect(heading, shape).toBeGreaterThanOrEqual(0);
        expect(
          [
            pageOf(pages, money(`${at21}.00`)),
            pageOf(pages, money(`${count - at21}.00`)),
            pageOf(pages, labels.total),
          ],
          shape,
        ).toEqual([heading, heading, heading]);
        if (heading > pageOf(pages, `Item ${count}`)) movedWhole++;
      }
    expect(movedWhole, "inputs whose summary started a page of its own").toBeGreaterThan(0);
  });

  it.each(["es-ES", "ca-ES", "gl-ES", "eu-ES", "en-GB"])(
    "prints a %s invoice in its own receipt words and country name",
    async (locale) => {
      const input = fixture();
      input.invoiceLocale = locale;
      input.result.recipient!.address = "2 Main Street, 28013 Madrid, Madrid";
      const own = receiptLabelsFor(locale);
      const text = (await renderedPdf(input)).pages.map((page) => page.text).join(" ");
      for (const value of [
        `${own.invoiceHeading} FF/1`,
        own.total,
        own.paymentMethodHeading,
        "2 Main Street, 28013 Madrid, Madrid",
        getCountryPack("ES")!.countryNames![locale]!,
      ])
        expect(text).toContain(value);
      const other = locale === "en-GB" ? "es-ES" : "en-GB";
      expect(text).not.toContain(getCountryPack("ES")!.countryNames![other]!);
    },
  );

  it("prints a French snapshot country in Catalan, leaving the input as it was", async () => {
    const input = fixture();
    input.invoiceLocale = "ca-ES";
    input.result.recipient = {
      taxId: "Passport 123",
      legalName: "Alex Guest",
      address: "2 Main Street, Paris",
      countryCode: "FR",
    };
    const before = structuredClone(input);
    const text = (await renderedPdf(input)).pages.map((page) => page.text).join(" ");
    expect(text).toContain("2 Main Street, Paris");
    expect(text).toContain(new Intl.DisplayNames(["ca-ES"], { type: "region" }).of("FR")!);
    expect(text).not.toContain(new Intl.DisplayNames(["en-GB"], { type: "region" }).of("FR")!);
    expect(input).toEqual(before);
  });

  it.each([
    ["en-GB", "en"],
    ["es-ES", "es"],
  ] as const)("labels a foreign identity document by its kind in %s", async (locale, language) => {
    const words = RECIPIENT_IDENTIFIER_LABELS[language];
    for (const kind of [
      "vat-number",
      "passport",
      "residence-country-id",
      "residence-certificate",
      "other-document",
    ] as const) {
      const input = fixture();
      input.invoiceLocale = locale;
      input.result.recipient = {
        taxId: "Ab-09/xy",
        identifierType: kind,
        identifierCountryCode: "FR",
        legalName: "Guest",
        countryCode: "ES",
        address: "2 Main Street, Madrid",
      };
      const { pages } = await renderedPdf(input);
      expect(pages[0]!.text, kind).toContain(`${words[kind]}: Ab-09/xy`);
      expect(pages[0]!.text, kind).not.toContain(`${receiptLabelsFor(locale).nif}: Ab-09/xy`);
    }
  });

  it("draws a stored logo where the layout puts it, its proportions kept", async () => {
    const input = fixture();
    input.logo = { widthDots: 80, heightDots: 40, bits: new Uint8Array(400).fill(255) };
    const logo = layoutA4Invoice(input)[0]!.elements.find((element) => element.kind === "logo")!;
    const { pages } = await renderedPdf(input);
    const page = pages[0]!;
    const dark: { x: number; y: number }[] = [];
    for (let y = Math.floor(logo.y * 2) - 4; y < Math.ceil((logo.y + logo.height) * 2) + 4; y++)
      for (let x = Math.floor(logo.x * 2) - 4; x < Math.ceil((logo.x + logo.width) * 2) + 4; x++)
        if (page.pixels.data[(y * page.pixels.width + x) * 4]! < 128) dark.push({ x, y });
    const xs = dark.map((point) => point.x);
    const ys = dark.map((point) => point.y);
    expect(dark.length).toBeGreaterThan(0.9 * logo.width * logo.height * 4);
    expect((Math.min(...xs) + Math.max(...xs) + 1) / 4).toBeCloseTo(logo.x + logo.width / 2, 0);
    expect(
      (Math.max(...xs) - Math.min(...xs) + 1) / (Math.max(...ys) - Math.min(...ys) + 1),
    ).toBeCloseTo(2, 1);
  });

  it("forgets every remembered text width once the limit is reached", async () => {
    vi.resetModules();
    const { invoiceFont: font } = await import("./invoice-font.js");
    const page = await import("./invoice-page.js");
    const measure = vi.spyOn(font, "layout");
    try {
      const probe = "Width bound probe text";
      const measured = page.invoiceTextWidth(probe, 10);
      page.invoiceTextWidth(probe, 10);
      expect(measure.mock.calls.filter(([text]) => text === probe)).toHaveLength(1);
      for (let index = 0; index < page.INVOICE_TEXT_WIDTH_MEMO_LIMIT; index++)
        page.invoiceTextWidth(`bound filler ${index}`, 10);
      expect(page.invoiceTextWidth(probe, 20)).toBeCloseTo(measured * 2);
      expect(measure.mock.calls.filter(([text]) => text === probe)).toHaveLength(2);
    } finally {
      measure.mockRestore();
      vi.resetModules();
    }
  });

  it("lays out the same invoice a second time without measuring any text again", async () => {
    vi.resetModules();
    const { invoiceFont: font } = await import("./invoice-font.js");
    const fresh = await import("./invoice-layout.js");
    const measure = vi.spyOn(font, "layout");
    try {
      const first = fresh.layoutA4Invoice(fixture());
      expect(measure.mock.calls.length).toBeGreaterThan(0);
      measure.mockClear();
      const second = fresh.layoutA4Invoice(fixture());
      expect(measure).not.toHaveBeenCalled();
      expect(second).toEqual(first);
    } finally {
      measure.mockRestore();
      vi.resetModules();
    }
  });
});

describe("layoutA4Invoice, on the office printer's raster", () => {
  it.each([
    { resolution: 300 as const, width: 2480, height: 3508, qrDots: 413 },
    { resolution: 600 as const, width: 4960, height: 7016, qrDots: 827 },
  ])(
    "draws one grey A4 page with the filed QR decoding at 35 mm at $resolution dpi",
    async ({ resolution, width, height, qrDots }) => {
      const pages = await renderInvoiceRaster(fixture(), resolution);
      expect(pages).toHaveLength(1);
      const page = pages[0]!;
      expect([page.width, page.height, page.resolution]).toEqual([width, height, resolution]);
      expect(page.pixels).toHaveLength(width * height);
      let ink = 0;
      for (const value of page.pixels) if (value < 128) ink++;
      expect(ink / (width * height)).toBeGreaterThan(0.005);
      expect(ink / (width * height)).toBeLessThan(0.15);
      const qr = jsQR(rgbaOf(page), width, height)!;
      expect(qr?.data).toBe(FULL_INVOICE_DOCUMENT_FIXTURE.result.qr);
      const modules = qr.version * 4 + 17;
      const pitch = (qr.location.topRightCorner.x - qr.location.topLeftCorner.x) / modules;
      expect(Math.round(pitch * modules)).toBeCloseTo(qrDots, -1);
    },
  );

  it.each(QR_CODES)(
    "measures the $name's QR 35 mm across at 300 dpi",
    async ({ input, modules }) => {
      const [page] = await renderInvoiceRaster(input(), 300);
      const qr = jsQR(rgbaOf(page!), page!.width, page!.height)!;
      expect(qr.data).toBe(input().result.qr);
      expect(qr.version * 4 + 17).toBe(modules);
      const pitch = (qr.location.bottomLeftCorner.y - qr.location.topLeftCorner.y) / modules;
      const row = Math.floor(qr.location.topLeftCorner.y + 3.5 * pitch);
      const dark: number[] = [];
      const from = Math.ceil(qr.location.topLeftCorner.x - 4 * pitch);
      const to = Math.floor(qr.location.topRightCorner.x + 4 * pitch);
      for (let x = from; x < to; x++) if (page!.pixels[row * page!.width + x]! < 128) dark.push(x);
      const millimetres = ((dark.at(-1)! - dark[0]! + 1) / 300) * 25.4;
      expect(Math.abs(millimetres - 35), `${millimetres} mm`).toBeLessThanOrEqual(35 / modules / 2);
    },
  );

  it("places text where the PDF does, including the wrapped domicile", async () => {
    const [raster] = await renderInvoiceRaster(fixture(), 300);
    const qr = qrOf(layoutA4Invoice(fixture())[0]!.elements);
    const dots = 2480 / 595.28;
    const qrBottom = Math.ceil((qr.y + qr.modules.length * qr.moduleSize) * dots) + 2;
    const qrRight = Math.ceil((qr.x + qr.modules.length * qr.moduleSize) * dots) + 2;
    const loading = getDocument({
      data: Uint8Array.from(await renderInvoicePdf(fixture())),
      useSystemFonts: false,
    });
    const pdf = await loading.promise;
    try {
      const page = await pdf.getPage(1);
      const canvas = createCanvas(2480, 3508);
      const context = canvas.getContext("2d");
      await page.render({
        canvas: canvas as never,
        canvasContext: context as never,
        viewport: page.getViewport({ scale: dots }),
      }).promise;
      const reference = context.getImageData(0, 0, 2480, 3508).data;
      let ink = 0;
      let matched = 0;
      // The QR's modules are compared by the decoding tests; antialiasing may shift ink two dots.
      for (let y = 2; y < 3506; y++) {
        for (let x = 2; x < 2478; x++) {
          if (y < qrBottom && x < qrRight) continue;
          if (reference[(y * 2480 + x) * 4]! >= 128) continue;
          ink++;
          let present = false;
          for (let dy = -2; dy <= 2 && !present; dy++)
            for (let dx = -2; dx <= 2; dx++)
              if (raster!.pixels[(y + dy) * 2480 + x + dx]! < 128) {
                present = true;
                break;
              }
          if (present) matched++;
        }
      }
      expect(ink).toBeGreaterThan(20000);
      expect(matched / ink).toBeGreaterThan(0.99);
    } finally {
      await loading.destroy();
    }
  });

  it.each([300, 600] as const)(
    "draws a stored logo solid where the layout puts it at %s dpi",
    async (resolution) => {
      const input = fixture();
      input.logo = { widthDots: 80, heightDots: 40, bits: new Uint8Array(400).fill(255) };
      const logo = layoutA4Invoice(input)[0]!.elements.find((element) => element.kind === "logo")!;
      const [page] = await renderInvoiceRaster(input, resolution);
      const dots = resolution / 72;
      const [left, top] = [Math.ceil(logo.x * dots) + 2, Math.ceil(logo.y * dots) + 2];
      const [right, bottom] = [
        Math.floor((logo.x + logo.width) * dots) - 2,
        Math.floor((logo.y + logo.height) * dots) - 2,
      ];
      let ink = 0;
      for (let y = top; y < bottom; y++)
        for (let x = left; x < right; x++) if (page!.pixels[y * page!.width + x]! < 128) ink++;
      expect(ink).toBe((right - left) * (bottom - top));
      const middle = Math.round((top + bottom) / 2) * page!.width;
      expect(page!.pixels[middle + left - 8]).toBe(255);
      expect(page!.pixels[middle + right + 8]).toBe(255);
    },
  );

  it.each([300, 600] as const)(
    "draws the rule above TOTAL across its whole width at %s dpi",
    async (resolution) => {
      const elements = layoutA4Invoice(fixture())[0]!.elements;
      const total = named(elements, labels.total);
      const rule = elements
        .filter((element): element is Rule => element.kind === "rule" && element.y < total.y)
        .sort((one, other) => other.y - one.y)[0]!;
      expect(rule.thickness).toBe(1.5);
      const [page] = await renderInvoiceRaster(fixture(), resolution);
      const dots = resolution / 72;
      const row = Math.floor((rule.y + rule.thickness / 2) * dots);
      const dark = (x: number) => page!.pixels[row * page!.width + x]! < 128;
      const left = Math.ceil(rule.x * dots);
      const right = Math.floor((rule.x + rule.width) * dots);
      let drawn = 0;
      for (let x = left; x < right; x++) if (dark(x)) drawn++;
      expect(drawn).toBe(right - left);
      expect(dark(left - 2)).toBe(false);
      expect(dark(right + 2)).toBe(false);
    },
  );
});
