import type { ReceiptLogoRaster } from "@waitron/shared";
import { invoiceBoldFont, invoiceFont } from "./invoice-font.js";
import {
  buildReceiptDocument,
  CONTACT_SEPARATOR,
  type ReceiptDocumentInput,
} from "./receipt-document.js";
import { qrModules } from "./qr-matrix.js";
import type { ReceiptTable, ReceiptTableRow } from "./receipt-table.js";
import type { TaxTableRow } from "./receipt-tax-table.js";

export const INVOICE_PAGE_WIDTH = 595.28;
export const INVOICE_PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const BODY_SIZE = 10;
const LINE_HEIGHT = 14;
const QR_SIZE = (35 * 72) / 25.4;
const RULE_THICKNESS = 0.75;
const COLUMN_GAP = 10;
const INDENT_WIDTH = 5;
const MIN_ITEM_WIDTH = 100;

type PageText = {
  kind: "text";
  text: string;
  x: number;
  y: number;
  size: number;
  weight: InvoiceTextWeight;
  tone: "ink" | "muted";
};
type PageQr = {
  kind: "qr";
  modules: readonly (readonly boolean[])[];
  x: number;
  y: number;
  moduleSize: number;
};
type PageLogo = {
  kind: "logo";
  raster: ReceiptLogoRaster;
  x: number;
  y: number;
  width: number;
  height: number;
};
type PageRule = { kind: "rule"; x: number; y: number; width: number; thickness: number };
type PageBox = {
  kind: "box";
  x: number;
  y: number;
  width: number;
  height: number;
  fill: "heading" | "panel";
};
export type InvoiceTextWeight = "regular" | "bold";
export type InvoicePageElement = PageText | PageQr | PageLogo | PageRule | PageBox;
export interface InvoicePage {
  elements: InvoicePageElement[];
}

export const INVOICE_TEXT_WIDTH_MEMO_LIMIT = 5000;
// Bounded because the server runs for months and every invoice brings new names.
const faces = {
  regular: { font: invoiceFont, advanceWidths: new Map<string, number>() },
  bold: { font: invoiceBoldFont, advanceWidths: new Map<string, number>() },
};

function width(text: string, size: number, weight: InvoiceTextWeight = "regular"): number {
  const { font, advanceWidths } = faces[weight];
  let advance = advanceWidths.get(text);
  if (advance === undefined) {
    if (advanceWidths.size >= INVOICE_TEXT_WIDTH_MEMO_LIMIT) advanceWidths.clear();
    advance = font.layout(text).advanceWidth;
    advanceWidths.set(text, advance);
  }
  return (advance * size) / font.unitsPerEm;
}
export { width as invoiceTextWidth };

const weightOf = (bold: boolean): InvoiceTextWeight => (bold ? "bold" : "regular");

function wrap(
  text: string,
  available: number,
  size: number,
  weight: InvoiceTextWeight = "regular",
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    const combined = line === "" ? word : `${line} ${word}`;
    if (width(combined, size, weight) <= available) {
      line = combined;
      continue;
    }
    if (line !== "") lines.push(line);
    line = "";
    for (const character of word) {
      if (line !== "" && width(line + character, size, weight) > available) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** Whole parts packed onto each line; only a part too long for a line by itself is word-wrapped. */
function wrapParts(
  text: string,
  available: number,
  size: number,
  weight: InvoiceTextWeight,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const part of text.split(CONTACT_SEPARATOR)) {
    const combined = line === "" ? part : `${line}${CONTACT_SEPARATOR}${part}`;
    if (width(combined, size, weight) <= available) {
      line = combined;
      continue;
    }
    if (line !== "") lines.push(line);
    const wrapped = wrap(part, available, size, weight);
    line = wrapped.pop() ?? "";
    lines.push(...wrapped);
  }
  if (line !== "") lines.push(line);
  return lines;
}

type TextStyle = { size: number; bold: boolean; centered: boolean };

interface Columns {
  /** The widest units cell the units column holds; a wider one takes a line of its own. */
  unitsRoom: number;
  unitsRight: number;
  itemLeft: number;
  itemWidth: number;
  priceRight: number;
  amountRight: number;
  contentRight: number;
}

/** Measured over every table in the document, so a table continuing after a line lines up with the first. */
function columnsFor(tables: readonly ReceiptTable[]): Columns {
  const rows = tables.flatMap((table) => [
    ...(table.header ? [{ row: table.header, weight: "bold" as const }] : []),
    ...table.rows.map((row) => ({ row, weight: "regular" as const })),
  ]);
  const widest = (cell: (row: ReceiptTableRow) => string): number =>
    Math.max(0, ...rows.map(({ row, weight }) => width(cell(row), BODY_SIZE, weight)));
  const contentRight = INVOICE_PAGE_WIDTH - MARGIN;
  const rateWidth = tables.some((table) => table.withRate) ? widest((row) => row.rate ?? "") : 0;
  const amountRight = rateWidth > 0 ? contentRight - rateWidth - COLUMN_GAP : contentRight;
  const priceRight = amountRight - widest((row) => row.amount) - COLUMN_GAP;
  const itemRight = priceRight - widest((row) => row.price) - COLUMN_GAP;
  const unitsRoom = Math.max(0, itemRight - MIN_ITEM_WIDTH - COLUMN_GAP - MARGIN);
  const unitsWidths = rows.map(({ row, weight }) => width(row.units, BODY_SIZE, weight));
  const unitsRight = MARGIN + Math.max(0, ...unitsWidths.filter((units) => units <= unitsRoom));
  const itemLeft = unitsRight + COLUMN_GAP;
  return {
    unitsRoom,
    unitsRight,
    itemLeft,
    itemWidth: itemRight - itemLeft,
    priceRight,
    amountRight,
    contentRight,
  };
}

export function layoutInvoicePages(input: ReceiptDocumentInput): InvoicePage[] {
  const document = buildReceiptDocument({ ...input, surface: "a4" });
  const columns = columnsFor(
    document.elements.flatMap((element) => (element.kind === "table" ? [element.table] : [])),
  );
  const pages: InvoicePage[] = [{ elements: [] }];
  let y = MARGIN;
  let alignment: "left" | "center" = "left";
  let afterRule = false;
  const rule = (): void => {
    pages.at(-1)!.elements.push({
      kind: "rule",
      x: MARGIN,
      y: y + (LINE_HEIGHT / 2 - RULE_THICKNESS) / 2,
      width: INVOICE_PAGE_WIDTH - 2 * MARGIN,
      thickness: RULE_THICKNESS,
    });
    y += LINE_HEIGHT / 2;
  };
  const fits = (height: number): boolean => y + height <= INVOICE_PAGE_HEIGHT - MARGIN;
  const room = (height: number): void => {
    if (fits(height)) return;
    const previous = pages.at(-1)!.elements;
    let strandedRules = 0;
    while (previous.at(-1)?.kind === "rule") {
      previous.pop();
      strandedRules++;
    }
    pages.push({ elements: [] });
    y = MARGIN;
    for (let count = 0; count < strandedRules; count++) rule();
  };
  const place = (
    page: InvoicePage,
    at: number,
    value: string,
    x: number,
    size: number,
    bold: boolean,
  ): void => {
    if (value !== "")
      page.elements.push({
        kind: "text",
        text: value,
        x,
        y: at,
        size,
        weight: weightOf(bold),
        tone: "ink",
      });
  };
  const textLines = (lines: readonly string[], x: number, style: TextStyle): void => {
    const { size, bold, centered } = style;
    const height = (LINE_HEIGHT * size) / BODY_SIZE;
    for (const line of lines) {
      room(height);
      const left = centered ? (INVOICE_PAGE_WIDTH - width(line, size, weightOf(bold))) / 2 : x;
      place(pages.at(-1)!, y, line, left, size, bold);
      y += height;
    }
  };
  const text = (value: string, x: number, available: number, style: TextStyle): void =>
    textLines(wrap(value, available, style.size, weightOf(style.bold)), x, style);
  const placeRight = (
    page: InvoicePage,
    at: number,
    value: string,
    right: number,
    size: number,
    bold: boolean,
  ): void => place(page, at, value, right - width(value, size, weightOf(bold)), size, bold);
  const linesPerPage = Math.floor((INVOICE_PAGE_HEIGHT - 2 * MARGIN) / LINE_HEIGHT);
  type RowLines = { units: string[]; item: string[]; count: number };
  const rowLines = (row: ReceiptTableRow, weight: InvoiceTextWeight): RowLines => {
    const units =
      width(row.units, BODY_SIZE, weight) > columns.unitsRoom
        ? wrap(row.units, INVOICE_PAGE_WIDTH - 2 * MARGIN, BODY_SIZE, weight)
        : [];
    const indent = (row.itemIndent ?? 0) * INDENT_WIDTH;
    const item = wrap(row.item, columns.itemWidth - indent, BODY_SIZE, weight);
    if (item.length === 0) item.push("");
    return { units, item, count: units.length + item.length };
  };
  /** Lines a row keeps together: all of them, or one for a row no page could hold below the header, which breaks line by line. */
  const rowStart = (count: number, headerLines: number): number =>
    count <= linesPerPage - headerLines ? count : 1;
  type TableHeader = { row: ReceiptTableRow; lines: RowLines };
  let headedPage: InvoicePage | undefined;
  const drawHeader = (header: TableHeader, withRate: boolean): void => {
    tableRow(header.row, header.lines, true, withRate);
    headedPage = pages.at(-1);
  };
  /** Each page the row moves or breaks onto opens with `header`. */
  const tableRow = (
    row: ReceiptTableRow,
    lines: RowLines,
    bold: boolean,
    withRate: boolean,
    header?: TableHeader,
  ): void => {
    const lineRoom = (count: number): void => {
      if (fits(count * LINE_HEIGHT)) return;
      room(count * LINE_HEIGHT);
      if (header) drawHeader(header, withRate);
    };
    const { units, item } = lines;
    lineRoom(rowStart(lines.count, header?.lines.count ?? 0));
    for (const line of units) {
      lineRoom(1);
      place(pages.at(-1)!, y, line, MARGIN, BODY_SIZE, bold);
      y += LINE_HEIGHT;
    }
    lineRoom(1);
    const page = pages.at(-1)!;
    const top = y;
    if (units.length === 0) placeRight(page, top, row.units, columns.unitsRight, BODY_SIZE, bold);
    const indent = (row.itemIndent ?? 0) * INDENT_WIDTH;
    for (const line of item) {
      lineRoom(1);
      place(pages.at(-1)!, y, line, columns.itemLeft + indent, BODY_SIZE, bold);
      y += LINE_HEIGHT;
    }
    placeRight(page, top, row.price, columns.priceRight, BODY_SIZE, bold);
    placeRight(page, top, row.amount, columns.amountRight, BODY_SIZE, bold);
    if (withRate) placeRight(page, top, row.rate ?? "", columns.contentRight, BODY_SIZE, bold);
  };
  // The builder gives only the item list's first table a header (receipt-document.ts, endTable).
  let itemHeader: TableHeader | undefined;
  for (const [index, element] of document.elements.entries()) {
    const previousWasRule = afterRule;
    if (element.kind !== "align") afterRule = element.kind === "rule";
    switch (element.kind) {
      case "align":
        alignment = element.alignment;
        break;
      case "logo": {
        const raster = input.logo;
        if (raster) {
          const pitch = 72 / 203;
          const logoWidth = raster.widthDots * pitch;
          const logoHeight = raster.heightDots * pitch;
          if (!previousWasRule) y += LINE_HEIGHT / 2;
          room(logoHeight + LINE_HEIGHT / 2);
          pages.at(-1)!.elements.push({
            kind: "logo",
            raster,
            x: (INVOICE_PAGE_WIDTH - logoWidth) / 2,
            y,
            width: logoWidth,
            height: logoHeight,
          });
          y += logoHeight + LINE_HEIGHT / 2;
        }
        break;
      }
      case "rule":
        room(LINE_HEIGHT / 2);
        rule();
        break;
      case "qr": {
        const modules = qrModules(element.text);
        const moduleSize = QR_SIZE / modules.length;
        const quietZone = 4 * moduleSize;
        room(QR_SIZE + 2 * quietZone);
        pages.at(-1)!.elements.push({
          kind: "qr",
          modules,
          x: (INVOICE_PAGE_WIDTH - QR_SIZE) / 2,
          y: y + quietZone,
          moduleSize,
        });
        y += QR_SIZE + 2 * quietZone + LINE_HEIGHT / 2;
        break;
      }
      case "table": {
        const { header, rows, withRate } = element.table;
        if (header) itemHeader = { row: header, lines: rowLines(header, "bold") };
        for (const [index, row] of rows.entries()) {
          const lines = rowLines(row, "regular");
          if (index === 0 && itemHeader && headedPage !== pages.at(-1)) {
            const headerLines = itemHeader.lines.count;
            room((headerLines + rowStart(lines.count, headerLines)) * LINE_HEIGHT);
            drawHeader(itemHeader, withRate);
          }
          tableRow(row, lines, false, withRate, itemHeader);
        }
        break;
      }
      case "taxTable": {
        const { header, rows } = element;
        const amounts = (row: TaxTableRow): string[] => [row.base, row.tax, row.total];
        const widths = amounts(header).map((_, at) =>
          Math.max(
            width(amounts(header)[at]!, BODY_SIZE, "bold"),
            ...rows.map((row) => width(amounts(row)[at]!, BODY_SIZE)),
          ),
        );
        const rights: number[] = [];
        let right = INVOICE_PAGE_WIDTH - MARGIN;
        for (let at = widths.length - 1; at >= 0; at--) {
          rights[at] = right;
          right -= widths[at]! + COLUMN_GAP;
        }
        // The table moves to the next page whole, unless it is taller than a page.
        room(Math.min(rows.length + 1, linesPerPage) * LINE_HEIGHT);
        for (const [index, row] of [header, ...rows].entries()) {
          room(LINE_HEIGHT);
          const page = pages.at(-1)!;
          const bold = index === 0;
          place(page, y, row.rate, MARGIN, BODY_SIZE, bold);
          amounts(row).forEach((amount, at) =>
            placeRight(page, y, amount, rights[at]!, BODY_SIZE, bold),
          );
          y += LINE_HEIGHT;
        }
        break;
      }
      case "text":
      case "amount": {
        const indent = typeof element.indent === "number" ? element.indent * INDENT_WIDTH : 0;
        const x = MARGIN + indent;
        const available = INVOICE_PAGE_WIDTH - MARGIN - x;
        const size = element.style?.double === true ? BODY_SIZE * 2 : BODY_SIZE;
        const bold = element.style?.bold === true;
        if (element.kind === "text") {
          const style = { size, bold, centered: alignment === "center" };
          if (index === document.contactLine)
            textLines(wrapParts(element.text, available, size, weightOf(bold)), x, style);
          else text(element.text, x, available, style);
          break;
        }
        const weight = weightOf(bold);
        const captionLines = wrap(element.caption, available, size, weight);
        const besideLast =
          captionLines.length > 0 &&
          width(captionLines.at(-1)!, size, weight) + size + width(element.amount, size, weight) <=
            available;
        const height = (LINE_HEIGHT * size) / BODY_SIZE;
        const block = (captionLines.length + (besideLast ? 0 : 1)) * height;
        if (block <= INVOICE_PAGE_HEIGHT - 2 * MARGIN) room(block);
        textLines(captionLines, x, { size, bold, centered: false });
        if (besideLast) y -= height;
        else room(height);
        placeRight(pages.at(-1)!, y, element.amount, INVOICE_PAGE_WIDTH - MARGIN, size, bold);
        y += height;
        break;
      }
    }
  }
  return pages;
}
