import { describe, expect, it } from "vitest";
import { layoutA4Invoice } from "./invoice-layout.js";
import { invoiceTextWidth, type InvoicePageElement } from "./invoice-page.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import { formatAmount, formatMoney, formatVatRate } from "./receipt-money.js";
import { formatReceipt } from "./receipt-ticket.js";
import { printedLines } from "./testing/decode-ticket.js";
import { correctiveWithPartLine } from "./testing/receipt-cases.js";

// Owner's answer 4 (correct-full-invoice design §6): on both papers a line given back only in part
// prints its amount with no quantity and no unit price.
const names = { croquetas: { "es-ES": "Croquetas", "en-GB": "Croquettes" }, paella: "Paella" };

const LOCALES = ["es-ES", "en-GB"] as const;
const WIDTHS = ["58mm", "80mm"] as const;
const cases = LOCALES.flatMap((locale) => WIDTHS.map((width) => [width, locale] as const));

const roll = (input: ReceiptDocumentInput, paperWidth: (typeof WIDTHS)[number]): string[] =>
  printedLines(formatReceipt({ ...input, printer: { paperWidth, resolution: "180dpi" } }));
const lineOf = (lines: readonly string[], name: string): string => {
  const found = lines.filter((line) => line.includes(name));
  expect(found, lines.join("\n")).toHaveLength(1);
  return found[0]!;
};
const collapsed = (line: string): string => line.trim().replace(/\s+/g, " ");

describe("the roll", () => {
  it.each(cases)("a full invoice's corrective on %s in %s", (width, locale) => {
    const lines = roll(correctiveWithPartLine("R1", locale), width);
    const croquetas = lineOf(lines, names.croquetas[locale]);
    const paella = lineOf(lines, names.paella);
    const amount = (value: string) => formatAmount(value, locale);
    expect(collapsed(croquetas)).toBe(
      `-1 ${names.croquetas[locale]} ${amount("5.45")} ${amount("-5.45")}`,
    );
    expect(collapsed(paella)).toBe(`${names.paella} ${amount("-6.20")}`);
    // The blank quantity keeps the table's item column.
    expect(paella.indexOf(names.paella)).toBe(croquetas.indexOf(names.croquetas[locale]));
  });

  it.each(cases)("a receipt's corrective on %s in %s", (width, locale) => {
    const lines = roll(correctiveWithPartLine("R5", locale), width);
    const amount = (value: string) => formatAmount(value, locale);
    expect(collapsed(lineOf(lines, names.croquetas[locale]))).toBe(
      `-1 ${names.croquetas[locale]} ${amount("-6.00")}`,
    );
    const paella = lineOf(lines, names.paella);
    expect(paella.startsWith(names.paella), JSON.stringify(paella)).toBe(true);
    expect(collapsed(paella)).toBe(`${names.paella} ${amount("-6.82")}`);
  });
});

type Text = Extract<InvoicePageElement, { kind: "text" }>;
const rowNamed = (elements: readonly InvoicePageElement[], name: string): Text[] => {
  const texts = elements.filter((element): element is Text => element.kind === "text");
  const cell = texts.filter((text) => text.text === name);
  expect(cell, name).toHaveLength(1);
  return texts.filter((text) => text.y === cell[0]!.y).sort((one, other) => one.x - other.x);
};

describe("the A4 page", () => {
  it.each(LOCALES)("a full invoice's corrective in %s", (locale) => {
    const elements = layoutA4Invoice(correctiveWithPartLine("R1", locale)).flatMap(
      (page) => page.elements,
    );
    const money = (value: string) => formatMoney(value, locale);
    const rate = formatVatRate("10.00", locale);
    expect(rowNamed(elements, names.croquetas[locale]).map((text) => text.text)).toEqual([
      names.croquetas[locale],
      "-1",
      money("5.45"),
      money("-5.45"),
      rate,
      money("-6.00"),
    ]);
    const paella = rowNamed(elements, names.paella);
    expect(paella.map((text) => text.text)).toEqual([
      names.paella,
      money("-6.20"),
      rate,
      money("-6.82"),
    ]);
    // The figures left stay in their columns: each right edge is the whole row's.
    const croquetas = rowNamed(elements, names.croquetas[locale]);
    const right = (text: Text) => text.x + invoiceTextWidth(text.text, text.size, text.weight);
    expect(paella[0]!.x).toBe(croquetas[0]!.x);
    paella.slice(1).forEach((text, i) => expect(right(text)).toBeCloseTo(right(croquetas[i + 3]!)));
  });

  it.each(LOCALES)("a receipt's corrective in %s", (locale) => {
    const elements = layoutA4Invoice(correctiveWithPartLine("R5", locale)).flatMap(
      (page) => page.elements,
    );
    const money = (value: string) => formatMoney(value, locale);
    expect(rowNamed(elements, names.croquetas[locale]).map((text) => text.text)).toEqual([
      names.croquetas[locale],
      "-1",
      money("-6.00"),
    ]);
    expect(rowNamed(elements, names.paella).map((text) => text.text)).toEqual([
      names.paella,
      money("-6.82"),
    ]);
  });
});
