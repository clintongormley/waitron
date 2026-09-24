// Writes every derived brand file from waitron-mark.svg and waitron-wordmark.svg. The outputs are
// committed and nothing checks them against their sources, so run this after editing either source:
//
//   node packages/ui/brand/build-icons.mjs
//
// Set INKSCAPE to point at a binary that is not on PATH. `Buffer` and `process` are imported because
// no eslint.config.js block grants this file Node globals.
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const here = import.meta.dirname;
const pub = join(here, "public");
const inkscape = process.env.INKSCAPE ?? "inkscape";

const MARK_BLUE_DARK = "#4c8dff"; // mirrors --wt-color-primary dark; hand-kept in step, see README
const ICON_CANVAS = 136; // mark is 124.64 x 117.09, so this leaves an even margin on the long axis

/**
 * The body must carry no fill of its own: a `fill` attribute on an inner element beats an inherited
 * CSS rule, so it would make the favicon's dark-mode rule inert.
 */
function readSource(name) {
  const svg = readFileSync(join(here, name), "utf8");
  const open = svg.match(/^<svg[^>]*viewBox="([^"]+)"[^>]*fill="([^"]+)"[^>]*>/);
  if (open === null) throw new Error(`${name}: opening <svg> needs both a viewBox and a fill`);
  const body = svg.slice(open[0].length, svg.lastIndexOf("</svg>"));
  if (/\bfill=/.test(body)) throw new Error(`${name}: body must carry no fill — see readSource`);
  const [x, y, w, h] = open[1].split(/\s+/).map(Number);
  return { body, x, y, w, h, fill: open[2] };
}

/** Run Inkscape, and say what it printed if it fails — a bare spawn error names no cause. */
function render(src, out, size, { opaque = false } = {}) {
  const args = [src, "-o", out, "-w", String(size), "-h", String(size)];
  if (!opaque) args.push("--export-background-opacity=0");
  try {
    execFileSync(inkscape, args, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (cause) {
    const stderr =
      typeof cause.stderr?.toString === "function" ? cause.stderr.toString().trim() : "";
    throw new Error(
      `build-icons: inkscape failed on ${src} at ${size}px` +
        `${stderr === "" ? "" : `\n${stderr}`}\nSet INKSCAPE if it is not on PATH.`,
      { cause },
    );
  }
}

/**
 * Pack PNGs into a .ico. The format allows a whole PNG as an entry's payload instead of the older
 * BMP-plus-AND-mask, so this is a header plus the files, with no re-encoding.
 */
function packIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  const blobs = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size < 256 ? size : 0, 0); // 0 means 256
    e.writeUInt8(size < 256 ? size : 0, 1);
    e.writeUInt8(0, 2); // palette size
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    blobs.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

const mark = readSource("waitron-mark.svg");
const word = readSource("waitron-wordmark.svg");
// The icons centre the mark by its width and height alone, so a non-zero origin would silently
// mis-place it and an oversized drawing would silently clip. Both are cheap to refuse.
if (mark.x !== 0 || mark.y !== 0) {
  throw new Error(
    `waitron-mark.svg: viewBox origin must be 0 0 for centring, got ${mark.x} ${mark.y}`,
  );
}
if (mark.w > ICON_CANVAS || mark.h > ICON_CANVAS) {
  throw new Error(`waitron-mark.svg is ${mark.w}x${mark.h}, over the ${ICON_CANVAS} icon canvas`);
}
const written = [];
const write = (path, text) => {
  writeFileSync(path, text);
  written.push(path.slice(here.length + 1));
};

// The mark centred on a square, which is the shape every icon wants.
const pad = (w, h) => `translate(${(ICON_CANVAS - w) / 2},${(ICON_CANVAS - h) / 2})`;
const square = (fill, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_CANVAS} ${ICON_CANVAS}" ` +
  `width="${ICON_CANVAS}" height="${ICON_CANVAS}">${extra}` +
  `<g fill="${fill}" transform="${pad(mark.w, mark.h)}">${mark.body}</g></svg>\n`;

// Only browsers that read SVG favicons see this rule; the rasters below are stuck on the light blue.
write(
  join(pub, "favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_CANVAS} ${ICON_CANVAS}" ` +
    `width="${ICON_CANVAS}" height="${ICON_CANVAS}">` +
    `<style>.m{fill:${mark.fill}}@media (prefers-color-scheme: dark){.m{fill:${MARK_BLUE_DARK}}}</style>` +
    `<g class="m" transform="${pad(mark.w, mark.h)}">${mark.body}</g></svg>\n`,
);

// Mark at the wordmark's cap height, feet on its baseline, then the word.
const scale = 100 / mark.h;
const gap = 30;
const wordX = mark.w * scale + gap;
write(
  join(here, "waitron-lockup.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${word.x} ${word.y} ${wordX + word.w} ${word.h}">` +
    `<g fill="${mark.fill}" transform="scale(${scale.toFixed(4)})">${mark.body}</g>` +
    `<g fill="${word.fill}" transform="translate(${wordX.toFixed(1)},0)">${word.body}</g></svg>\n`,
);

const scratch = mkdtempSync(join(tmpdir(), "waitron-icons-"));
try {
  // iOS does not honour an icon's alpha on the home screen: it flattens onto an opaque backing, so
  // a transparent icon arrives as a blue mark on a black tile. Give it a ground of its own.
  const appleSrc = join(scratch, "apple-touch.svg");
  writeFileSync(
    appleSrc,
    square(mark.fill, `<rect width="${ICON_CANVAS}" height="${ICON_CANVAS}" fill="#ffffff"/>`),
  );
  render(appleSrc, join(pub, "apple-touch-icon.png"), 180, { opaque: true });
  written.push("public/apple-touch-icon.png");

  for (const size of [192, 512]) {
    render(appleSrc, join(pub, `icon-${size}.png`), size, { opaque: true });
    written.push(`public/icon-${size}.png`);
  }

  const markSquare = join(scratch, "mark-square.svg");
  writeFileSync(markSquare, square(mark.fill));
  const icoSizes = [16, 32, 48];
  for (const size of icoSizes) render(markSquare, join(scratch, `${size}.png`), size);
  write(
    join(pub, "favicon.ico"),
    packIco(icoSizes.map((size) => ({ size, data: readFileSync(join(scratch, `${size}.png`)) }))),
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const version = execFileSync(inkscape, ["--version"], { encoding: "utf8" }).trim();
process.stdout.write(`build-icons: wrote ${written.join(", ")}\nbuild-icons: used ${version}\n`);
