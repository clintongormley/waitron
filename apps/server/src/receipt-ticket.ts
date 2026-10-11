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
} from "@waitron/printing";
import { qrModules } from "./qr-matrix.js";
import {
  PART_SEPARATOR,
  buildReceiptDocument,
  type ReceiptDocumentInput,
  type ReceiptIndent,
} from "./receipt-document.js";
export type { ReceiptIssuer, ReceiptTrim } from "./receipt-document.js";

export interface FormatReceiptInput extends ReceiptDocumentInput {
  printer: EscSetting;
  logo?: MonoRaster | null;
}

export function formatReceipt({ printer, logo = null, ...input }: FormatReceiptInput): Uint8Array {
  const document = buildReceiptDocument({ ...input, surface: "thermal" });
  const b = esc(printer);
  const { columns, widthDots } = b.grid;
  b.init().printArea(widthDots);
  const indentation = (indent: ReceiptIndent): number => {
    if (typeof indent === "number") return indent;
    const width = prepareText(indent.after).length;
    return width > columns / 2 ? 2 : width;
  };
  const textLines = (
    text: string,
    parts: readonly string[] | undefined,
    indent: number,
  ): string[] => {
    const whole = wrapText(prepareText(text), columns, indent);
    if (whole.length === 1 || parts === undefined) return whole;
    const lines: string[] = [];
    let current = "";
    for (const part of parts.map(prepareText)) {
      const joined = current === "" ? part : `${current}${PART_SEPARATOR}${part}`;
      if (current === "" || joined.length <= columns) {
        current = joined;
        continue;
      }
      lines.push(...wrapText(current, columns, indent));
      current = `${" ".repeat(indent)}${part}`;
    }
    return [...lines, ...wrapText(current, columns, indent)];
  };
  let lastBlank = false;
  const blank = (): void => {
    b.line();
    lastBlank = true;
  };
  for (const element of document.elements) {
    if (element.kind !== "align" && element.kind !== "logo") lastBlank = false;
    switch (element.kind) {
      case "text":
        for (const line of textLines(element.text, element.parts, indentation(element.indent))) {
          b.line(line);
        }
        break;
      case "amount":
        for (const line of labelAmountLines(
          prepareText(element.caption),
          prepareText(element.amount),
          columns,
          indentation(element.indent),
        )) {
          b.line(line);
        }
        break;
      case "break":
        blank();
        break;
      case "rule":
        b.line("-".repeat(columns));
        break;
      case "align":
        b.align(element.alignment);
        break;
      case "logo":
        if (logo !== null) {
          if (!lastBlank) b.line();
          b.bitmap(logo);
          blank();
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
  return b.feedAndCut().bytes();
}
