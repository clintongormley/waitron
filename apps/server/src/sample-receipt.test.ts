import { describe, expect, it } from "vitest";
import { formatSampleReceipt } from "./sample-receipt.js";
import { printedLines } from "./testing/decode-ticket.js";

describe("formatSampleReceipt", () => {
  it.each([
    ["80mm", 369, 47],
    ["58mm", 328, 41],
  ] as const)(
    "prints the largest fitting sample QR on %s paper at 203 dpi",
    (paperWidth, height, stride) => {
      const bytes = formatSampleReceipt({
        paperWidth,
        resolution: "203dpi",
        characterSet: "wpc1252",
        characterTable: 6,
      });
      const at = bytes.findIndex((_, i) =>
        [0x1d, 0x76, 0x30, 0].every((v, j) => bytes[i + j] === v),
      );
      expect(at).toBeGreaterThan(0);
      expect(bytes[at + 4]! + 256 * bytes[at + 5]!).toBe(stride);
      expect(bytes[at + 6]! + 256 * bytes[at + 7]!).toBe(height);
    },
  );

  it("uses the selected table and prints an unmistakably simulated realistic receipt", () => {
    const bytes = formatSampleReceipt({
      paperWidth: "80mm",
      resolution: "203dpi",
      characterSet: "wpc1252",
      characterTable: 6,
    });
    expect([...bytes.slice(0, 7)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 6, 0x1c, 0x2e]);
    const text = printedLines(bytes).join("\n");
    expect(text.match(/PRUEBA - SIN COBRO REAL/g)).toHaveLength(2);
    expect(text).toContain("Café y tostada");
    expect(text).toContain("5,50 €");
    expect(text).toContain("MUESTRA/1");
  });
});
