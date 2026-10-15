import { GLYPH_HEIGHT, GLYPH_WIDTH, GLYPHS } from "./glyphs.js";
import { gridForWidth, type TextGrid } from "./layout.js";
import { glyphRows, prepareText } from "./text.js";

/**
 * A regular or bold line of text is one image this many dots tall; a double-size one is twice it
 * ({@link textBandHeight}).
 */
export const TEXT_BAND_HEIGHT = GLYPH_HEIGHT;

export type Alignment = "left" | "center" | "right";

export interface TextStyle {
  bold?: boolean;
  double?: boolean;
}

export function textBandHeight(style: TextStyle = {}): number {
  return style.double === true ? TEXT_BAND_HEIGHT * 2 : TEXT_BAND_HEIGHT;
}

/** One dot heavier: the row ORed with itself one dot to the right, kept inside its cell. */
function embolden(row: number): number {
  return (row | (row >> 1)) & 0xfff;
}

/**
 * The rows of a {@link textBandHeight}-dot image `grid.widthDots` wide holding `text` in whole grid
 * cells, packed as `GS v 0` expects: `ceil(widthDots / 8)` bytes a row, the leftmost dot in a
 * byte's top bit, a set bit printing. A double line draws each glyph 2×2 over half as many cells
 * from the same first dot. Text past the last cell is not drawn. The width must be a whole number
 * of bytes: `GS v 0` states a width in bytes, so any other would come back wider and on another
 * grid.
 */
export function drawTextBand(
  text: string,
  grid: TextGrid,
  align: Alignment = "left",
  style: TextStyle = {},
): Uint8Array {
  if (grid.widthDots % 8 !== 0) {
    throw new RangeError(
      `a text band's width must be a whole number of bytes, got ${grid.widthDots}`,
    );
  }
  const scale = style.double === true ? 2 : 1;
  const height = TEXT_BAND_HEIGHT * scale;
  const cells = Math.floor(grid.columns / scale);
  const stride = grid.widthDots / 8;
  const data = new Uint8Array(stride * height);
  const characters = [...prepareText(text)].slice(0, cells);
  const free = cells - characters.length;
  const firstCell = align === "center" ? Math.floor(free / 2) : align === "right" ? free : 0;
  characters.forEach((ch, i) => {
    const rows = glyphRows(ch)!;
    const left = grid.offsetDots + (firstCell + i) * GLYPH_WIDTH * scale;
    for (let y = 0; y < height; y++) {
      const source = rows[Math.floor(y / scale)]!;
      const row = style.bold === true ? embolden(source) : source;
      for (let dx = 0; dx < GLYPH_WIDTH * scale; dx++) {
        if ((row & (0x800 >> Math.floor(dx / scale))) === 0) continue;
        const x = left + dx;
        data[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  });
  return data;
}

function glyphPictures(): [string, number[]][] {
  return GLYPHS.map(([codePoint, hex]) => [
    String.fromCodePoint(codePoint),
    Array.from({ length: GLYPH_HEIGHT }, (_, y) => parseInt(hex.slice(y * 3, y * 3 + 3), 16)),
  ]);
}

/** Glyphs keyed by their rows, one character a row; the lowest code point wins between identical ones. */
const BY_PICTURE: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [ch, rows] of glyphPictures()) {
    const key = String.fromCharCode(...rows);
    if (!map.has(key)) map.set(key, ch);
  }
  return map;
})();

/** As {@link BY_PICTURE} for bold glyphs, leaving out those bold leaves unchanged. */
const BY_BOLD_PICTURE: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [ch, rows] of glyphPictures()) {
    const regular = String.fromCharCode(...rows);
    const key = String.fromCharCode(...rows.map(embolden));
    if (key !== regular && !map.has(key)) map.set(key, ch);
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
 * band is not one line tall (regular, bold or double), a double one's width is not whole bytes,
 * its bytes do not fill it exactly, or it has ink that is not a glyph in a grid cell — a QR code or
 * a ruler.
 */
export function readRasterText(
  widthDots: number,
  heightDots: number,
  data: Uint8Array,
): string | undefined {
  const stride = Math.ceil(widthDots / 8);
  if (data.length !== stride * heightDots) return undefined;
  if (heightDots === TEXT_BAND_HEIGHT) return readLine(widthDots, stride, data);
  if (heightDots === TEXT_BAND_HEIGHT * 2 && widthDots % 8 === 0) {
    return readDoubleLine(widthDots, stride, data);
  }
  return undefined;
}

/** The character a cell's rows draw, regular or bold, with whether only the bold reading fits. */
function lookUp(rows: number[]): { ch: string; bold: boolean } | undefined {
  const key = String.fromCharCode(...rows);
  const regular = BY_PICTURE.get(key);
  if (regular !== undefined) return { ch: regular, bold: false };
  const bold = BY_BOLD_PICTURE.get(key);
  return bold === undefined ? undefined : { ch: bold, bold: true };
}

function readLine(widthDots: number, stride: number, data: Uint8Array): string | undefined {
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
    const found = lookUp(rows);
    if (found === undefined) return undefined;
    text += found.ch;
  }
  return text.trimEnd();
}

/**
 * Reads one dot of every 2×2 block, then redraws what it read and accepts it only when the redraw
 * matches byte for byte, so a picture that merely resembles doubled text is not read as text.
 */
function readDoubleLine(widthDots: number, stride: number, data: Uint8Array): string | undefined {
  const grid = gridForWidth(widthDots);
  const cells = Math.floor(grid.columns / 2);
  const rows: number[] = new Array<number>(TEXT_BAND_HEIGHT);
  let text = "";
  let bold = false;
  for (let cell = 0; cell < cells; cell++) {
    const left = grid.offsetDots + cell * GLYPH_WIDTH * 2;
    let ink = 0;
    for (let y = 0; y < TEXT_BAND_HEIGHT; y++) {
      let bits = 0;
      for (let dx = 0; dx < GLYPH_WIDTH; dx++) {
        const x = left + dx * 2;
        if (data[y * 2 * stride + (x >> 3)]! & (0x80 >> (x & 7))) bits |= 0x800 >> dx;
      }
      rows[y] = bits;
      ink |= bits;
    }
    if (ink === 0) {
      text += " ";
      continue;
    }
    const found = lookUp(rows);
    if (found === undefined) return undefined;
    text += found.ch;
    bold ||= found.bold;
  }
  const read = text.trimEnd();
  const redrawn = drawTextBand(read, grid, "left", { double: true, bold });
  return redrawn.every((byte, i) => byte === data[i]) ? read : undefined;
}
