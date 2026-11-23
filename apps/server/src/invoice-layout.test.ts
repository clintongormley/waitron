import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
import { receiptLabelsFor } from "@waitron/country-packs";
import type { ReceiptLogoRaster } from "@waitron/shared";
import { CUSTOMER_PANEL_FRACTION, layoutA4Invoice, layoutInvoiceHeader } from "./invoice-layout.js";
import {
  INVOICE_PAGE_HEIGHT,
  invoiceTextWidth,
  type InvoicePage,
  type InvoicePageElement,
} from "./invoice-page.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { receiptDateTime, receiptDay } from "./receipt-dates.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import { receiptFacts } from "./receipt-facts.js";
import { formatMoney } from "./receipt-money.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./testing/full-invoice-fixture.js";
import * as receiptCases from "./testing/receipt-cases.js";

// Until printing switches to the new layout, the PDF test renders it through the old entry point.
const layout = vi.hoisted(() => ({ pages: undefined as unknown }));
vi.mock("./invoice-page.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./invoice-page.js")>()),
  layoutInvoicePages: (input: ReceiptDocumentInput) =>
    (layout.pages as (input: ReceiptDocumentInput) => InvoicePage[])(input),
}));
layout.pages = (input: ReceiptDocumentInput) => layoutA4Invoice(input);

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
    named(header(input).elements, `${labels.simplifiedInvoice} FF/1`);
    expect(texts(header(input).elements).map((text) => text.text)).not.toContain(
      `${labels.invoiceHeading} FF/1`,
    );
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
      ...Object.entries(receiptCases).map(([name, build]): [string, ReceiptDocumentInput] => [
        name,
        build(),
      ]),
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
      ...Object.entries(receiptCases).map(([name, build]): [string, ReceiptDocumentInput] => [
        name,
        build(),
      ]),
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
