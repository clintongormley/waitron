import { describe, expect, it } from "vitest";
import { receiptLabelsFor } from "@waitron/country-packs";
import { layoutA4Invoice } from "./invoice-layout.js";
import { INVOICE_PAGE_WIDTH, invoiceTextWidth, type InvoicePageElement } from "./invoice-page.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./testing/full-invoice-fixture.js";

type Text = Extract<InvoicePageElement, { kind: "text" }>;

const MARGIN = 36;
const RIGHT = INVOICE_PAGE_WIDTH - MARGIN;
const SUMMARY_LEFT = MARGIN + (RIGHT - MARGIN) / 2;
/** Room the full table's Description keeps beside every figure column, quantity at its widest. */
const MIN_DESCRIPTION = 180;
const CELL_PADDING = 4;

const fixture = (locale: string): ReceiptDocumentInput => ({
  ...structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE),
  invoiceLocale: locale,
});

describe("the A4 VAT summary's heading row", () => {
  it.each(["es-ES", "en-GB", "ca-ES", "gl-ES", "eu-ES"])(
    "keeps each heading on one line, side by side and inside the right half, in %s",
    (locale) => {
      const labels = receiptLabelsFor(locale);
      const headings = [
        labels.taxRateColumn,
        labels.vatSummaryBaseColumn,
        labels.vatSummaryAmountColumn,
        labels.taxTotalColumn,
      ];
      const elements = layoutA4Invoice(fixture(locale)).at(-1)!.elements;
      const drawn = headings.map((heading) =>
        [...elements]
          .reverse()
          .find(
            (element): element is Text =>
              element.kind === "text" && element.text === heading && element.x >= SUMMARY_LEFT,
          ),
      );
      for (const [index, text] of drawn.entries())
        expect(text, `"${headings[index]}" drawn whole on one line`).toBeDefined();
      const cells = drawn.map((text) => text!);
      for (const text of cells) expect(text.y).toBe(cells[0]!.y);
      for (const [index, text] of cells.entries()) {
        const right = text.x + invoiceTextWidth(text.text, text.size, text.weight);
        expect(right).toBeLessThanOrEqual(RIGHT + 0.01);
        const next = cells[index + 1];
        if (next !== undefined) expect(right).toBeLessThan(next.x);
      }
    },
  );

  it("falls back to equal columns, each inside the right half, when the amounts are too wide to sit side by side", () => {
    const input = fixture("es-ES");
    const huge = "1234567890.12";
    input.result.vatBreakdown = [{ rate: "21", base: huge, tax: huge }];
    const labels = receiptLabelsFor("es-ES");
    const elements = layoutA4Invoice(input).at(-1)!.elements;
    const heading = [...elements]
      .reverse()
      .find(
        (element): element is Text =>
          element.kind === "text" && element.text === labels.taxRateColumn,
      )!;
    const total = elements.find(
      (element): element is Text => element.kind === "text" && element.text === labels.total,
    )!;
    const summary = elements.filter(
      (element): element is Text =>
        element.kind === "text" && element.y >= heading.y && element.y < total.y,
    );
    const quarter = (RIGHT - SUMMARY_LEFT) / 4;
    for (const text of summary) {
      const right = text.x + invoiceTextWidth(text.text, text.size, text.weight);
      const column = Math.floor((right - SUMMARY_LEFT - 0.01) / quarter);
      expect(text.x, text.text).toBeGreaterThanOrEqual(SUMMARY_LEFT + column * quarter);
      expect(right, text.text).toBeLessThanOrEqual(SUMMARY_LEFT + (column + 1) * quarter);
    }
    expect(summary.length).toBeGreaterThan(8);
  });
});

describe("the A4 table's quantity column", () => {
  const weighed = (locale: string, quantity: string, unit: string): ReceiptDocumentInput => {
    const input = fixture(locale);
    input.result.lines[1] = {
      ...input.result.lines[1]!,
      quantity,
      unitName: { "es-ES": unit, "en-GB": unit, "ca-ES": unit, "gl-ES": unit, "eu-ES": unit },
    };
    return input;
  };

  it.each(
    ["es-ES", "en-GB", "ca-ES", "gl-ES", "eu-ES"].flatMap((locale) => [
      [locale, "99.999", "kg", /^99[.,]999 kg$/],
      [locale, "99999", "ml", /^99999 ml$/],
      [locale, "99999", "mg", /^99999 mg$/],
    ]) as [string, string, string, RegExp][],
  )("keeps a weighed quantity on one line in %s (%s %s)", (locale, quantity, unit, shape) => {
    const elements = layoutA4Invoice(weighed(locale, quantity, unit)).flatMap(
      (page) => page.elements,
    );
    const texts = elements.filter((element): element is Text => element.kind === "text");
    const drawn = texts.filter((text) => shape.test(text.text));
    expect(drawn, texts.map((text) => text.text).join(" | ")).toHaveLength(1);
    const cell = drawn[0]!;
    const sameRow = texts.filter((text) => text.y === cell.y && text.x > cell.x);
    const right = cell.x + invoiceTextWidth(cell.text, cell.size, cell.weight);
    for (const next of sameRow) expect(right).toBeLessThan(next.x);
  });

  it.each([
    ["es-ES", "measure ".repeat(15).trim()],
    ["en-GB", "measure ".repeat(15).trim()],
    ["es-ES", "m".repeat(120)],
  ])("wraps a long unit inside a capped quantity column in %s (%s)", (locale, unit) => {
    expect(unit.length).toBeGreaterThanOrEqual(119);
    const pages = layoutA4Invoice(weighed(locale, "2", unit));
    const texts = pages
      .flatMap((page) => page.elements)
      .filter((element): element is Text => element.kind === "text");
    for (const text of texts) expect(text.x, text.text).toBeGreaterThanOrEqual(MARGIN - 0.01);

    const rightOf = (text: Text): number =>
      text.x + invoiceTextWidth(text.text, text.size, text.weight);
    const heading = texts.find((text) => text.text === receiptLabelsFor(locale).quantityColumn)!;
    const item = fixture(locale).result.lines[1]!.descriptions[locale as "es-ES" | "en-GB"]!;
    const name = texts.find((text) => text.text === item)!;
    const pieces = texts.filter(
      (text) =>
        text !== heading &&
        text.y >= name.y &&
        Math.abs(rightOf(text) - rightOf(heading)) < 0.000001,
    );
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map((text) => text.text.replaceAll(" ", "")).join("")).toBe(
      `2${unit.replaceAll(" ", "")}`,
    );

    // A wrapped line falls short of its column by less than one character, so this bounds the
    // column's left edge from below.
    const widestCharacter = Math.max(
      ...[...unit].map((character) => invoiceTextWidth(character, pieces[0]!.size, "regular")),
    );
    const columnLeft = Math.min(...pieces.map((text) => text.x)) - CELL_PADDING - widestCharacter;
    expect(columnLeft - MARGIN, "Description keeps its minimum width").toBeGreaterThanOrEqual(
      MIN_DESCRIPTION,
    );
    expect(rightOf(name)).toBeLessThan(columnLeft);
  });
});
