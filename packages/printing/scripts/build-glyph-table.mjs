// Writes packages/printing/src/glyphs.ts from Iosevka Term Bold:
//
//   node packages/printing/scripts/build-glyph-table.mjs <IosevkaTerm-Bold.ttf> packages/printing/src/glyphs.ts
//
// Each character becomes a 12 x 28 dot bitmap: the font drawn at 24 px (Iosevka Term's 500-unit
// advance on a 1000-unit em is then exactly 12 dots), its baseline 22 dots below the top of the cell.
// A dot is set when at least half of its area is inside the outline, the area counted on a fixed
// 16 x 16 grid of sample points per dot under the non-zero winding rule, so the same font file
// always gives the same bytes. The report on stderr names every character the font lacks and every
// glyph with ink outside the cell.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import opentype from "opentype.js";

const CELL_WIDTH = 12;
const CELL_HEIGHT = 28;
const BASELINE = 22;
const FONT_PX = 24;
const SAMPLES = 16;
const CURVE_STEPS = 32;
// The area searched for ink outside the cell: one cell either side, and 14 dots above and below.
const MARGIN_X = 12;
const MARGIN_Y = 14;

const WINDOWS_1252_EXTRAS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

function repertoire() {
  const codePoints = new Set();
  for (let cp = 0x20; cp <= 0x7e; cp++) codePoints.add(cp);
  for (let cp = 0xa0; cp <= 0x17f; cp++) codePoints.add(cp);
  for (const ch of WINDOWS_1252_EXTRAS) codePoints.add(ch.codePointAt(0));
  return [...codePoints].sort((a, b) => a - b);
}

/** The outline as straight edges, curves cut into CURVE_STEPS pieces. */
function edges(path) {
  const out = [];
  let start = null;
  let x = 0;
  let y = 0;
  const lineTo = (nx, ny) => {
    out.push([x, y, nx, ny]);
    x = nx;
    y = ny;
  };
  for (const c of path.commands) {
    if (c.type === "M") {
      if (start !== null && (x !== start[0] || y !== start[1])) lineTo(start[0], start[1]);
      start = [c.x, c.y];
      x = c.x;
      y = c.y;
    } else if (c.type === "L") {
      lineTo(c.x, c.y);
    } else if (c.type === "Q") {
      const [x0, y0] = [x, y];
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS;
        const u = 1 - t;
        lineTo(
          u * u * x0 + 2 * u * t * c.x1 + t * t * c.x,
          u * u * y0 + 2 * u * t * c.y1 + t * t * c.y,
        );
      }
    } else if (c.type === "C") {
      const [x0, y0] = [x, y];
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS;
        const u = 1 - t;
        lineTo(
          u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        );
      }
    } else if (c.type === "Z") {
      if (start !== null) lineTo(start[0], start[1]);
    }
  }
  if (start !== null && (x !== start[0] || y !== start[1])) lineTo(start[0], start[1]);
  return out;
}

/**
 * Coverage of every dot in the searched area, as a count of inside sample points (0..SAMPLES^2).
 * Index [row][column], where row 0 / column 0 is MARGIN_Y above and MARGIN_X left of the cell.
 */
function coverage(path) {
  const segments = edges(path);
  const rows = CELL_HEIGHT + 2 * MARGIN_Y;
  const cols = CELL_WIDTH + 2 * MARGIN_X;
  const counts = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let sy = 0; sy < rows * SAMPLES; sy++) {
    const y = sy / SAMPLES + 0.5 / SAMPLES - MARGIN_Y;
    const crossings = [];
    for (const [x0, y0, x1, y1] of segments) {
      if (y0 <= y && y < y1) crossings.push([x0 + ((y - y0) * (x1 - x0)) / (y1 - y0), 1]);
      else if (y1 <= y && y < y0) crossings.push([x0 + ((y - y0) * (x1 - x0)) / (y1 - y0), -1]);
    }
    if (crossings.length === 0) continue;
    crossings.sort((a, b) => a[0] - b[0]);
    let winding = 0;
    let next = 0;
    for (let sx = 0; sx < cols * SAMPLES; sx++) {
      const x = sx / SAMPLES + 0.5 / SAMPLES - MARGIN_X;
      while (next < crossings.length && crossings[next][0] < x) winding += crossings[next++][1];
      if (winding !== 0) counts[Math.floor(sy / SAMPLES)][Math.floor(sx / SAMPLES)]++;
    }
  }
  return counts;
}

function main() {
  const [fontPath, outPath] = process.argv.slice(2);
  if (fontPath === undefined || outPath === undefined) {
    process.stderr.write("usage: build-glyph-table.mjs <IosevkaTerm-Bold.ttf> <out.ts>\n");
    process.exit(2);
  }
  const file = readFileSync(fontPath);
  const sha256 = createHash("sha256").update(file).digest("hex");
  const font = opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.length));
  const half = SAMPLES * SAMPLES;

  const missing = [];
  const clipped = [];
  const entries = [];
  const advances = new Set();
  for (const cp of repertoire()) {
    const ch = String.fromCodePoint(cp);
    const glyph = font.charToGlyph(ch);
    if (glyph.index === 0) {
      missing.push(cp);
      continue;
    }
    advances.add((glyph.advanceWidth * FONT_PX) / font.unitsPerEm);
    const counts = coverage(glyph.getPath(0, BASELINE, FONT_PX));
    let inkOutside = 0;
    let dotsLost = 0;
    const rows = [];
    for (let r = 0; r < counts.length; r++) {
      const inRow = r >= MARGIN_Y && r < MARGIN_Y + CELL_HEIGHT;
      let bits = 0;
      for (let c = 0; c < counts[r].length; c++) {
        const set = counts[r][c] * 2 >= half;
        if (inRow && c >= MARGIN_X && c < MARGIN_X + CELL_WIDTH) {
          if (set) bits |= 0x800 >> (c - MARGIN_X);
        } else {
          if (counts[r][c] > 0) inkOutside++;
          if (set) dotsLost++;
        }
      }
      if (inRow) rows.push(bits.toString(16).padStart(3, "0"));
    }
    if (inkOutside > 0) clipped.push({ cp, ch, inkOutside, dotsLost });
    entries.push(`  [0x${cp.toString(16).padStart(4, "0")}, "${rows.join("")}"],`);
  }

  const source = `// The glyph bitmaps in this file are derived from Iosevka Term Bold, release 34.9.0.
// Copyright (c) 2015-2026, Renzhi Li (aka. Belleve Invis, belleve@typeof.net)
// This Font Software is licensed under the SIL Open Font License, Version 1.1, and so are these
// bitmaps, a Modified Version of it under that licence. The licence text ships in the box image
// under /app/third-party/.
//
// Generated by packages/printing/scripts/build-glyph-table.mjs from IosevkaTerm-Bold.ttf
// (sha256 ${sha256}). Do not edit by hand.

export const GLYPH_WIDTH = ${CELL_WIDTH};
export const GLYPH_HEIGHT = ${CELL_HEIGHT};

/**
 * One entry per character: its code point, then its ${CELL_HEIGHT} rows top to bottom, three hex digits
 * a row, the most significant of the row's ${CELL_WIDTH} bits being the leftmost dot.
 */
export const GLYPHS: readonly (readonly [number, string])[] = [
${entries.join("\n")}
];
`;
  writeFileSync(outPath, source);

  const name = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  process.stderr.write(`font sha256 ${sha256}, unitsPerEm ${font.unitsPerEm}\n`);
  process.stderr.write(`advance at ${FONT_PX} px: ${[...advances].join(", ")} dots\n`);
  process.stderr.write(`${entries.length} glyphs written\n`);
  process.stderr.write(
    `missing from the font: ${missing.length === 0 ? "none" : missing.map(name).join(" ")}\n`,
  );
  process.stderr.write(`glyphs with ink outside the ${CELL_WIDTH} x ${CELL_HEIGHT} cell:\n`);
  for (const { cp, ch, inkOutside, dotsLost } of clipped) {
    process.stderr.write(
      `  ${name(cp)} ${ch}: ${inkOutside} dot(s) touched outside, ${dotsLost} of them half covered\n`,
    );
  }
}

main();
