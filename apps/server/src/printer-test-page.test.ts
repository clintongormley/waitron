import { describe, expect, it } from "vitest";
import {
  QR_QUIET_ZONE,
  chooseQrDots,
  dpiValue,
  esc,
  safeWidthDots,
  withQuietZone,
  type EscSetting,
} from "@waitron/printing";
import { formatPrinterTestPage, PRINTER_TEST_PAGE_QR_TEXT } from "./printer-test-page.js";
import { qrModules } from "./qr-matrix.js";
import {
  bytesInclude,
  commandNames,
  opensDrawer,
  printedCommands,
  printedLines,
} from "./testing/decode-ticket.js";

// 13:05 UTC is 14:05 in the Canaries and 15:05 in Madrid, so the hour shows which zone was used.
const NOW = new Date("2026-10-01T13:05:00.000Z");
const PRINTER_80: EscSetting = { paperWidth: "80mm", resolution: "203dpi" };
const PRINTER_58: EscSetting = { paperWidth: "58mm", resolution: "180dpi" };

function page(locale: "en-GB" | "es-ES", printer: EscSetting = PRINTER_80): Uint8Array {
  return formatPrinterTestPage({
    locale,
    printer,
    printerName: "Barra Epson",
    now: NOW,
    timeZone: "Atlantic/Canary",
  });
}

/** The printed words as one run of text, so a sentence wrapped over two lines still matches. */
function words(bytes: Uint8Array): string {
  return printedLines(bytes)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
}

describe("formatPrinterTestPage", () => {
  it.each([
    [
      "en-GB",
      "Test page",
      "1 Oct 2026, 14:05",
      "If this is centred and readable, this printer is set up correctly.",
    ],
    [
      "es-ES",
      "Página de prueba",
      "1 oct 2026, 14:05",
      "Si esto sale centrado y legible, la impresora está bien configurada.",
    ],
  ] as const)("prints its %s words", (locale, title, dateTime, bottom) => {
    const text = words(page(locale));
    expect(text).toContain(title);
    expect(text).toContain("Barra Epson");
    expect(text).toContain("80mm · 203dpi");
    expect(text).toContain(dateTime);
    expect(text).toContain("Café, jamón, niño · 5 € · ¿Sí? ¡Sí!");
    expect(text).toContain(bottom);
    expect(text.indexOf(title)).toBeLessThan(text.indexOf(bottom));
  });

  it("shows the date and time in the time zone it is given", () => {
    const madrid = formatPrinterTestPage({
      locale: "en-GB",
      printer: PRINTER_80,
      printerName: "Barra Epson",
      now: NOW,
      timeZone: "Europe/Madrid",
    });
    expect(words(madrid)).toContain("1 Oct 2026, 15:05");
  });

  it.each([
    [PRINTER_58, 360, 30],
    [{ paperWidth: "58mm", resolution: "203dpi" } as const, 384, 30],
    [{ paperWidth: "80mm", resolution: "180dpi" } as const, 512, 42],
    [PRINTER_80, 576, 42],
  ])("draws every line at the printer's width: %o", (printer, widthDots, columns) => {
    const bytes = page("en-GB", printer);
    const lines = printedCommands(bytes).filter((command) => command.text !== undefined);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.widthDots).toBe(widthDots);
    expect(printedLines(bytes)).toContain(`|${"-".repeat(columns - 2)}|`);
  });

  it("sets a print area as wide as its lines, as the receipt does", () => {
    const bytes = page("en-GB", PRINTER_58);
    expect([...bytes.slice(0, 10)]).toEqual([
      0x1b, 0x40, 0x1d, 0x4c, 0x00, 0x00, 0x1d, 0x57, 0x68, 0x01,
    ]);
  });

  it.each([PRINTER_58, PRINTER_80])(
    "prints the non-fiscal QR sized the way the receipt sizes its own: %o",
    (printer) => {
      const bytes = page("es-ES", printer);
      const matrix = qrModules(PRINTER_TEST_PAGE_QR_TEXT);
      const dots = chooseQrDots(
        matrix.length,
        dpiValue(printer.resolution),
        safeWidthDots(printer.paperWidth),
      );
      const qr = esc().qrRaster(withQuietZone(matrix, QR_QUIET_ZONE), { moduleSize: dots }).bytes();
      expect(bytesInclude(bytes, qr)).toBe(true);
      expect(PRINTER_TEST_PAGE_QR_TEXT).not.toMatch(/aeat|agenciatributaria/i);
    },
  );

  it("never opens a cash drawer, and ends by feeding and cutting", () => {
    for (const locale of ["en-GB", "es-ES"] as const) {
      for (const printer of [PRINTER_58, PRINTER_80]) {
        const bytes = page(locale, printer);
        expect(opensDrawer(bytes)).toBe(false);
        expect(commandNames(bytes).slice(-2)).toEqual(["ESC d", "GS V"]);
      }
    }
  });
});
