import { encodeText } from "@waitron/printing";
import { describe, expect, it } from "vitest";
import { formatTestPage } from "./test-page.js";
import { bytesInclude, printedLines } from "./testing/decode-ticket.js";

/** Every GS v 0 image header in `bytes`: width in bytes per row and height in dots. */
function rasterHeaders(bytes: Uint8Array): { widthBytes: number; heightDots: number }[] {
  const headers: { widthBytes: number; heightDots: number }[] = [];
  for (let i = 0; i + 8 <= bytes.length; i++) {
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30 && bytes[i + 3] === 0) {
      const widthBytes = bytes[i + 4]! + 256 * bytes[i + 5]!;
      const heightDots = bytes[i + 6]! + 256 * bytes[i + 7]!;
      headers.push({ widthBytes, heightDots });
      i += 7 + widthBytes * heightDots;
    }
  }
  return headers;
}

describe("formatTestPage", () => {
  it("prints width lines of exactly 30, 32, 42 and 48 characters ending in |", () => {
    const lines = printedLines(formatTestPage({ locale: "es-ES" }));
    for (const [label, length] of [
      ["A", 30],
      ["B", 32],
      ["C", 42],
      ["D", 48],
    ] as const) {
      const line = lines.find((l) => l.startsWith(`${label} -`));
      expect(line, label).toBe(`${label} ${"-".repeat(length - 3)}|`);
      expect(line).toHaveLength(length);
    }
  });

  it("wraps every caption to 30 columns", () => {
    for (const locale of ["es-ES", "en-GB"] as const) {
      const lines = printedLines(formatTestPage({ locale })).filter((l) => !/^[BCD] -/.test(l));
      for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(30);
    }
  });

  it("prints two QR samples: 45 squares at 5 dots and 53 squares at 6 dots, each within 360 dots", () => {
    const headers = rasterHeaders(formatTestPage({ locale: "es-ES" }));
    expect(headers).toEqual([
      { widthBytes: 34, heightDots: (45 + 8) * 5 },
      { widthBytes: 45, heightDots: (53 + 6) * 6 },
    ]);
    for (const { widthBytes } of headers) expect(widthBytes * 8).toBeLessThanOrEqual(360);
  });

  it("sends each sample line in its own character table, and each reads correctly", () => {
    const bytes = formatTestPage({ locale: "en-GB" });
    expect(
      bytesInclude(bytes, Uint8Array.from([0x1b, 0x74, 16, ...encodeText("1: Café", "wpc1252")])),
    ).toBe(true);
    expect(
      bytesInclude(bytes, Uint8Array.from([0x1b, 0x74, 19, ...encodeText("2: Café", "pc858")])),
    ).toBe(true);
    const lines = printedLines(bytes);
    expect(lines).toContain("1: Café jamón Ñ ¿¡ ç ü 5 €");
    expect(lines).toContain("2: Café jamón Ñ ¿¡ ç ü 5 €");
    expect(lines).toContain("3: Cafe jamon N ?! c u 5 EUR");
  });

  it("prints its captions in the venue language, as ASCII", () => {
    const es = printedLines(formatTestPage({ locale: "es-ES" })).join(" ");
    const en = printedLines(formatTestPage({ locale: "en-GB" })).join(" ");
    expect(es).toContain("Cual es la linea mas larga");
    expect(es).not.toContain("Which");
    expect(en).toContain("Which is the longest line");
    expect(en).not.toContain("Cual");
    const bytes = formatTestPage({ locale: "es-ES" });
    const beforeFirstImage = bytes.subarray(0, bytes.indexOf(0x1d));
    expect([...beforeFirstImage].every((b) => b < 0x80)).toBe(true);
  });
});
