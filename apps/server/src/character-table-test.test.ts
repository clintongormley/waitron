import { describe, expect, it } from "vitest";
import { encodeText } from "@waitron/printing";
import { bytesInclude } from "./testing/decode-ticket.js";
import { formatCharacterTableTest } from "./character-table-test.js";

function printableLineWidths(bytes: Uint8Array): number[] {
  const widths: number[] = [];
  let width = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      widths.push(width);
      width = 0;
    } else if (bytes[i] === 0x1b && bytes[i + 1] === 0x40) i += 1;
    else if (bytes[i] === 0x1b && [0x64, 0x74].includes(bytes[i + 1]!)) i += 2;
    else if (bytes[i] === 0x1c && bytes[i + 1] === 0x2e) i += 1;
    else if (bytes[i] === 0x1d && bytes[i + 1] === 0x56) i += 2;
    else if (bytes[i]! >= 0x20) width++;
  }
  return widths;
}

describe("formatCharacterTableTest", () => {
  it("prints sixteen numbered tables with both supported encodings", () => {
    const bytes = formatCharacterTableTest({ startTable: 6, locale: "en-GB" });
    expect(
      bytesInclude(
        bytes,
        Uint8Array.from([0x1b, 0x74, 6, ...encodeText("T006 W: Café", "wpc1252")]),
      ),
    ).toBe(true);
    expect(
      bytesInclude(bytes, Uint8Array.from([0x1b, 0x74, 6, ...encodeText("T006 8: Café", "pc858")])),
    ).toBe(true);
    expect(
      bytesInclude(
        bytes,
        Uint8Array.from([0x1b, 0x74, 21, ...encodeText("T021 8: Café", "pc858")]),
      ),
    ).toBe(true);
  });

  it("prints a complete final block and keeps every English and Spanish line within 58mm", () => {
    for (const locale of ["en-GB", "es-ES"] as const) {
      const bytes = formatCharacterTableTest({ startTable: 250, locale });
      const raw = Buffer.from(bytes).toString("latin1");
      expect(raw.match(/T\d{3} W:/g)).toHaveLength(16);
      expect(
        bytesInclude(
          bytes,
          Uint8Array.from([0x1b, 0x74, 240, ...encodeText("T240 W: Café", "wpc1252")]),
        ),
      ).toBe(true);
      expect(
        bytesInclude(
          bytes,
          Uint8Array.from([0x1b, 0x74, 255, ...encodeText("T255 8: Café", "pc858")]),
        ),
      ).toBe(true);
      expect(raw).toContain(locale === "es-ES" ? "BUSCADOR DE TABLAS" : "CHARACTER TABLE FINDER");
      for (const width of printableLineWidths(bytes)) expect(width).toBeLessThanOrEqual(30);
    }
  });

  it("rejects a batch that starts outside the byte range", () => {
    expect(() => formatCharacterTableTest({ startTable: -1, locale: "en-GB" })).toThrow(RangeError);
    expect(() => formatCharacterTableTest({ startTable: 256, locale: "en-GB" })).toThrow(
      RangeError,
    );
  });
});
