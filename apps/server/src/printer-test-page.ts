/**
 * The page a printer's row menu prints: its name and saved layout, the venue's date and time, a line
 * of accented text, a rule across the text grid's two edges and a QR, drawn at the printer's saved
 * setting. Not the calibration ruler page, which is `test-page.ts`.
 */
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
import { qrModules } from "./qr-matrix.js";

/** Fixed sample content, not a tax-agency link, so scanning it submits nothing. */
export const PRINTER_TEST_PAGE_QR_TEXT = "Waitron test page";

const SAMPLE_TEXT = "Café, jamón, niño · 5 € · ¿Sí? ¡Sí!";

const WORDS: Readonly<Record<SupportedLocale, { title: string; verdict: string }>> = {
  "en-GB": {
    title: "Test page",
    verdict: "If this is centred and readable, this printer is set up correctly.",
  },
  "es-ES": {
    title: "Página de prueba",
    verdict: "Si esto sale centrado y legible, la impresora está bien configurada.",
  },
};

export interface PrinterTestPageInput {
  locale: SupportedLocale;
  /** The printer's SAVED setting, which sizes the lines, the print area and the QR. */
  printer: EscSetting;
  printerName: string;
  now: Date;
  /** The venue's time zone, which the printed date and time are shown in. */
  timeZone: string;
}

export function formatPrinterTestPage({
  locale,
  printer,
  printerName,
  now,
  timeZone,
}: PrinterTestPageInput): Uint8Array {
  const words = WORDS[locale];
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
  text(SAMPLE_TEXT);
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
