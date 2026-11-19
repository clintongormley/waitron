// Derived assets are committed, so editing a drawing or dark theme token requires regeneration.
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const here = import.meta.dirname;
const pub = join(here, "public");
const inkscape = process.env.INKSCAPE ?? "inkscape";

const colors = readFileSync(
  join(here, "..", "..", "ui-core", "src", "tokens", "colors.css"),
  "utf8",
);
// The token file's unindented closing brace bounds the media block, excluding explicit themes.
const darkBlock = colors.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/)?.[1];
if (darkBlock === undefined) throw new Error("colors.css has no dark media block");
const darkToken = (name) => {
  const value = darkBlock.match(new RegExp(`--wt-color-${name}:\\s*(#[0-9a-f]{6});`, "i"))?.[1];
  if (value === undefined) throw new Error(`colors.css declares no dark --wt-color-${name}`);
  return value;
};
const INK_DARK = darkToken("text");
// The icon canvas's side is the mark's long axis times this, leaving the margin the old icons had.
const ICON_MARGIN = 136 / 124;

/**
 * A source drawing: a tight `viewBox`, then a `<g class="ink" fill="…">` holding every near-black
 * piece, then the W's fixed blues. Only the ink group may change colour, so the dark copies and the
 * favicon's dark rule replace that one fill and nothing else.
 */
function readSource(name) {
  const svg = readFileSync(join(here, name), "utf8");
  const open = svg.match(/^<svg[^>]*viewBox="([^"]+)"[^>]*>/);
  if (open === null) throw new Error(`${name}: opening <svg> needs a viewBox`);
  const ink = svg.match(/<g class="ink" fill="(#[0-9a-f]{6})">/);
  if (ink === null) throw new Error(`${name}: needs a <g class="ink" fill="#rrggbb"> group`);
  const body = svg.slice(open[0].length, svg.lastIndexOf("</svg>"));
  const [x, y, w, h] = open[1].split(/\s+/).map(Number);
  return { svg, body, ink: ink[0], x, y, w, h };
}

/** Run Inkscape, and say what it printed if it fails — a bare spawn error names no cause. */
function render(src, out, size, { opaque = false, height = size } = {}) {
  const args = [src, "-o", out, "-w", String(size), "-h", String(height)];
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

const lockup = readSource("waitron-lockup.svg");
const mark = readSource("waitron-mark.svg");
const written = [];
const write = (path, text) => {
  writeFileSync(path, text);
  written.push(path.slice(here.length + 1));
};

// The mark centred on a square, which is the shape every icon wants.
const side = +(Math.max(mark.w, mark.h) * ICON_MARGIN).toFixed(2);
const squareX = +(mark.x - (side - mark.w) / 2).toFixed(2);
const squareY = +(mark.y - (side - mark.h) / 2).toFixed(2);
const square = (extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${squareX} ${squareY} ${side} ${side}" ` +
  `width="${side}" height="${side}">${extra}${mark.body}</svg>\n`;

// A browser draws its tab strip in its own light or dark, not the page's, so only the ink follows
// it; the rasters below cannot, and keep the light ink.
write(
  join(pub, "favicon.svg"),
  square(`<style>@media (prefers-color-scheme: dark){.ink{fill:${INK_DARK}}}</style>`),
);

// For an `<img>` on a dark ground, which cannot read the theme's tokens.
write(
  join(here, "waitron-lockup-dark.svg"),
  lockup.svg.replace(lockup.ink, `<g class="ink" fill="${INK_DARK}">`),
);

const scratch = mkdtempSync(join(tmpdir(), "waitron-icons-"));
try {
  // iOS does not honour an icon's alpha on the home screen: it flattens onto an opaque backing, so
  // a transparent icon arrives as its mark on a black tile. Give it a ground of its own.
  const appleSrc = join(scratch, "apple-touch.svg");
  writeFileSync(
    appleSrc,
    square(`<rect x="${squareX}" y="${squareY}" width="${side}" height="${side}" fill="#ffffff"/>`),
  );
  render(appleSrc, join(pub, "apple-touch-icon.png"), 180, { opaque: true });
  written.push("public/apple-touch-icon.png");

  for (const size of [192, 512]) {
    render(appleSrc, join(pub, `icon-${size}.png`), size, { opaque: true });
    written.push(`public/icon-${size}.png`);
  }

  const markSquare = join(scratch, "mark-square.svg");
  writeFileSync(markSquare, square());
  const icoSizes = [16, 32, 48];
  for (const size of icoSizes) render(markSquare, join(scratch, `${size}.png`), size);
  write(
    join(pub, "favicon.ico"),
    packIco(icoSizes.map((size) => ({ size, data: readFileSync(join(scratch, `${size}.png`)) }))),
  );

  // The logo as plain images in the stock colours, for places that cannot draw an SVG or read the
  // theme (documents, slides, other sites). Width fixed, height from each drawing's shape.
  const rasters = [
    ["waitron-lockup.svg", "waitron-lockup.png", 1200],
    ["waitron-lockup-dark.svg", "waitron-lockup-dark.png", 1200],
    ["waitron-mark.svg", "waitron-mark.png", 512],
  ];
  for (const [source, png, width] of rasters) {
    const box = readFileSync(join(here, source), "utf8").match(/viewBox="([^"]+)"/)[1];
    const [, , w, h] = box.split(/\s+/).map(Number);
    render(join(here, source), join(here, "png", png), width, {
      height: Math.round((width * h) / w),
    });
    written.push(`png/${png}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const version = execFileSync(inkscape, ["--version"], { encoding: "utf8" }).trim();
process.stdout.write(`build-icons: wrote ${written.join(", ")}\nbuild-icons: used ${version}\n`);
