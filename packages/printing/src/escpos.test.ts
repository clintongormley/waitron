import { describe, expect, it } from "vitest";
import { esc } from "./escpos.js";

// Byte-level assertions PIN each ESC/POS command's exact sequence (design §3d). The builder is a
// pure, DB-free byte assembler, so these are ordinary unit tests — no PGlite, no container. Every
// constant is the canonical ESC/POS spelling, cited in escpos.ts; a hardware printer is verified
// MANUALLY (design §5 / the deli-hardware fake-sink approach), so the guard here is that the bytes
// are DETERMINISTIC and correct, not that a physical printer accepts them.
describe("esc() ESC/POS builder", () => {
  it("init emits ESC @ (0x1B 0x40)", () => {
    expect([...esc().init().bytes()]).toEqual([0x1b, 0x40]);
  });

  it("text emits the Latin-1 bytes of the string, one byte per character", () => {
    expect([...esc().text("AB").bytes()]).toEqual([0x41, 0x42]);
    // A non-ASCII Latin-1 character maps to its single 0x80-0xFF byte (é = U+00E9 → 0xE9); the
    // builder is byte-oriented and does not UTF-8-encode (a printer's code page is a consumer concern).
    expect([...esc().text("é").bytes()]).toEqual([0xe9]);
  });

  it("line appends a trailing LF (0x0A) after the text", () => {
    expect([...esc().line("A").bytes()]).toEqual([0x41, 0x0a]);
  });

  it("line() with no argument emits a bare LF", () => {
    expect([...esc().line().bytes()]).toEqual([0x0a]);
  });

  it("feed emits ESC d n (feed n lines), defaulting to 1", () => {
    expect([...esc().feed().bytes()]).toEqual([0x1b, 0x64, 0x01]);
    expect([...esc().feed(3).bytes()]).toEqual([0x1b, 0x64, 0x03]);
  });

  it("cut emits GS V 0 (full cut)", () => {
    expect([...esc().cut().bytes()]).toEqual([0x1d, 0x56, 0x00]);
  });

  it("kick emits the cash-drawer pulse ESC p 0 25 250", () => {
    expect([...esc().kick().bytes()]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });

  it("chains commands in call order into one contiguous byte stream", () => {
    const bytes = [...esc().init().line("Table 4").feed(2).cut().kick().bytes()];
    expect(bytes).toEqual([
      0x1b,
      0x40, // init
      0x54,
      0x61,
      0x62,
      0x6c,
      0x65,
      0x20,
      0x34,
      0x0a, // "Table 4" + LF
      0x1b,
      0x64,
      0x02, // feed 2
      0x1d,
      0x56,
      0x00, // cut
      0x1b,
      0x70,
      0x00,
      0x19,
      0xfa, // kick
    ]);
  });

  it("bytes() returns a fresh Uint8Array each call, so mutating the copy never disturbs the builder", () => {
    const builder = esc().text("A");
    const first = builder.bytes();
    first[0] = 0x00; // mutate the returned copy
    expect([...builder.bytes()]).toEqual([0x41]); // the builder's own state is untouched
    expect(builder.bytes()).toBeInstanceOf(Uint8Array);
  });

  it("an empty builder yields zero bytes", () => {
    expect([...esc().bytes()]).toEqual([]);
  });

  // --- QR Code -------------------------------------------------------------------------------------
  // The native GS ( k sequence and the GS v 0 raster fallback (design §3a). Every byte below is the
  // canonical ESC/POS spelling cited in escpos.ts; the fiscal cotejo QR is a legal element, so EC
  // level M (0x31, mandated by Orden HAC/1177/2024 art. 21.1) is pinned explicitly.

  it("qr emits the native GS ( k sequence (model → size → EC M → store → print) in order", () => {
    // "https://a.es" = 12 Latin-1 data bytes, so the <Function 180> store length is 12 + 3 = 15
    // (0x0F), the +3 covering cn, fn and m. Default EC level M (0x31), default module size 6 (0x06).
    expect([...esc().qr("https://a.es").bytes()]).toEqual([
      0x1d,
      0x28,
      0x6b,
      0x04,
      0x00,
      0x31,
      0x41,
      0x32,
      0x00, // Fn165 select model 2 (n1=0x32, n2=0x00)
      0x1d,
      0x28,
      0x6b,
      0x03,
      0x00,
      0x31,
      0x43,
      0x06, // Fn167 module size = 6 dots
      0x1d,
      0x28,
      0x6b,
      0x03,
      0x00,
      0x31,
      0x45,
      0x31, // Fn169 EC level M (0x31)
      0x1d,
      0x28,
      0x6b,
      0x0f,
      0x00,
      0x31,
      0x50,
      0x30, // Fn180 store, len = 12 + 3 = 15 (pL=0x0F, pH=0x00), m=0x30
      0x68,
      0x74,
      0x74,
      0x70,
      0x73,
      0x3a,
      0x2f,
      0x2f,
      0x61,
      0x2e,
      0x65,
      0x73, // "https://a.es"
      0x1d,
      0x28,
      0x6b,
      0x03,
      0x00,
      0x31,
      0x51,
      0x30, // Fn181 print symbol (m=0x30)
    ]);
  });

  it("qr honours an explicit ecLevel and moduleSize", () => {
    // "x" = 1 data byte → store length 1 + 3 = 4 (0x04); EC level H (0x33); module size 8 (0x08).
    expect([...esc().qr("x", { ecLevel: "H", moduleSize: 8 }).bytes()]).toEqual([
      0x1d,
      0x28,
      0x6b,
      0x04,
      0x00,
      0x31,
      0x41,
      0x32,
      0x00, // Fn165 select model 2
      0x1d,
      0x28,
      0x6b,
      0x03,
      0x00,
      0x31,
      0x43,
      0x08, // Fn167 module size = 8 dots
      0x1d,
      0x28,
      0x6b,
      0x03,
      0x00,
      0x31,
      0x45,
      0x33, // Fn169 EC level H (0x33)
      0x1d,
      0x28,
      0x6b,
      0x04,
      0x00,
      0x31,
      0x50,
      0x30,
      0x78, // Fn180 store "x", len = 1 + 3 = 4
      0x1d,
      0x28,
      0x6b,
      0x03,
      0x00,
      0x31,
      0x51,
      0x30, // Fn181 print symbol
    ]);
  });

  it("qr maps error-correction levels L and Q to their ESC/POS codes (0x30, 0x32)", () => {
    // Fn169 is the 8 bytes after Fn165 (9 bytes) and Fn167 (8 bytes): bytes [17, 25). L = 0x30.
    expect([...esc().qr("x", { ecLevel: "L" }).bytes()].slice(17, 25)).toEqual([
      0x1d,
      0x28,
      0x6b,
      0x03,
      0x00,
      0x31,
      0x45,
      0x30, // Fn169 EC level L (0x30)
    ]);
    expect([...esc().qr("x", { ecLevel: "Q" }).bytes()].slice(17, 25)).toEqual([
      0x1d,
      0x28,
      0x6b,
      0x03,
      0x00,
      0x31,
      0x45,
      0x32, // Fn169 EC level Q (0x32)
    ]);
  });

  it("qrRaster packs a 2x2 matrix into a GS v 0 raster bit image (MSB first, bit set = dark)", () => {
    // Diagonal [[dark,·],[·,dark]] at moduleSize 1: 2px wide → 1 byte/row (xL=0x01), 2 rows (yL=0x02).
    // Row 0 = 1000_0000 (0x80), row 1 = 0100_0000 (0x40).
    expect([
      ...esc()
        .qrRaster(
          [
            [true, false],
            [false, true],
          ],
          { moduleSize: 1 },
        )
        .bytes(),
    ]).toEqual([
      0x1d,
      0x76,
      0x30,
      0x00, // GS v 0, m=0 (normal)
      0x01,
      0x00, // width = 1 byte/row (2px → ceil(2/8))
      0x02,
      0x00, // height = 2 dots
      0x80, // row 0: dark, light
      0x40, // row 1: light, dark
    ]);
  });

  it("qrRaster expands modules by moduleSize and packs rows wider than one byte", () => {
    // 3x3 checker at moduleSize 3: 9px/side → 2 bytes/row (xL=0x02), 9 rows (yL=0x09). Each module
    // becomes a 3x3 pixel block, so each matrix row yields three identical pixel rows.
    expect([
      ...esc()
        .qrRaster(
          [
            [true, false, true],
            [false, true, false],
            [true, false, true],
          ],
          { moduleSize: 3 },
        )
        .bytes(),
    ]).toEqual([
      0x1d,
      0x76,
      0x30,
      0x00, // GS v 0, m=0
      0x02,
      0x00, // width = 2 bytes/row (9px → ceil(9/8))
      0x09,
      0x00, // height = 9 dots
      // module row 0 = dark,light,dark → 111_000_111 → 0xE3 0x80, ×3 pixel rows
      0xe3,
      0x80,
      0xe3,
      0x80,
      0xe3,
      0x80,
      // module row 1 = light,dark,light → 000_111_000 → 0x1C 0x00, ×3
      0x1c,
      0x00,
      0x1c,
      0x00,
      0x1c,
      0x00,
      // module row 2 = dark,light,dark → 0xE3 0x80, ×3
      0xe3,
      0x80,
      0xe3,
      0x80,
      0xe3,
      0x80,
    ]);
  });

  it("qrRaster defaults moduleSize to 6 dots", () => {
    // One dark module, no opts: 6px/side → 1 byte/row, 6 rows, each 1111_1100 (0xFC).
    expect([
      ...esc()
        .qrRaster([[true]])
        .bytes(),
    ]).toEqual([
      0x1d,
      0x76,
      0x30,
      0x00, // GS v 0, m=0
      0x01,
      0x00, // width = 1 byte/row (6px)
      0x06,
      0x00, // height = 6 dots
      0xfc,
      0xfc,
      0xfc,
      0xfc,
      0xfc,
      0xfc, // six identical rows: 1111_1100
    ]);
  });
});
