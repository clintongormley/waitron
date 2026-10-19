import {
  QR_QUIET_ZONE,
  chooseQrDots,
  dpiValue,
  esc,
  labelAmountLines,
  prepareText,
  safeWidthDots,
  withQuietZone,
  wrapText,
  type EscSetting,
  type MonoRaster,
  type TextStyle,
} from "@waitron/printing";
import { qrModules } from "./qr-matrix.js";
import { tableLines, type ReceiptTable, type ReceiptTableRow } from "./receipt-table.js";
import {
  buildReceiptDocument,
  type ReceiptDocumentInput,
  type ReceiptIndent,
  type ReceiptStyle,
} from "./receipt-document.js";
export type { ReceiptIssuer, ReceiptTrim } from "./receipt-document.js";

export interface FormatReceiptInput extends ReceiptDocumentInput {
  printer: EscSetting;
  logo?: MonoRaster | null;
}

function preparedRow(row: ReceiptTableRow): ReceiptTableRow {
  return {
    ...row,
    units: prepareText(row.units),
    item: prepareText(row.item),
    price: prepareText(row.price),
    amount: prepareText(row.amount),
    ...(row.rate === undefined ? {} : { rate: prepareText(row.rate) }),
  };
}

function preparedTable(table: ReceiptTable): ReceiptTable {
  return {
    ...table,
    ...(table.header ? { header: preparedRow(table.header) } : {}),
    rows: table.rows.map(preparedRow),
  };
}

function toTextStyle(style: ReceiptStyle | undefined): TextStyle {
  return { bold: style?.bold === true, double: style?.double === true };
}

export function formatReceipt(input: FormatReceiptInput): Uint8Array {
  return drawReceipt(input).bytes;
}

/**
 * The receipt's commands, and which of the pictures they draw, counted from 0, are the rules that
 * end its sections, so a preview can tell a rule from a trim line of dashes that draws the same.
 */
export function drawReceipt({ printer, logo = null, ...input }: FormatReceiptInput): {
  bytes: Uint8Array;
  rules: number[];
} {
  const rules: number[] = [];
  const document = buildReceiptDocument({
    ...input,
    surface: "thermal",
    paper: printer.paperWidth,
  });
  const b = esc(printer);
  const { columns, widthDots } = b.grid;
  b.init().printArea(widthDots);
  const indentation = (indent: ReceiptIndent, available: number): number => {
    if (typeof indent === "number") return indent;
    const width = prepareText(indent.after).length;
    return width > available / 2 ? 2 : width;
  };
  let afterRule = false;
  for (const element of document.elements) {
    if (element.kind !== "align" && element.kind !== "logo") afterRule = element.kind === "rule";
    switch (element.kind) {
      case "text": {
        const style = toTextStyle(element.style);
        const width = style.double ? Math.floor(columns / 2) : columns;
        for (const line of wrapText(
          prepareText(element.text),
          width,
          indentation(element.indent, width),
        )) {
          b.line(line, style);
        }
        break;
      }
      case "amount": {
        const caption = prepareText(element.caption);
        const amount = prepareText(element.amount);
        const style = toTextStyle(element.style);
        if (style.double) {
          const half = Math.floor(columns / 2);
          const indent = indentation(element.indent, half);
          const double = labelAmountLines(caption, amount, half, indent, element.gap);
          if (double.length === 1) {
            b.line(double[0], style);
            break;
          }
          const captionLines = wrapText(caption, half, indent);
          if (captionLines.length === 1 && amount.length <= half) {
            b.line(captionLines[0], style);
            b.line(amount.padStart(half), style);
            break;
          }
        }
        for (const line of labelAmountLines(
          caption,
          amount,
          columns,
          indentation(element.indent, columns),
          element.gap,
        )) {
          b.line(line, { bold: style.bold });
        }
        break;
      }
      case "table":
        for (const line of tableLines(preparedTable(element.table), columns)) {
          b.line(line.text, { bold: line.header, double: false });
        }
        break;
      case "rule":
        rules.push(b.pictures);
        b.line("-".repeat(columns));
        break;
      case "align":
        b.align(element.alignment);
        break;
      case "logo":
        if (logo !== null) {
          if (!afterRule) b.line();
          b.bitmap(logo);
          b.line();
        }
        break;
      case "qr": {
        const matrix = qrModules(element.text);
        const dots = chooseQrDots(
          matrix.length,
          dpiValue(printer.resolution),
          safeWidthDots(printer.paperWidth),
        );
        b.qrRaster(withQuietZone(matrix, QR_QUIET_ZONE), { moduleSize: dots });
        break;
      }
    }
  }
  return { bytes: b.feedAndCut().bytes(), rules };
}
