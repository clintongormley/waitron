import { describe, expect, it } from "vitest";
import { formatSampleReceipt } from "./sample-receipt.js";
import { printedCommands, printedLines } from "./testing/decode-ticket.js";

describe("formatSampleReceipt", () => {
  it.each([
    ["80mm", 369, 47],
    ["58mm", 328, 41],
  ] as const)(
    "prints the largest fitting sample QR on %s paper at 203 dpi",
    (paperWidth, height, stride) => {
      const bytes = formatSampleReceipt({ paperWidth, resolution: "203dpi" });
      const qr = printedCommands(bytes).find((c) => c.name === "GS v 0" && c.text === undefined);
      expect(qr).toBeDefined();
      expect(qr!.widthDots).toBe(stride * 8);
      expect(qr!.heightDots).toBe(height);
    },
  );

  it("draws at the selected setting and prints an unmistakably simulated realistic receipt", () => {
    const bytes = formatSampleReceipt({ paperWidth: "80mm", resolution: "203dpi" });
    const commands = printedCommands(bytes);
    expect(commands.map((c) => c.name)).not.toContain("ESC t");
    expect(commands.map((c) => c.name)).not.toContain("FS .");
    const lines = commands.filter((c) => c.text !== undefined);
    for (const line of lines) expect(line.widthDots).toBe(576);
    const text = printedLines(bytes).join("\n");
    expect(text.match(/PRUEBA - SIN COBRO REAL/g)).toHaveLength(2);
    expect(text).toContain("Café y tostada");
    expect(text).toContain("5,50 €");
    expect(text).toContain("MUESTRA/1");
    expect(text).toContain("Café, jamón, niño, pingüino · 5 €");
  });
});
