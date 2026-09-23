import { describe, expect, it } from "vitest";
import { FALLBACK_LOCALE, SUPPORTED_LOCALES } from "@waitron/shared";
import {
  characterCalibration,
  characterEncodingName,
  characterFinderOptions,
  characterSetOptions,
  testCharsetSamples,
} from "./test-page-samples.js";
import {
  PC858_TO_UNICODE,
  WPC1252_TO_UNICODE,
  decodeBytes,
  encodeText,
  prepareText,
  selectCharacterTable,
} from "./charset.js";

describe("selectCharacterTable", () => {
  it("builds ESC t for any byte-sized printer table number", () => {
    expect(selectCharacterTable(6)).toEqual([0x1b, 0x74, 6]);
    expect(selectCharacterTable(255)).toEqual([0x1b, 0x74, 255]);
    expect(() => selectCharacterTable(-1)).toThrow(RangeError);
    expect(() => selectCharacterTable(256)).toThrow(RangeError);
    expect(() => selectCharacterTable(1.5)).toThrow(RangeError);
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

describe("prepareText / encodeText", () => {
  it("maps compact finder codes to both printer settings across selected blocks", () => {
    const first = characterFinderOptions("es-ES", 0);
    expect(first).toHaveLength(32);
    expect(first[0]).toEqual({ code: "T0W", characterSet: "wpc1252", characterTable: 0 });
    expect(first.find(({ code }) => code === "T68")).toEqual({
      code: "T68",
      characterSet: "pc858",
      characterTable: 6,
    });
    expect(first.at(-1)?.code).toBe("T158");
    const last = characterFinderOptions("en-GB", 240);
    expect(last[0]?.code).toBe("T240W");
    expect(last.at(-1)?.code).toBe("T2558");
    const unaligned = characterFinderOptions("es-ES", 5);
    expect(unaligned[0]?.code).toBe("T5W");
    expect(unaligned.at(-1)?.code).toBe("T208");
    expect(() => characterFinderOptions("en-GB", -1)).toThrow(RangeError);
    expect(() => characterFinderOptions("en-GB", 256)).toThrow(RangeError);
  });

  it("probes Spanish receipt glyphs and bytes that separate the offered encodings", () => {
    for (const { code } of SUPPORTED_LOCALES) {
      const { finderSampleLines, finderEncodings } = characterCalibration(code);
      expect(finderSampleLines).toHaveLength(2);
      for (const { characterSet } of finderEncodings) {
        const printed = finderSampleLines.map((line) => prepareText(line, characterSet)).join(" ");
        for (const glyph of "áéíóúÁÉÍÓÚñÑüÜ¿¡€£çÇ") expect(printed).toContain(glyph);
      }
      expect(encodeText("€", "wpc1252")).toEqual([0x80]);
      expect(encodeText("€", "pc858")).toEqual([0xd5]);
      expect(prepareText(finderSampleLines[1]!, "wpc1252")).toContain("“ ” ‘ ’");
      expect(prepareText(finderSampleLines[1]!, "pc858")).toContain("\" \" ' '");
    }
  });

  it("keeps accents and the euro sign in wpc1252 and pc858", () => {
    expect(encodeText("Café", "wpc1252")).toEqual([0x43, 0x61, 0x66, 0xe9]);
    expect(encodeText("€", "wpc1252")).toEqual([0x80]);
    expect(encodeText("€", "pc858")).toEqual([0xd5]);
    expect(encodeText("é", "pc858")).toEqual([0x82]);
  });

  it("transliterates for plain letters", () => {
    expect(prepareText("Café jamón Ñ ¿ ¡ ç € año", "plain")).toBe("Cafe jamon N ? ! c EUR ano");
  });

  it("falls the × badge and · separator back to ASCII only where the set lacks them", () => {
    // The receipt emits × (U+00D7, the per-dish option badge) and · (U+00B7, the order-label
    // separator). wpc1252 and pc858 encode both natively, so `prepareText` keeps the glyph there; the
    // plain set cannot, so it takes the ASCII fallback rather than `?`.
    expect(prepareText("×", "wpc1252")).toBe("×");
    expect(prepareText("·", "wpc1252")).toBe("·");
    expect(prepareText("×", "pc858")).toBe("×");
    expect(prepareText("·", "pc858")).toBe("·");
    expect(prepareText("×", "plain")).toBe("x");
    expect(prepareText("·", "plain")).toBe("-");
  });

  it("round-trips the numbered test-page samples through their character sets", () => {
    for (const { code } of SUPPORTED_LOCALES) {
      const samples = testCharsetSamples(code);
      expect(samples).toEqual([
        { value: "1", characterSet: "wpc1252", characterTable: 6, text: "Café jamón Ñ ¿¡ ç ü 5 €" },
        {
          value: "2",
          characterSet: "wpc1252",
          characterTable: 16,
          text: "Café jamón Ñ ¿¡ ç ü 5 €",
        },
        { value: "3", characterSet: "pc858", characterTable: 19, text: "Café jamón Ñ ¿¡ ç ü 5 €" },
        { value: "4", characterSet: "plain", characterTable: 0, text: "Cafe jamon N ?! c u 5 EUR" },
      ]);
      expect(characterCalibration(code).finderEncodings.map(({ label }) => label)).toEqual([
        "W",
        "8",
      ]);
      const options = characterSetOptions(code);
      expect(options.map(({ value }) => value)).toEqual(["wpc1252", "pc858", "plain"]);
      expect(options[0]!.label).toContain(code === "es-ES" ? "Latino occidental" : "Western Latin");
      for (const { value, characterSet: cs, text } of samples) {
        const sample = `${value}: ${text}`;
        expect(prepareText(sample, cs)).toBe(sample);
        expect(decodeBytes(encodeText(sample, cs), cs)).toBe(sample);
      }
    }
  });

  it("uses typographic fallbacks only where the set lacks the character", () => {
    const text =
      "\u{2018}a\u{2019} \u{201c}b\u{201d} c\u{2013}d e\u{2014}f g\u{2026} 1º 2ª x\u{a0}y z\u{202f}w";
    expect(prepareText(text, "wpc1252")).toBe(
      "\u{2018}a\u{2019} \u{201c}b\u{201d} c\u{2013}d e\u{2014}f g\u{2026} 1º 2ª x\u{a0}y z w",
    );
    expect(prepareText(text, "pc858")).toBe("'a' \"b\" c-d e-f g... 1º 2ª x\u{a0}y z w");
    expect(prepareText(text, "plain")).toBe("'a' \"b\" c-d e-f g... 1o 2a x y z w");
  });

  it("strips an accent the set lacks, and prints ? when that is not enough", () => {
    expect(prepareText("Łódź", "wpc1252")).toBe("?ódz");
    expect(prepareText("Łódź", "pc858")).toBe("?ódz");
    expect(prepareText("Łódź", "plain")).toBe("?odz");
    expect(prepareText("ệ", "pc858")).toBe("e");
    expect(prepareText("中", "wpc1252")).toBe("?");
  });

  it("normalises decomposed input before measuring", () => {
    expect(prepareText("Cafe\u{0301}", "pc858")).toBe("Caf\u{e9}");
  });

  it("gives one byte per prepared character in every set", () => {
    const text = "Café 👍 € \u{2018}x\u{2019} Łódź 中 ×2 · 12\u{a0}€";
    for (const cs of ["wpc1252", "pc858", "plain"] as const) {
      const prepared = prepareText(text, cs);
      const bytes = encodeText(text, cs);
      expect(bytes).toHaveLength([...prepared].length);
      expect(bytes).toHaveLength(prepared.length);
      expect(decodeBytes(bytes, cs)).toBe(prepared);
    }
  });

  it("maps control characters to spaces in every set", () => {
    for (const cs of ["wpc1252", "pc858", "plain"] as const) {
      const prepared = prepareText("a\nb\tc\u{1b}@\u{7f}", cs);
      expect(prepared).toBe("a b c @ ");
      const bytes = encodeText("a\nb\tc\u{1b}@\u{7f}", cs);
      expect(bytes).toHaveLength(prepared.length);
    }
  });
});

describe("calibration locale resolution", () => {
  it("resolves a regional or bare language code to the supported locale sharing its language", () => {
    const labels = (locale: string) => characterSetOptions(locale).map(({ label }) => label);
    expect(labels("es-MX")).toEqual(labels("es-ES"));
    expect(labels("es")).toEqual(labels("es-ES"));
    expect(labels("es-MX")[0]).toContain("Latino occidental");
  });

  it("falls back to the fallback locale for a language no locale supports", () => {
    const labels = (locale: string) => characterSetOptions(locale).map(({ label }) => label);
    expect(labels("fr-FR")).toEqual(labels(FALLBACK_LOCALE));
    expect(labels("fr-FR")[0]).toContain("Western Latin");
  });
});

describe("characterEncodingName", () => {
  it("names each character set by its technical encoding", () => {
    expect(characterEncodingName("wpc1252")).toBe("Windows-1252");
    expect(characterEncodingName("pc858")).toBe("PC858");
    expect(characterEncodingName("plain")).toBe("Plain");
  });
});
