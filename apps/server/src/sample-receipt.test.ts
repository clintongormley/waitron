import { describe, expect, it } from "vitest";
import { formatSampleReceipt } from "./sample-receipt.js";
import { printedLines } from "./testing/decode-ticket.js";

describe("formatSampleReceipt", () => {
  it("uses the selected table and prints an unmistakably simulated realistic receipt", () => {
    const bytes = formatSampleReceipt({
      paperWidth: "80mm",
      resolution: "203dpi",
      characterSet: "wpc1252",
      characterTable: 6,
    });
    expect([...bytes.slice(0, 7)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 6, 0x1c, 0x2e]);
    const text = printedLines(bytes).join("\n");
    expect(text).toContain("PRUEBA - SIN COBRO REAL");
    expect(text).toContain("Café y tostada");
    expect(text).toContain("5,50 €");
    expect(text).toContain("MUESTRA/1");
  });
});
