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
  const document = buildReceiptDocument(input);
  const b = esc(printer);
  const { columns, widthDots } = b.grid;
  b.init().printArea(widthDots);
  const indentation = (indent: ReceiptIndent): number => {
    if (typeof indent === "number") return indent;
    const width = prepareText(indent.after).length;
    return width > columns / 2 ? 2 : width;
  };
  for (const element of document.elements) {
    switch (element.kind) {
      case "text":
        for (const line of wrapText(
          prepareText(element.text),
          columns,
          indentation(element.indent),
        )) {
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
        b.line();
        break;
      case "align":
        b.align(element.alignment);
        break;
      case "logo":
        if (logo !== null) b.bitmap(logo);
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
