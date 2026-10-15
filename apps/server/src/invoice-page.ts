import type { ReceiptLogoRaster } from "@waitron/shared";
import { invoiceFont } from "./invoice-font.js";
import { buildReceiptDocument, type ReceiptDocumentInput } from "./receipt-document.js";
import { qrModules } from "./qr-matrix.js";
import type { ReceiptTable, ReceiptTableRow } from "./receipt-table.js";

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
  bold: boolean;
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
export type InvoicePageElement = PageText | PageQr | PageLogo | PageRule;
export interface InvoicePage {
  elements: InvoicePageElement[];
}

function width(text: string, size: number): number {
  return (invoiceFont.layout(text).advanceWidth * size) / invoiceFont.unitsPerEm;
}

function wrap(text: string, available: number, size: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    const combined = line === "" ? word : `${line} ${word}`;
    if (width(combined, size) <= available) {
      line = combined;
      continue;
    }
    if (line !== "") lines.push(line);
    line = "";
    for (const character of word) {
      if (line !== "" && width(line + character, size) > available) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
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
  const rows = tables.flatMap((table) => (table.header ? [table.header] : []).concat(table.rows));
  const widest = (cell: (row: ReceiptTableRow) => string): number =>
    Math.max(0, ...rows.map((row) => width(cell(row), BODY_SIZE)));
  const contentRight = INVOICE_PAGE_WIDTH - MARGIN;
  const rateWidth = tables.some((table) => table.withRate) ? widest((row) => row.rate ?? "") : 0;
  const amountRight = rateWidth > 0 ? contentRight - rateWidth - COLUMN_GAP : contentRight;
  const priceRight = amountRight - widest((row) => row.amount) - COLUMN_GAP;
  const itemRight = priceRight - widest((row) => row.price) - COLUMN_GAP;
  const unitsRoom = Math.max(0, itemRight - MIN_ITEM_WIDTH - COLUMN_GAP - MARGIN);
  const unitsWidths = rows.map((row) => width(row.units, BODY_SIZE));
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
  const room = (height: number): void => {
    if (y + height <= INVOICE_PAGE_HEIGHT - MARGIN) return;
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
    if (value !== "") page.elements.push({ kind: "text", text: value, x, y: at, size, bold });
  };
  const textLines = (lines: readonly string[], x: number, style: TextStyle): void => {
    const { size, bold, centered } = style;
    const height = (LINE_HEIGHT * size) / BODY_SIZE;
    for (const line of lines) {
      room(height);
      const left = centered ? (INVOICE_PAGE_WIDTH - width(line, size)) / 2 : x;
      place(pages.at(-1)!, y, line, left, size, bold);
      y += height;
    }
  };
  const text = (value: string, x: number, available: number, style: TextStyle): void =>
    textLines(wrap(value, available, style.size), x, style);
  const placeRight = (
    page: InvoicePage,
    at: number,
    value: string,
    right: number,
    size: number,
    bold: boolean,
  ): void => place(page, at, value, right - width(value, size), size, bold);
  const linesPerPage = Math.floor((INVOICE_PAGE_HEIGHT - 2 * MARGIN) / LINE_HEIGHT);
  const tableRow = (row: ReceiptTableRow, bold: boolean, withRate: boolean): void => {
    if (width(row.units, BODY_SIZE) > columns.unitsRoom) {
      text(row.units, MARGIN, INVOICE_PAGE_WIDTH - 2 * MARGIN, {
        size: BODY_SIZE,
        bold,
        centered: false,
      });
      tableRow({ ...row, units: "" }, bold, withRate);
      return;
    }
    const indent = (row.itemIndent ?? 0) * INDENT_WIDTH;
    const itemLines = wrap(row.item, columns.itemWidth - indent, BODY_SIZE);
    if (itemLines.length === 0) itemLines.push("");
    // A row no page could hold starts where it is and breaks line by line.
    room((itemLines.length <= linesPerPage ? itemLines.length : 1) * LINE_HEIGHT);
    const page = pages.at(-1)!;
    const top = y;
    placeRight(page, top, row.units, columns.unitsRight, BODY_SIZE, bold);
    for (const line of itemLines) {
      room(LINE_HEIGHT);
      place(pages.at(-1)!, y, line, columns.itemLeft + indent, BODY_SIZE, bold);
      y += LINE_HEIGHT;
    }
    placeRight(page, top, row.price, columns.priceRight, BODY_SIZE, bold);
    placeRight(page, top, row.amount, columns.amountRight, BODY_SIZE, bold);
    if (withRate) placeRight(page, top, row.rate ?? "", columns.contentRight, BODY_SIZE, bold);
  };
  for (const element of document.elements) {
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
      case "table":
        if (element.table.header) tableRow(element.table.header, true, element.table.withRate);
        for (const row of element.table.rows) tableRow(row, false, element.table.withRate);
        break;
      case "text":
      case "amount": {
        const indent = typeof element.indent === "number" ? element.indent * INDENT_WIDTH : 0;
        const x = MARGIN + indent;
        const available = INVOICE_PAGE_WIDTH - MARGIN - x;
        const size = element.style?.double === true ? BODY_SIZE * 2 : BODY_SIZE;
        const bold = element.style?.bold === true;
        if (element.kind === "text") {
          text(element.text, x, available, { size, bold, centered: alignment === "center" });
          break;
        }
        const captionLines = wrap(element.caption, available, size);
        const besideLast =
          captionLines.length > 0 &&
          width(captionLines.at(-1)!, size) + size + width(element.amount, size) <= available;
        textLines(captionLines, x, { size, bold, centered: false });
        const height = (LINE_HEIGHT * size) / BODY_SIZE;
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
