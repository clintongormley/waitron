import { GLYPH_HEIGHT, GLYPHS } from "./glyphs.js";

const ROWS: ReadonlyMap<string, readonly number[]> = new Map(
  GLYPHS.map(([codePoint, hex]) => [
    String.fromCodePoint(codePoint),
    Array.from({ length: GLYPH_HEIGHT }, (_, row) =>
      Number.parseInt(hex.slice(row * 3, row * 3 + 3), 16),
    ),
  ]),
);

/** A character's rows, top first, the leftmost dot in bit 11; undefined when the table lacks it. */
export function glyphRows(ch: string): readonly number[] | undefined {
  return ROWS.get(ch);
}

function printable(text: string): boolean {
  for (const ch of text) if (!ROWS.has(ch)) return false;
  return true;
}

/** Replacements for characters the glyph table lacks, tried before an accent is dropped. */
const FALLBACK: Readonly<Record<string, string>> = {
  "\u{202f}": " ",
};

/**
 * Normalise `s` to NFC and replace every character the glyph table cannot draw: first a fixed
 * fallback, then the character without its accents, then `?`. A control character (0x00–0x1F, 0x7F)
 * becomes a space. Every character of the result has a glyph, so `.length` of the result is its
 * printed width in cells.
 */
export function prepareText(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const codePoint = ch.codePointAt(0)!;
    if (codePoint < 0x20 || codePoint === 0x7f) out += " ";
    else if (ROWS.has(ch)) out += ch;
    else if (FALLBACK[ch] !== undefined) out += FALLBACK[ch];
    else {
      const stripped = ch.normalize("NFD").replace(/\p{Diacritic}/gu, "");
      out += stripped !== "" && printable(stripped) ? stripped : "?";
    }
  }
  return out;
}
