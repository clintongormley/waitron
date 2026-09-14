import { describe, expect, it } from "vitest";
import { CHARSET_SELECT, PC858_TO_UNICODE, WPC1252_TO_UNICODE, decodeBytes } from "./charset.js";

describe("CHARSET_SELECT", () => {
  it("selects table 16 for wpc1252, 19 for pc858, nothing for plain", () => {
    expect([...CHARSET_SELECT.wpc1252]).toEqual([0x1b, 0x74, 16]);
    expect([...CHARSET_SELECT.pc858]).toEqual([0x1b, 0x74, 19]);
    expect([...CHARSET_SELECT.plain]).toEqual([]);
  });
});

describe("decode tables", () => {
  it("matches the WHATWG windows-1252 decoder for every byte", () => {
    const reference = new TextDecoder("windows-1252");
    for (let b = 0; b <= 0xff; b++) {
      expect(String.fromCodePoint(WPC1252_TO_UNICODE[b]!), `byte ${b}`).toBe(
        reference.decode(Uint8Array.of(b)),
      );
    }
  });

  it("pins the code page 858 positions receipts and the test page use", () => {
    const pins: [number, string][] = [
      [0x80, "Ç"],
      [0x81, "ü"],
      [0x82, "é"],
      [0x87, "ç"],
      [0x9e, "×"],
      [0xa0, "á"],
      [0xa1, "í"],
      [0xa2, "ó"],
      [0xa3, "ú"],
      [0xa4, "ñ"],
      [0xa5, "Ñ"],
      [0xa6, "ª"],
      [0xa7, "º"],
      [0xa8, "¿"],
      [0xad, "¡"],
      [0xd5, "€"],
      [0xfa, "·"],
      [0xff, "\u{a0}"],
    ];
    for (const [byte, ch] of pins) expect(decodeBytes([byte], "pc858"), `byte ${byte}`).toBe(ch);
    for (let b = 0; b < 0x80; b++) expect(PC858_TO_UNICODE[b]).toBe(b);
  });

  it("maps every byte of each table to a distinct character", () => {
    expect(new Set(WPC1252_TO_UNICODE).size).toBe(256);
    expect(new Set(PC858_TO_UNICODE).size).toBe(256);
  });

  it("decodes plain as Latin-1", () => {
    expect(decodeBytes([0x41, 0x42, 0xe9], "plain")).toBe("ABé");
  });
});
