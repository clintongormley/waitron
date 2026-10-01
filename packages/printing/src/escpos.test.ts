import { describe, expect, it } from "vitest";
import { cellsFrom, expectedBand } from "../test/expected-band.js";
import { escPosCommands } from "./escpos-commands.js";
import { FEED_BEFORE_CUT, esc } from "./escpos.js";
import { GLYPHS } from "./glyphs.js";
import { gridForWidth } from "./layout.js";

// These pin the exact bytes, not that a physical printer accepts them.
describe("esc() ESC/POS builder", () => {
  it("selects line justification with ESC a n", () => {
    expect([...esc().align("center").align("right").align("left").bytes()]).toEqual([
      0x1b, 0x61, 1, 0x1b, 0x61, 2, 0x1b, 0x61, 0,
    ]);
  });
  it("sets a left-anchored print area in dots", () => {
    expect([...esc().printArea(360).bytes()]).toEqual([
      0x1d,
      0x4c,
      0x00,
      0x00, // GS L: left margin = 0 dots
      0x1d,
      0x57,
      0x68,
      0x01, // GS W: width = 360 dots, low byte first
    ]);
  });
  it("init emits ESC @ (0x1B 0x40)", () => {
    expect([...esc().init().bytes()]).toEqual([0x1b, 0x40]);
  });

  it("feed emits ESC d n (feed n lines), defaulting to 1", () => {
    expect([...esc().feed().bytes()]).toEqual([0x1b, 0x64, 0x01]);
    expect([...esc().feed(3).bytes()]).toEqual([0x1b, 0x64, 0x03]);
  });

  it("cut emits GS V 0 (full cut)", () => {
    expect([...esc().cut().bytes()]).toEqual([0x1d, 0x56, 0x00]);
  });

  it("feedAndCut feeds FEED_BEFORE_CUT lines (five — three measured too short) then cuts", () => {
    expect(FEED_BEFORE_CUT).toBe(5);
    expect([...esc().feedAndCut().bytes()]).toEqual([0x1b, 0x64, 0x05, 0x1d, 0x56, 0x00]);
  });

  it("kick emits the cash-drawer pulse ESC p 0 25 250", () => {
    expect([...esc().kick().bytes()]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });

  it("chains commands in call order into one contiguous byte stream", () => {
    const bytes = [...esc().init().feed(2).cut().kick().bytes()];
    expect(bytes).toEqual([
      0x1b,
      0x40, // init
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
    const builder = esc().init();
    const first = builder.bytes();
    first[0] = 0x00; // mutate the returned copy
    expect([...builder.bytes()]).toEqual([0x1b, 0x40]); // the builder's own state is untouched
    expect(builder.bytes()).toBeInstanceOf(Uint8Array);
  });

  it("an empty builder yields zero bytes", () => {
    expect([...esc().bytes()]).toEqual([]);
  });

  // --- QR Code -------------------------------------------------------------------------------------

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

  it("qr rejects an out-of-range moduleSize but accepts the [1, 16] Fn167 boundaries", () => {
    // moduleSize is the Fn167 dot count, valid range 1-16.
    expect(() => esc().qr("x", { moduleSize: 0 })).toThrow(RangeError);
    expect(() => esc().qr("x", { moduleSize: 17 })).toThrow(RangeError);
    expect(() => esc().qr("x", { moduleSize: -1 })).toThrow(RangeError);
    expect(() => esc().qr("x", { moduleSize: 1.5 })).toThrow(RangeError);
    // The valid boundaries still emit the right Fn167 module-size byte, which sits at index 16
    // (Fn165 occupies indices 0-8; Fn167's first 7 bytes are indices 9-15).
    expect(esc().qr("x", { moduleSize: 1 }).bytes()[16]).toBe(0x01);
    expect(esc().qr("x", { moduleSize: 16 }).bytes()[16]).toBe(0x10);
  });

  it("qr rejects a text whose store-data length would overflow the 16-bit pL/pH field", () => {
    // storeLen = data bytes + 3; 0x10000 Latin-1 bytes → 0x10003, above the 0xFFFF pL/pH maximum.
    expect(() => esc().qr("a".repeat(0x10000))).toThrow(RangeError);
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

  it("qrRaster rejects an empty or non-square matrix", () => {
    // An empty or ragged matrix would emit a GS v 0 header whose dimensions do not match its rows
    // (an empty matrix yields a width/height-0 header — a malformed payload).
    expect(() => esc().qrRaster([])).toThrow(RangeError);
    expect(() => esc().qrRaster([[true, false], [true]])).toThrow(RangeError);
  });

  it("qrRaster rejects a non-positive or non-integer moduleSize", () => {
    // moduleSize <= 0 makes the module→pixel division invalid and can emit a 0-sized bit image.
    expect(() => esc().qrRaster([[true]], { moduleSize: 0 })).toThrow(RangeError);
    expect(() => esc().qrRaster([[true]], { moduleSize: -1 })).toThrow(RangeError);
    expect(() => esc().qrRaster([[true]], { moduleSize: 1.5 })).toThrow(RangeError);
  });
});

/** `GS v 0` with normal density, then width in bytes and height in dots, low byte first. */
const header = (widthBytes: number, heightDots: number) => [
  0x1d,
  0x76,
  0x30,
  0x00,
  widthBytes & 0xff,
  widthBytes >> 8,
  heightDots & 0xff,
  heightDots >> 8,
];

const NETUM_58 = { paperWidth: "58mm", resolution: "203dpi" } as const;
const TM_T88_58 = { paperWidth: "58mm", resolution: "180dpi" } as const;
const TM_T88_80 = { paperWidth: "80mm", resolution: "180dpi" } as const;

describe("text drawn as images", () => {
  it("draws a line as one 28-dot band the width of the setting, its text on the setting's grid", () => {
    // 58 mm at 203 dpi: 384 dots, 48 bytes a row; 30 columns centred from dot 12.
    expect([...esc(NETUM_58).line("Café 5 €").bytes()]).toEqual([
      ...header(48, 28),
      ...expectedBand(384, cellsFrom("Café 5 €", 12)),
    ]);
    // 80 mm at 180 dpi: 512 dots, 64 bytes a row; 42 columns centred from dot 4.
    expect([...esc(TM_T88_80).line("Café 5 €").bytes()]).toEqual([
      ...header(64, 28),
      ...expectedBand(512, cellsFrom("Café 5 €", 4)),
    ]);
  });

  it("collects text() into the line the next line() draws", () => {
    expect([...esc(TM_T88_58).text("Ca").text("fé").line(" 5 €").bytes()]).toEqual([
      ...esc(TM_T88_58).line("Café 5 €").bytes(),
    ]);
  });

  it("draws an empty line as a blank band of the same size", () => {
    expect([...esc(TM_T88_58).line().bytes()]).toEqual([
      ...header(45, 28),
      ...new Array(45 * 28).fill(0),
    ]);
  });

  it("still sends ESC a, and places the text in whole cells by the alignment", () => {
    expect([
      ...esc(TM_T88_58).align("center").line("Hola").align("right").line("Hola").bytes(),
    ]).toEqual([
      0x1b,
      0x61,
      1,
      ...header(45, 28),
      ...expectedBand(360, cellsFrom("Hola", 13 * 12)),
      0x1b,
      0x61,
      2,
      ...header(45, 28),
      ...expectedBand(360, cellsFrom("Hola", 26 * 12)),
    ]);
  });

  it("draws text left waiting by text() before the next command, and at bytes()", () => {
    expect([...esc(TM_T88_58).text("A").feed(1).bytes()]).toEqual([
      ...esc(TM_T88_58).line("A").bytes(),
      0x1b,
      0x64,
      1,
    ]);
    expect([...esc(TM_T88_58).text("A").bytes()]).toEqual([...esc(TM_T88_58).line("A").bytes()]);
  });

  it("draws a line on a grid other than the setting's", () => {
    expect([...esc(TM_T88_80).lineOn(gridForWidth(360), "Hi").bytes()]).toEqual([
      ...header(45, 28),
      ...expectedBand(360, cellsFrom("Hi", 0)),
    ]);
    expect([...esc().lineOn(gridForWidth(576)).bytes()]).toEqual([
      ...header(72, 28),
      ...new Array(72 * 28).fill(0),
    ]);
  });

  it("refuses to draw text without a paper width and resolution to draw it to", () => {
    expect(() => esc().line("A")).toThrow(/paper width/);
    expect(() => esc().text("A").bytes()).toThrow(/paper width/);
  });

  it("draws any picture as a GS v 0 image, rows packed most significant bit first", () => {
    // A 10-dot-wide, 2-dot-tall picture: a diagonal plus the last column.
    expect([
      ...esc()
        .raster(10, 2, (x, y) => x === y || x === 9)
        .bytes(),
    ]).toEqual([
      ...header(2, 2),
      0x80,
      0x40, // row 0: dots 0 and 9
      0x40,
      0x40, // row 1: dots 1 and 9
    ]);
  });

  it("refuses a picture with no dots or a fractional size", () => {
    expect(() => esc().raster(0, 1, () => true)).toThrow(RangeError);
    expect(() => esc().raster(1, 0, () => true)).toThrow(RangeError);
    expect(() => esc().raster(1.5, 1, () => true)).toThrow(RangeError);
  });

  it("sends a whole job with no text-mode command and no text bytes", () => {
    const every = GLYPHS.map(([codePoint]) => String.fromCodePoint(codePoint)).join("");
    const b = esc(TM_T88_80).init().printArea(512).align("center");
    for (let i = 0; i < every.length; i += 42) b.line(every.slice(i, i + 42));
    b.line()
      .qrRaster([[true]])
      .feedAndCut()
      .kick();
    const names = new Set(escPosCommands(b.bytes()).map(({ name }) => name));
    expect([...names].sort()).toEqual([
      "ESC @",
      "ESC a",
      "ESC d",
      "ESC p",
      "GS L",
      "GS V",
      "GS W",
      "GS v 0",
    ]);
  });
});
