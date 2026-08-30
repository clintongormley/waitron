// Authoring helper for Task 9's per-dish placeholder tiles (Phase 2). DEV CONVENIENCE ONLY — the
// committed PNGs under `media/` are the source of truth; this script just regenerates them.
//
// RULING (controller, binding): the tiles are produced with ZERO external dependencies — only Node
// built-ins (`node:zlib`, `node:fs`, `node:crypto`, `node:path`). No rasteriser, no font, no npm
// image lib. Each tile is a small RGB PNG whose colours + geometric motif are derived
// DETERMINISTICALLY from the dish's image basename, so every dish gets a distinct-but-reproducible
// placeholder. Text/glyphs are out (they'd need a font). Run `node gen-media.mjs` to (re)emit one
// PNG per distinct `image` basename referenced in `menu.ts`, then COMMIT the PNGs.
//
// PNG is hand-encoded (CLAUDE.md-grade "build it from primitives, verify the bytes"): the 8-byte
// signature, an IHDR chunk (256×256, 8-bit, colour-type 2 = RGB), one IDAT chunk =
// `zlib.deflateSync` of the raw scanlines (each row prefixed with filter byte 0), and an IEND chunk.
// Every chunk is length(4) + type(4) + data + CRC32(4), CRC computed with the standard PNG
// polynomial (0xEDB88320 reflected).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = join(HERE, "media");
const SIZE = 256; // tile edge in px

// ── PNG primitives ──────────────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Standard PNG/zlib CRC-32 table (reflected polynomial 0xEDB88320), built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of `bytes`, the value PNG stores after each chunk's type+data. */
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length(4) + type(4) + data + CRC32(4) over type+data. */
function chunk(type, data) {
  const typeBytes = Buffer.from(type, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** Encode a `width`×`height` RGB image (`Uint8Array` of length width*height*3) as a PNG buffer. */
function encodePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // colour type 2 = truecolour RGB
  ihdr.writeUInt8(0, 10); // compression: deflate
  ihdr.writeUInt8(0, 11); // filter method: adaptive
  ihdr.writeUInt8(0, 12); // interlace: none

  // Raw scanlines: each row is a filter byte (0 = None) followed by width*3 RGB bytes.
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: None
    rgb.copy(raw, rowStart + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Deterministic tile design ─────────────────────────────────────────────────────────────────────

/** 32 bytes of SHA-256 over the basename — the deterministic seed for this tile's look. */
function seedBytes(name) {
  return createHash("sha256").update(name).digest();
}

/** A pleasant, well-separated RGB from a hue in [0,360) at fixed saturation/lightness. */
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Paint one deterministic tile for `name`. Background hue + a contrasting foreground hue come from the
 * seed; one of five geometric motifs (chosen by the seed) is painted in the foreground colour, so
 * every basename yields a visually distinct, reproducible placeholder without any text or font.
 */
function paintTile(name) {
  const seed = seedBytes(name);
  const bgHue = (seed[0] / 255) * 360;
  const fgHue = (bgHue + 120 + (seed[1] / 255) * 120) % 360; // 120–240° around → contrast
  const [br, bg, bb] = hslToRgb(bgHue, 0.55, 0.4);
  const [fr, fg, fb] = hslToRgb(fgHue, 0.6, 0.62);
  const motif = seed[2] % 5;
  const band = 24 + (seed[3] % 24); // motif feature size, 24–47px

  const rgb = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let fore;
      switch (motif) {
        case 0: // diagonal stripes
          fore = Math.floor((x + y) / band) % 2 === 0;
          break;
        case 1: // checkerboard
          fore = (Math.floor(x / band) + Math.floor(y / band)) % 2 === 0;
          break;
        case 2: // vertical bands
          fore = Math.floor(x / band) % 2 === 0;
          break;
        case 3: {
          // centred diamond
          const dx = Math.abs(x - SIZE / 2);
          const dy = Math.abs(y - SIZE / 2);
          fore = dx + dy < SIZE / 2 - band / 2;
          break;
        }
        default: {
          // concentric rings
          const dx = x - SIZE / 2;
          const dy = y - SIZE / 2;
          fore = Math.floor(Math.sqrt(dx * dx + dy * dy) / band) % 2 === 0;
          break;
        }
      }
      const i = (y * SIZE + x) * 3;
      rgb[i] = fore ? fr : br;
      rgb[i + 1] = fore ? fg : bg;
      rgb[i + 2] = fore ? fb : bb;
    }
  }
  return encodePng(SIZE, SIZE, rgb);
}

// ── Drive: read basenames from menu.ts, emit + verify one PNG each ────────────────────────────────

/** The distinct `image: "…"` basenames referenced in `menu.ts`, sorted. */
function basenamesFromMenu() {
  const src = readFileSync(join(HERE, "menu.ts"), "utf8");
  const names = new Set();
  for (const m of src.matchAll(/image:\s*"([^"]+)"/g)) names.add(m[1]);
  return [...names].sort();
}

function main() {
  mkdirSync(MEDIA_DIR, { recursive: true });
  const names = basenamesFromMenu();

  // Remove any stale tiles no longer referenced, so the committed set tracks the menu exactly.
  const wanted = new Set(names);
  for (const existing of readdirSync(MEDIA_DIR)) {
    if (existing.endsWith(".png") && !wanted.has(existing)) unlinkSync(join(MEDIA_DIR, existing));
  }

  for (const name of names) {
    const png = paintTile(name);
    // Verify: the bytes must start with the PNG signature and be readable back.
    if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw new Error(`gen-media: emitted bytes for ${name} are not a PNG`);
    }
    writeFileSync(join(MEDIA_DIR, name), png);
    const readBack = readFileSync(join(MEDIA_DIR, name));
    if (!readBack.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw new Error(`gen-media: ${name} did not round-trip as a PNG`);
    }
  }
  console.log(`gen-media: wrote ${names.length} tiles to ${MEDIA_DIR}`);
}

main();
