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
  it("initializes and cancels Kanji mode before selecting each candidate line's table", () => {
    const bytes = formatCharacterTableTest({ startTable: 0, locale: "en-GB" });
    let selections = 0;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] !== 0x1b || bytes[i + 1] !== 0x74) continue;
      expect(Array.from(bytes.slice(i - 4, i))).toEqual([0x1b, 0x40, 0x1c, 0x2e]);
      expect(bytes[i + 2]).toBe(Math.floor(selections / 4));
      selections++;
    }
    expect(selections).toBe(64);
  });

  it("selects only the candidate table before each line, without a preceding table-zero reset", () => {
    const bytes = formatCharacterTableTest({ startTable: 6, locale: "en-GB" });
    expect(bytesInclude(bytes, Uint8Array.from([0x1b, 0x74, 0]))).toBe(false);
    for (const [characterSet, line] of [
      ["wpc1252", "W-11 áéíóú ÁÉÍÓÚ ñÑ üÜ"],
      ["wpc1252", "     ¿¡ € £ çÇ “ ” ‘ ’"],
      ["pc858", "8-11 áéíóú ÁÉÍÓÚ ñÑ üÜ"],
      ["pc858", "     ¿¡ € £ çÇ \" \" ' '"],
    ] as const) {
      expect(
        bytesInclude(bytes, Uint8Array.from([0x1b, 0x74, 11, ...encodeText(line, characterSet)])),
      ).toBe(true);
    }
  });

  it("prints sixteen numbered tables with both supported encodings", () => {
    const bytes = formatCharacterTableTest({ startTable: 6, locale: "en-GB" });
    expect(
      bytesInclude(
        bytes,
        Uint8Array.from([0x1b, 0x74, 6, ...encodeText("W-06 áéíóú ÁÉÍÓÚ ñÑ üÜ", "wpc1252")]),
      ),
    ).toBe(true);
    expect(
      bytesInclude(
        bytes,
        Uint8Array.from([0x1b, 0x74, 6, ...encodeText("     ¿¡ € £ çÇ “ ” ‘ ’", "wpc1252")]),
      ),
    ).toBe(true);
    expect(
      bytesInclude(
        bytes,
        Uint8Array.from([0x1b, 0x74, 21, ...encodeText("8-21 áéíóú ÁÉÍÓÚ ñÑ üÜ", "pc858")]),
      ),
    ).toBe(true);
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).not.toContain("W-00");
    expect(raw.match(/W-\d{2}/g)).toHaveLength(16);
    expect(raw.match(/8-\d{2}/g)).toHaveLength(16);
  });

  it("prints a complete final block and keeps every English and Spanish line within 58mm", () => {
    for (const locale of ["en-GB", "es-ES"] as const) {
      const bytes = formatCharacterTableTest({ startTable: 250, locale });
      const raw = Buffer.from(bytes).toString("latin1");
      expect(raw.match(/W-\d{3}/g)).toHaveLength(16);
      expect(
        bytesInclude(
          bytes,
          Uint8Array.from([0x1b, 0x74, 240, ...encodeText("W-240 áéíóú ÁÉÍÓÚ ñÑ üÜ", "wpc1252")]),
        ),
      ).toBe(true);
      expect(
        bytesInclude(
          bytes,
          Uint8Array.from([0x1b, 0x74, 255, ...encodeText("      ¿¡ € £ çÇ \" \" ' '", "pc858")]),
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
