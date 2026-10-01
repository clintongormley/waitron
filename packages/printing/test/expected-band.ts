import { GLYPHS } from "../src/glyphs.js";

/**
 * The bytes a text band should hold, built from the glyph table's hex by code independent of
 * `src/raster-text.ts`: each character's glyph painted at the dot given beside it, rows packed most
 * significant bit first.
 */
export function expectedBand(
  widthDots: number,
  placed: readonly (readonly [string, number])[],
): number[] {
  const dots = Array.from({ length: 28 }, () => new Array<boolean>(widthDots).fill(false));
  for (const [ch, x] of placed) {
    const hex = GLYPHS.find(([codePoint]) => codePoint === ch.codePointAt(0))![1];
    for (let y = 0; y < 28; y++) {
      const row = parseInt(hex.slice(y * 3, y * 3 + 3), 16);
      for (let dx = 0; dx < 12; dx++) if (row & (1 << (11 - dx))) dots[y]![x + dx] = true;
    }
  }
  const bytes: number[] = [];
  for (const row of dots) {
    for (let bx = 0; bx < Math.ceil(widthDots / 8); bx++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) if (row[bx * 8 + bit]) byte |= 1 << (7 - bit);
      bytes.push(byte);
    }
  }
  return bytes;
}

/** Each character of `text` in consecutive 12-dot cells from `firstDot`. */
export const cellsFrom = (text: string, firstDot: number): [string, number][] =>
  [...text].map((ch, i) => [ch, firstDot + i * 12]);
