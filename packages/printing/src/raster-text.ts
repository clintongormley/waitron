import { GLYPH_HEIGHT, GLYPH_WIDTH, GLYPHS } from "./glyphs.js";
import { gridForWidth, type TextGrid } from "./layout.js";
import { glyphRows, prepareText } from "./text.js";

/** One line of text is one image this many dots tall. */
export const TEXT_BAND_HEIGHT = GLYPH_HEIGHT;

export type Alignment = "left" | "center" | "right";

/**
 * The rows of a `TEXT_BAND_HEIGHT`-dot image `grid.widthDots` wide holding `text` in whole grid
 * cells, packed as `GS v 0` expects: `ceil(widthDots / 8)` bytes a row, the leftmost dot in a
 * byte's top bit, a set bit printing. Text past the grid's last cell is not drawn.
 */
export function drawTextBand(text: string, grid: TextGrid, align: Alignment = "left"): Uint8Array {
  const stride = Math.ceil(grid.widthDots / 8);
  const data = new Uint8Array(stride * TEXT_BAND_HEIGHT);
  const characters = [...prepareText(text)].slice(0, grid.columns);
  const free = grid.columns - characters.length;
  const firstCell = align === "center" ? Math.floor(free / 2) : align === "right" ? free : 0;
  characters.forEach((ch, i) => {
    const rows = glyphRows(ch)!;
    const left = grid.offsetDots + (firstCell + i) * GLYPH_WIDTH;
    for (let y = 0; y < TEXT_BAND_HEIGHT; y++) {
      for (let dx = 0; dx < GLYPH_WIDTH; dx++) {
        if ((rows[y]! & (0x800 >> dx)) === 0) continue;
        const x = left + dx;
        data[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  });
  return data;
}

/** Glyph rows joined as text → the character; the lowest code point wins between identical ones. */
const BY_PICTURE: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [codePoint, hex] of GLYPHS) {
    if (!map.has(hex)) map.set(hex, String.fromCodePoint(codePoint));
  }
  return map;
})();

/**
 * The text of a band drawn by {@link drawTextBand}, read on the grid {@link gridForWidth} gives for
 * its width: one character a cell, a blank cell a space, trailing spaces dropped. Undefined when the
 * band is not `TEXT_BAND_HEIGHT` dots tall, its bytes do not fill it exactly, or it has ink that is
 * not a glyph in a grid cell — a QR code or a ruler.
 */
export function readRasterText(
  widthDots: number,
  heightDots: number,
  data: Uint8Array,
): string | undefined {
  const stride = Math.ceil(widthDots / 8);
  if (heightDots !== TEXT_BAND_HEIGHT || data.length !== stride * heightDots) return undefined;
  const grid = gridForWidth(widthDots);
  const dot = (x: number, y: number): boolean =>
    (data[y * stride + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;
  const gridEnd = grid.offsetDots + grid.columns * GLYPH_WIDTH;
  for (let y = 0; y < heightDots; y++) {
    for (let x = 0; x < widthDots; x++) {
      if ((x < grid.offsetDots || x >= gridEnd) && dot(x, y)) return undefined;
    }
  }
  let text = "";
  for (let cell = 0; cell < grid.columns; cell++) {
    const left = grid.offsetDots + cell * GLYPH_WIDTH;
    let picture = "";
    for (let y = 0; y < heightDots; y++) {
      let row = 0;
      for (let dx = 0; dx < GLYPH_WIDTH; dx++) if (dot(left + dx, y)) row |= 0x800 >> dx;
      picture += row.toString(16).padStart(3, "0");
    }
    const ch = BY_PICTURE.get(picture);
    if (ch === undefined) return undefined;
    text += ch;
  }
  return text.trimEnd();
}
