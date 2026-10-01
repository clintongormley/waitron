import { GLYPH_HEIGHT, GLYPH_WIDTH, GLYPHS } from "./glyphs.js";
import { gridForWidth, type TextGrid } from "./layout.js";
import { glyphRows, prepareText } from "./text.js";

/** One line of text is one image this many dots tall. */
export const TEXT_BAND_HEIGHT = GLYPH_HEIGHT;

export type Alignment = "left" | "center" | "right";

/**
 * The rows of a `TEXT_BAND_HEIGHT`-dot image `grid.widthDots` wide holding `text` in whole grid
 * cells, packed as `GS v 0` expects: `ceil(widthDots / 8)` bytes a row, the leftmost dot in a
 * byte's top bit, a set bit printing. Text past the grid's last cell is not drawn. The width must
 * be a whole number of bytes: `GS v 0` states a width in bytes, so any other would come back wider
 * and on another grid.
 */
export function drawTextBand(text: string, grid: TextGrid, align: Alignment = "left"): Uint8Array {
  if (grid.widthDots % 8 !== 0) {
    throw new RangeError(
      `a text band's width must be a whole number of bytes, got ${grid.widthDots}`,
    );
  }
  const stride = grid.widthDots / 8;
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

/** Glyphs keyed by their rows, one character a row; the lowest code point wins between identical ones. */
const BY_PICTURE: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [codePoint, hex] of GLYPHS) {
    const rows = Array.from({ length: GLYPH_HEIGHT }, (_, y) =>
      parseInt(hex.slice(y * 3, y * 3 + 3), 16),
    );
    const key = String.fromCharCode(...rows);
    if (!map.has(key)) map.set(key, String.fromCodePoint(codePoint));
  }
  return map;
})();

/** True when any of dots `from` to `to` (exclusive) is set in the row starting at byte `row`. */
function inkBetween(data: Uint8Array, row: number, from: number, to: number): boolean {
  for (let x = from; x < to;) {
    const bit = x & 7;
    const n = Math.min(8 - bit, to - x);
    if (data[row + (x >> 3)]! & ((0xff >> bit) & (0xff << (8 - bit - n)))) return true;
    x += n;
  }
  return false;
}

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
  const gridEnd = grid.offsetDots + grid.columns * GLYPH_WIDTH;
  for (let row = 0; row < data.length; row += stride) {
    if (inkBetween(data, row, 0, grid.offsetDots) || inkBetween(data, row, gridEnd, widthDots)) {
      return undefined;
    }
  }
  const rows: number[] = new Array<number>(TEXT_BAND_HEIGHT);
  let text = "";
  for (let cell = 0; cell < grid.columns; cell++) {
    const left = grid.offsetDots + cell * GLYPH_WIDTH;
    const byte = left >> 3;
    const shift = 24 - GLYPH_WIDTH - (left & 7);
    let ink = 0;
    for (let y = 0, row = byte; y < TEXT_BAND_HEIGHT; y++, row += stride) {
      // A cell's 12 dots span two or three bytes of its row; a third byte past the band reads as 0.
      const bits = (data[row]! << 16) | (data[row + 1]! << 8) | (data[row + 2] ?? 0);
      rows[y] = (bits >> shift) & 0xfff;
      ink |= rows[y]!;
    }
    if (ink === 0) {
      text += " ";
      continue;
    }
    const ch = BY_PICTURE.get(String.fromCharCode(...rows));
    if (ch === undefined) return undefined;
    text += ch;
  }
  return text.trimEnd();
}
