import { describe, expect, it } from "vitest";
import { formatSampleReceipt } from "./sample-receipt.js";
import { printedCommands, printedLines } from "./testing/decode-ticket.js";

const WORDS = { caption: "CAP-X", legend: "LEG-Y" };

describe("formatSampleReceipt", () => {
  it.each([
    ["80mm", 369, 47],
    ["58mm", 328, 41],
  ] as const)(
    "prints the largest fitting sample QR on %s paper at 203 dpi",
    (paperWidth, height, stride) => {
      const bytes = formatSampleReceipt({ paperWidth, resolution: "203dpi" }, WORDS);
      const qr = printedCommands(bytes).find((c) => c.name === "GS v 0" && c.text === undefined);
      expect(qr).toBeDefined();
      expect(qr!.widthDots).toBe(stride * 8);
      expect(qr!.heightDots).toBe(height);
    },
  );

  it("draws at the selected setting and prints an unmistakably simulated realistic receipt", () => {
    const bytes = formatSampleReceipt({ paperWidth: "80mm", resolution: "203dpi" }, undefined);
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

  it("puts the fiscal backend's words around the sample QR", () => {
    const bytes = formatSampleReceipt({ paperWidth: "80mm", resolution: "203dpi" }, WORDS);
    const drawn = printedCommands(bytes)
      .filter((c) => c.name === "GS v 0")
      .map((c) => (c.text === undefined ? "<QR>" : c.text.trim()));
    const qrAt = drawn.indexOf("<QR>");
    expect(drawn.slice(qrAt - 1, qrAt + 2)).toEqual(["CAP-X", "<QR>", "LEG-Y"]);
  });

  it("prints no QR, caption or legend for a venue whose fiscal backend gives no words", () => {
    const bytes = formatSampleReceipt({ paperWidth: "80mm", resolution: "203dpi" }, undefined);
    const commands = printedCommands(bytes);
    expect(commands.filter((c) => c.name === "GS v 0" && c.text === undefined)).toEqual([]);
    const text = printedLines(bytes).join("\n");
    expect(text).not.toContain("VERI*FACTU");
    expect(text).not.toContain("QR tributario");
    expect(text).toContain("MUESTRA/1");
  });
});
