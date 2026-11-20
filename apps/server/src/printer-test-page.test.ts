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
import { formatPrinterTestPage, type PrinterTestPageInput } from "./printer-test-page.js";
import { qrModules } from "./qr-matrix.js";
import { formatAmount, formatMoney, formatVatRate } from "./receipt-money.js";
import { receiptLabelsFor } from "@waitron/country-packs";
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
const QR_WORDS = { caption: "QR tributario:", legend: "VERI*FACTU" };

function page(overrides: Partial<PrinterTestPageInput> = {}): Uint8Array {
  return formatPrinterTestPage({
    issuer: { venueName: "Santet Deli S.L.", nif: "B12345678" },
    receipt: {},
    receiptHeader: { tradingName: "Deli", printTradingName: true },
    printer: PRINTER_58,
    printerName: "Front Epson",
    now: NOW,
    timeZone: "Atlantic/Canary",
    receiptLocale: "en-GB",
    qrText: QR_WORDS,
    practice: false,
    ...overrides,
  });
}

function lines(bytes: Uint8Array): string[] {
  return printedLines(bytes)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^-+$/.test(line));
}

function qrBytes(printer: EscSetting): Uint8Array {
  const matrix = qrModules("https://example.invalid/waitron/sample-receipt");
  const dots = chooseQrDots(
    matrix.length,
    dpiValue(printer.resolution),
    safeWidthDots(printer.paperWidth),
  );
  return esc().qrRaster(withQuietZone(matrix, QR_QUIET_ZONE), { moduleSize: dots }).bytes();
}

describe("formatPrinterTestPage", () => {
  it("prints the venue's header, the sample sale and the test marker at the top and bottom", () => {
    const printed = lines(page());
    expect(printed).toContain("Deli");
    expect(printed).toContain("Santet Deli S.L.");
    expect(printed).toContain("NIF: B12345678");
    expect(printed).toContain("QR tributario:");
    expect(printed).toContain("VERI*FACTU");
    expect(printed.some((line) => /^Outside 6 +Order 41$/.test(line))).toBe(true);
    expect(printed.some((line) => /^MUESTRA\/1 +01\/10\/2026 14:05$/.test(line))).toBe(true);
    expect(printed.some((line) => /^1 +Coffee and toast +5\.50$/.test(line))).toBe(true);
    expect(printed.some((line) => /^TOTAL +€5\.50$/.test(line))).toBe(true);
    expect(printed.some((line) => /^Change +€4\.50$/.test(line))).toBe(true);
    expect(printed.filter((line) => line === "TEST — not an invoice")).toHaveLength(2);
    expect(printed.indexOf("TEST — not an invoice")).toBeLessThan(
      printed.indexOf("QR tributario:"),
    );
    expect(printed.at(-2)).toBe("TEST — not an invoice");
    expect(printed.at(-1)).toBe("Front Epson · 58mm · 180dpi");
    expect(printed).not.toContain("TEST DOCUMENT");
  });

  it("prints the VAT table of the sample sale", () => {
    const printed = lines(page());
    expect(printed.some((line) => /^Rate +Base +VAT +Total$/.test(line))).toBe(true);
    expect(printed.some((line) => /^10% +5\.00 +0\.50 +5\.50$/.test(line))).toBe(true);
  });

  it("prints the sample dishes, VAT and marker in the receipt language", () => {
    const printed = lines(page({ receiptLocale: "es-ES" }));
    expect(printed.filter((line) => line === "PRUEBA — no es una factura")).toHaveLength(2);
    expect(printed.some((line) => /^1 +Café y tostada +5,50$/.test(line))).toBe(true);
    expect(printed.some((line) => /^1 +Jamón con melón +2,20$/.test(line))).toBe(true);
    expect(printed.some((line) => /^TOTAL +9,90 €$/.test(line))).toBe(true);
    expect(printed.some((line) => /^10% +9,00 +0,90 +9,90$/.test(line))).toBe(true);
    expect(printed.some((line) => /^Cambio +0,10 €$/.test(line))).toBe(true);
    expect(printed.at(-1)).toBe("Front Epson · 58mm · 180dpi");
  });

  it.each([
    ["en-GB", ["Coffee and toast"], { total: "5.50", base: "5.00", tax: "0.50", change: "4.50" }],
    [
      "es-ES",
      ["Café y tostada", "Atún con piña", "Jamón con melón"],
      { total: "9.90", base: "9.00", tax: "0.90", change: "0.10" },
    ],
    [
      "ca-ES",
      ["Cafè i torrada", "Pa amb tomàquet", "Pastís de préssec"],
      { total: "9.90", base: "9.00", tax: "0.90", change: "0.10" },
    ],
    [
      "gl-ES",
      ["Café e torrada", "Polbo á feira", "Queixo do país"],
      { total: "9.90", base: "9.00", tax: "0.90", change: "0.10" },
    ],
    [
      "eu-ES",
      ["Kafea eta ogi txigortua", "Iruñeko txistorra"],
      { total: "7.70", base: "7.00", tax: "0.70", change: "2.30" },
    ],
  ] as const)(
    "prints at most three sale lines in %s, totalled, taxed and changed from those lines alone",
    (locale, names, sums) => {
      const labels = receiptLabelsFor(locale);
      const printed = lines(page({ printer: PRINTER_80, receiptLocale: locale })).map((line) =>
        line.replace(/ +/g, " "),
      );
      const amount = (value: string) => formatAmount(value, locale);
      expect(printed.filter((line) => line.startsWith("1 "))).toEqual(
        names.map((name, at) => `1 ${name} ${amount(at === 0 ? "5.50" : "2.20")}`),
      );
      expect(printed).toContain(`${labels.total} ${formatMoney(sums.total, locale)}`);
      expect(printed).toContain(
        `${formatVatRate("10", locale)} ${amount(sums.base)} ${amount(sums.tax)} ${amount(sums.total)}`,
      );
      expect(printed).toContain(`${labels.cash} ${formatMoney("10.00", locale)}`);
      expect(printed).toContain(`${labels.change} ${formatMoney(sums.change, locale)}`);
    },
  );

  it("prints no trading name the department does not print, and the practice marker too in practice", () => {
    const printed = lines(
      page({ receiptHeader: { tradingName: "Deli", printTradingName: false }, practice: true }),
    );
    expect(printed).not.toContain("Deli");
    expect(printed.filter((line) => line === "TEST DOCUMENT")).toHaveLength(2);
    expect(printed.filter((line) => line === "TEST — not an invoice")).toHaveLength(2);
  });

  it("dates the page now, in the time zone it is given, as an 80mm receipt prints it", () => {
    const canary = lines(page({ printer: PRINTER_80 }));
    expect(canary.some((line) => /^MUESTRA\/1 +1 Oct 2026, 14:05$/.test(line))).toBe(true);
    const madrid = lines(page({ printer: PRINTER_80, timeZone: "Europe/Madrid" }));
    expect(madrid.some((line) => /^MUESTRA\/1 +1 Oct 2026, 15:05$/.test(line))).toBe(true);
  });

  it.each([PRINTER_58, PRINTER_80])(
    "prints the sample QR sized the way the receipt sizes its own, only with QR words: %o",
    (printer) => {
      expect(bytesInclude(page({ printer }), qrBytes(printer))).toBe(true);
      const without = page({ printer, qrText: undefined });
      expect(bytesInclude(without, qrBytes(printer))).toBe(false);
      expect(lines(without)).not.toContain("VERI*FACTU");
    },
  );

  it.each([
    [PRINTER_58, 360],
    [{ paperWidth: "58mm", resolution: "203dpi" } as const, 384],
    [{ paperWidth: "80mm", resolution: "180dpi" } as const, 512],
    [PRINTER_80, 576],
  ])("draws every line at the printer's width: %o", (printer, widthDots) => {
    const commands = printedCommands(page({ printer })).filter(
      (command) => command.text !== undefined,
    );
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) expect(command.widthDots).toBe(widthDots);
  });

  it("never opens a cash drawer, and ends by feeding and cutting", () => {
    for (const printer of [PRINTER_58, PRINTER_80]) {
      const bytes = page({ printer });
      expect(opensDrawer(bytes)).toBe(false);
      expect(commandNames(bytes).slice(-2)).toEqual(["ESC d", "GS V"]);
    }
  });
});
