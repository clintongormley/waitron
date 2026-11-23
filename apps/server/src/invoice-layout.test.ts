import { describe, expect, it } from "vitest";
import { receiptLabelsFor } from "@waitron/country-packs";
import type { ReceiptLogoRaster } from "@waitron/shared";
import { CUSTOMER_PANEL_FRACTION, layoutInvoiceHeader } from "./invoice-layout.js";
import { invoiceTextWidth, type InvoicePageElement } from "./invoice-page.js";
import { receiptDateTime, receiptDay } from "./receipt-dates.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import { receiptFacts } from "./receipt-facts.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./testing/full-invoice-fixture.js";
import * as receiptCases from "./testing/receipt-cases.js";

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
