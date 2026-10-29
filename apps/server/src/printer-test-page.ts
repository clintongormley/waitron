import {
  QR_QUIET_ZONE,
  chooseQrDots,
  dpiValue,
  esc,
  prepareText,
  safeWidthDots,
  withQuietZone,
  wrapText,
  type EscSetting,
} from "@waitron/printing";
import type { SupportedLocale } from "@waitron/shared";
import { PRINTER_TEST_PAGE_WORDS, PRINTER_TEST_SAMPLE_TEXT } from "./i18n/printer-test-page.js";
import { qrModules } from "./qr-matrix.js";

/** Fixed sample content, never a tax-agency link. */
export const PRINTER_TEST_PAGE_QR_TEXT = "Waitron test page";

export interface PrinterTestPageInput {
  locale: SupportedLocale;
  printer: EscSetting;
  printerName: string;
  now: Date;
  timeZone: string;
}

export function formatPrinterTestPage({
  locale,
  printer,
  printerName,
  now,
  timeZone,
}: PrinterTestPageInput): Uint8Array {
  const words = PRINTER_TEST_PAGE_WORDS[locale];
  const b = esc(printer);
  const { columns, widthDots } = b.grid;
  b.init().printArea(widthDots).align("center");
  const text = (s: string): void => {
    for (const line of wrapText(prepareText(s), columns)) b.line(line);
  };

  text(words.title);
  b.line();
  text(printerName);
  text(`${printer.paperWidth} · ${printer.resolution}`);
  text(
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(
      now,
    ),
  );
  b.line();
  text(PRINTER_TEST_SAMPLE_TEXT);
  b.line();
  b.line(`|${"-".repeat(columns - 2)}|`);
  b.line();

  const matrix = qrModules(PRINTER_TEST_PAGE_QR_TEXT);
  const dots = chooseQrDots(
    matrix.length,
    dpiValue(printer.resolution),
    safeWidthDots(printer.paperWidth),
  );
  b.qrRaster(withQuietZone(matrix, QR_QUIET_ZONE), { moduleSize: dots });
  b.line();
  text(words.verdict);

  return b.align("left").feedAndCut().bytes();
}
