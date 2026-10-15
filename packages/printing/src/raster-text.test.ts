import { describe, expect, it } from "vitest";
import { GLYPHS } from "./glyphs.js";
import { SETTING_WIDTHS, gridForWidth, textGrid } from "./layout.js";
import { TEXT_BAND_HEIGHT, drawTextBand, readRasterText, textBandHeight } from "./raster-text.js";
import { cellsFrom as at, expectedBand as band } from "../test/expected-band.js";

/** Characters drawn identically to an earlier one in the table, and the one the reader returns. */
const SAME_PICTURE: Readonly<Record<string, string>> = {
  "\u00a0": " ",
  "\u00ad": "-",
  "\u2013": "-",
  "\u0110": "\u00d0",
};

describe("drawTextBand", () => {
  it("is 28 dots tall", () => {
    expect(TEXT_BAND_HEIGHT).toBe(28);
  });

  it("draws each character's glyph in its cell from the grid's first dot", () => {
    expect([...drawTextBand("Café 5 €", textGrid("58mm", "203dpi"))]).toEqual(
      band(384, at("Café 5 €", 12)),
    );
    expect([...drawTextBand("Café 5 €", textGrid("80mm", "180dpi"))]).toEqual(
      band(512, at("Café 5 €", 4)),
    );
  });

  it("centres and right-aligns in whole cells", () => {
    const grid = textGrid("58mm", "180dpi");
    // 30 columns, 4 characters: centred from cell 13, right-aligned from cell 26.
    expect([...drawTextBand("Hola", grid, "center")]).toEqual(band(360, at("Hola", 13 * 12)));
    expect([...drawTextBand("Hola", grid, "right")]).toEqual(band(360, at("Hola", 26 * 12)));
    expect([...drawTextBand("Hol", grid, "center")]).toEqual(band(360, at("Hol", 13 * 12)));
  });

  it("cuts a line longer than the grid at the grid's last cell", () => {
    const grid = textGrid("80mm", "203dpi");
    const long = "x".repeat(40) + "ABCDE";
    const kept = long.slice(0, 42);
    for (const align of ["left", "center", "right"] as const) {
      expect([...drawTextBand(long, grid, align)]).toEqual(band(576, at(kept, 36)));
    }
  });

  it("draws an empty line as a blank band", () => {
    expect([...drawTextBand("", textGrid("58mm", "180dpi"))]).toEqual(new Array(45 * 28).fill(0));
  });

  it("draws text through prepareText, so a character the table lacks prints as its fallback", () => {
    expect([...drawTextBand("日\t", textGrid("58mm", "180dpi"))]).toEqual(band(360, at("?", 0)));
  });

  it("draws on a grid of any whole number of bytes", () => {
    expect([...drawTextBand("ab", gridForWidth(32))]).toEqual(band(32, at("ab", 4)));
  });

  it("refuses a grid whose width is not a whole number of bytes, which would not read back", () => {
    expect(() => drawTextBand("ab", gridForWidth(30))).toThrow(RangeError);
  });
});

describe("readRasterText", () => {
  const read = (text: string, widthDots: number, align?: "left" | "center" | "right") =>
    readRasterText(widthDots, TEXT_BAND_HEIGHT, drawTextBand(text, gridForWidth(widthDots), align));

  it.each([360, 384, 512, 576])(
    "reads back every character of the table at %i dots",
    (widthDots) => {
      const columns = gridForWidth(widthDots).columns;
      const all = GLYPHS.map(([codePoint]) => String.fromCodePoint(codePoint))
        .map((ch) => SAME_PICTURE[ch] ?? ch)
        .join("");
      for (let start = 0; start < all.length; start += columns) {
        const chunk = all.slice(start, start + columns);
        expect(read(chunk, widthDots)).toBe(chunk.trimEnd());
      }
    },
  );

  it("names exactly the characters drawn identically to another, and reads them as that one", () => {
    const seen = new Map<string, string>();
    const twins: Record<string, string> = {};
    for (const [codePoint, hex] of GLYPHS) {
      const ch = String.fromCodePoint(codePoint);
      const first = seen.get(hex);
      if (first === undefined) seen.set(hex, ch);
      else twins[ch] = first;
    }
    expect(twins).toEqual(SAME_PICTURE);
    for (const [ch, readAs] of Object.entries(SAME_PICTURE)) {
      expect(read(`a${ch}b`, 360)).toBe(`a${readAs}b`);
    }
  });

  it("keeps leading spaces and drops trailing ones", () => {
    expect(read("  Total  ", 384)).toBe("  Total");
    expect(read("Hola", 384, "center")).toBe(" ".repeat(13) + "Hola");
    expect(read("Hola", 512, "right")).toBe(" ".repeat(38) + "Hola");
  });

  it("reads a blank band as an empty line", () => {
    expect(read("", 576)).toBe("");
  });

  it("reads a band of a width outside the table on the grid of whole cells", () => {
    expect(read("abc", 400)).toBe("abc");
  });

  it("does not read a band that is neither 28 nor 56 dots tall", () => {
    expect(readRasterText(360, 27, new Uint8Array(45 * 27))).toBeUndefined();
  });

  it("does not read a band whose byte count does not match its size", () => {
    expect(readRasterText(360, 28, new Uint8Array(45 * 28 - 1))).toBeUndefined();
  });

  it("does not read a band with a cell that matches no glyph", () => {
    const data = drawTextBand("abc", gridForWidth(360));
    data[45 * 10 + 1] = 0xff;
    expect(readRasterText(360, 28, data)).toBeUndefined();
  });

  it("does not read a band with ink outside the grid's cells", () => {
    const left = drawTextBand("abc", gridForWidth(384));
    left[1] = 0x80; // row 0's second byte begins at dot 8, inside the 12-dot left margin
    expect(readRasterText(384, 28, left)).toBeUndefined();
    const right = drawTextBand("abc", gridForWidth(384));
    right[47] = 0x01; // the last dot of row 0, inside the right margin
    expect(readRasterText(384, 28, right)).toBeUndefined();
  });
});

describe("bold and double-size lines", () => {
  it.each(SETTING_WIDTHS)(
    "reads a bold line back as its text at $widthDots dots",
    ({ widthDots }) => {
      const grid = gridForWidth(widthDots);
      const band = drawTextBand("Santet Deli Co", grid, "center", { bold: true });
      expect(band).not.toEqual(drawTextBand("Santet Deli Co", grid, "center"));
      expect(readRasterText(widthDots, TEXT_BAND_HEIGHT, band)?.trim()).toBe("Santet Deli Co");
    },
  );

  it("reads every glyph back when drawn bold, the lowest code point winning a shared picture", () => {
    const grid = gridForWidth(512);
    const byPicture = new Map<string, string>();
    for (const [codePoint] of GLYPHS) {
      const ch = String.fromCodePoint(codePoint);
      const key = Buffer.from(drawTextBand(ch, grid, "left", { bold: true })).toString("hex");
      if (!byPicture.has(key)) byPicture.set(key, ch);
      const expected = byPicture.get(key)!;
      expect(readRasterText(512, TEXT_BAND_HEIGHT, Buffer.from(key, "hex")), ch).toBe(
        expected === " " ? "" : expected,
      );
    }
  });

  it.each(SETTING_WIDTHS)(
    "draws a double line 56 dots tall on half the cells at $widthDots",
    ({ widthDots }) => {
      const grid = gridForWidth(widthDots);
      expect(textBandHeight({ double: true })).toBe(56);
      const band = drawTextBand("TOTAL 407,00 €", grid, "left", { double: true });
      expect(band.length).toBe((widthDots / 8) * 56);
      expect(readRasterText(widthDots, 56, band)).toBe("TOTAL 407,00 €");
    },
  );

  it("cuts a double line at half the columns", () => {
    const grid = gridForWidth(360);
    const band = drawTextBand("TOTAL 10.000,00 €", grid, "left", { double: true });
    expect(readRasterText(360, 56, band)).toBe("TOTAL 10.000,00");
  });

  it("right-aligns a double line to the normal lines' right edge", () => {
    const grid = gridForWidth(512);
    const normal = drawTextBand("407,00 €".padStart(42), grid);
    const double = drawTextBand("407,00 €".padStart(21), grid, "left", { double: true });
    const lastInk = (data: Uint8Array, height: number) => {
      let last = -1;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < 512; x++)
          if (data[y * 64 + (x >> 3)]! & (0x80 >> (x & 7))) last = Math.max(last, x);
      return last;
    };
    // Both grids end at the same dot; the last cell is 12 dots wide normally and 24 doubled, so the
    // double line's last ink sits at twice the normal glyph's offset within its cell, plus one.
    const end = grid.offsetDots + grid.columns * 12;
    const offsetInCell = lastInk(normal, 28) - (end - 12);
    expect(lastInk(double, 56)).toBe(end - 24 + 2 * offsetInCell + 1);
  });

  it("reads a bold double line back as its text", () => {
    const band = drawTextBand("TOTAL 7,50 €", gridForWidth(384), "right", {
      bold: true,
      double: true,
    });
    expect(band).not.toEqual(
      drawTextBand("TOTAL 7,50 €", gridForWidth(384), "right", { double: true }),
    );
    expect(readRasterText(384, 56, band)?.trim()).toBe("TOTAL 7,50 €");
  });

  it("does not read a double line with a dot its 2×2 blocks do not explain", () => {
    const band = drawTextBand("TOTAL", gridForWidth(512), "left", { double: true });
    const grid = gridForWidth(512);
    const x = grid.offsetDots + 1;
    band[30 * 64 + (x >> 3)]! ^= 0x80 >> (x & 7);
    expect(readRasterText(512, 56, band)).toBeUndefined();
  });

  it("does not read a 56-dot picture that is not a double line", () => {
    expect(readRasterText(512, 56, new Uint8Array(64 * 56).fill(0xff))).toBeUndefined();
  });

  it("does not read a 56-dot picture whose width is not a whole number of bytes", () => {
    expect(readRasterText(100, 56, new Uint8Array(13 * 56))).toBeUndefined();
  });
});
