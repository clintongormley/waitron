/**
 * An ESC/POS command builder for `print_jobs.payload`; the rest of the package treats the payload as
 * opaque. The sequences follow the Epson ESC/POS reference; a physical printer is checked by hand.
 */

import { textGrid, type PaperWidth, type Resolution, type TextGrid } from "./layout.js";
import { TEXT_BAND_HEIGHT, drawTextBand, type Alignment } from "./raster-text.js";

const ESC = 0x1b;
const GS = 0x1d;

/**
 * Blank lines fed before the cut. The cutter sits above the print head: three lines left the Epson
 * TM-T88III's cut on the last printed line (test print, 2026-09-11); five has not been measured on
 * paper yet.
 */
export const FEED_BEFORE_CUT = 5;

/** `qr()` stores its data as Latin-1; it is data for the printer's QR engine, not printed text. */
const QR_DATA_ENCODING = "latin1";

/**
 * QR error-correction level → the `GS ( k` Function 169 parameter byte. Source:
 * https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lparen_lk_fn169.html
 */
const QR_EC_LEVEL: Readonly<Record<"L" | "M" | "Q" | "H", number>> = {
  L: 0x30,
  M: 0x31,
  Q: 0x32,
  H: 0x33,
};

const QR_DEFAULT_MODULE_SIZE = 6;

/** The printer setting a job's text is drawn to. */
export interface EscSetting {
  paperWidth: PaperWidth;
  resolution: Resolution;
}

/**
 * Text is never sent as text: each line is drawn to a `GS v 0` image {@link TEXT_BAND_HEIGHT} dots
 * tall and as wide as the setting's dot width, so no printer character table is involved.
 */
export class EscBuilder {
  private readonly parts: number[] = [];
  private alignment: Alignment = "left";
  /** Undefined for a builder made without a setting, which can send anything but text. */
  readonly grid: TextGrid | undefined;

  constructor(setting?: EscSetting) {
    this.grid =
      setting === undefined ? undefined : textGrid(setting.paperWidth, setting.resolution);
  }

  private push(...bytes: number[]): void {
    for (const b of bytes) this.parts.push(b);
  }

  /** `ESC @`, which also returns the printer's alignment to left, so text lines follow suit. */
  init(): this {
    this.push(ESC, 0x40);
    this.alignment = "left";
    return this;
  }

  /** Draws `s` as one band on the setting's grid; no text draws a blank band. */
  line(s = ""): this {
    if (this.grid === undefined) {
      throw new Error(
        "esc() was made without a paper width and resolution, so it cannot draw text",
      );
    }
    this.pushRaster(
      Math.ceil(this.grid.widthDots / 8),
      TEXT_BAND_HEIGHT,
      drawTextBand(s, this.grid, this.alignment),
    );
    return this;
  }

  /**
   * `ESC a n`, which positions images (a QR code) on the printer; text lines are drawn full width, so
   * for them the alignment picks the grid cells their text starts in.
   */
  align(alignment: Alignment): this {
    this.push(ESC, 0x61, { left: 0, center: 1, right: 2 }[alignment]);
    this.alignment = alignment;
    return this;
  }

  /** A 1-bit picture `widthDots` × `heightDots`, `dot(x, y)` true where it prints. */
  raster(widthDots: number, heightDots: number, dot: (x: number, y: number) => boolean): this {
    for (const [name, value] of [
      ["widthDots", widthDots],
      ["heightDots", heightDots],
    ] as const) {
      if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`raster ${name} must be an integer >= 1, got ${value}`);
      }
    }
    this.pushRaster(Math.ceil(widthDots / 8), heightDots, packRows(widthDots, heightDots, dot));
    return this;
  }

  /**
   * `GS v 0 m xL xH yL yH d1…dk`: x is bytes per row, y is dots high, rows are packed MSB-first with a
   * set bit printing, and a row's last byte is zero-padded.
   */
  private pushRaster(widthBytes: number, heightDots: number, data: Uint8Array): void {
    if (widthBytes > 0xffff || heightDots > 0xffff) {
      throw new RangeError(
        `GS v 0's 16-bit size fields hold at most ${0xffff} bytes across and ${0xffff} dots down, got ${widthBytes} × ${heightDots}`,
      );
    }
    this.parts.push(
      GS,
      0x76,
      0x30,
      0x00,
      widthBytes & 0xff,
      (widthBytes >> 8) & 0xff,
      heightDots & 0xff,
      (heightDots >> 8) & 0xff,
    );
    for (const b of data) this.parts.push(b);
  }

  /** `GS L nL nH` followed by `GS W nL nH`, in dots. */
  printArea(widthDots: number): this {
    this.push(GS, 0x4c, 0x00, 0x00);
    this.push(GS, 0x57, widthDots & 0xff, (widthDots >> 8) & 0xff);
    return this;
  }

  /** `ESC d n`. */
  feed(n = 1): this {
    this.push(ESC, 0x64, n & 0xff);
    return this;
  }

  /** Full cut, `GS V 0`, wherever the paper is: a ticket ends with {@link feedAndCut} instead. */
  cut(): this {
    this.push(GS, 0x56, 0x00);
    return this;
  }

  feedAndCut(): this {
    return this.feed(FEED_BEFORE_CUT).cut();
  }

  /** Pulse the cash drawer: `ESC p 0 25 250` — connector pin 2, 50ms on, 500ms off (units of 2ms). */
  kick(): this {
    this.push(ESC, 0x70, 0x00, 0x19, 0xfa);
    return this;
  }

  /**
   * Native QR through the printer's own `GS ( k` engine (cn = 0x31 selects QR). The five functions
   * must be sent in this order: model, module size, EC level, store data, print. `text` is always
   * stored as Latin-1. The receipt's fiscal QR does not use
   * this: it is a `qrRaster` image sized by `chooseQrDots`.
   */
  qr(text: string, opts: { ecLevel?: "L" | "M" | "Q" | "H"; moduleSize?: number } = {}): this {
    const { ecLevel = "M", moduleSize = QR_DEFAULT_MODULE_SIZE } = opts;
    // Function 167 accepts 1-16 dots; `& 0xff` below would otherwise mask a bad value into a byte.
    if (!Number.isInteger(moduleSize) || moduleSize < 1 || moduleSize > 16) {
      throw new RangeError(
        `qr moduleSize must be an integer in [1, 16] (ESC/POS GS ( k Fn167), got ${moduleSize}`,
      );
    }
    // Function 180's length counts cn, fn and m as well as the data, in a 16-bit pL/pH field.
    const data = Buffer.from(text, QR_DATA_ENCODING);
    const storeLen = data.length + 3;
    if (storeLen > 0xffff) {
      throw new RangeError(
        `qr store-data length (data bytes + 3 = ${storeLen}) exceeds the 16-bit pL/pH field maximum of ${0xffff}`,
      );
    }
    // Fn 165 — select model: cn=0x31, fn=0x41, n1=0x32 (model 2), n2=0x00; length field pL=0x04.
    this.parts.push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    // Fn 167 — set module size: cn=0x31, fn=0x43, n=moduleSize dots (1-16); length pL=0x03.
    this.parts.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize & 0xff);
    // Fn 169 — select EC level: cn=0x31, fn=0x45, n per QR_EC_LEVEL; length pL=0x03.
    this.parts.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, QR_EC_LEVEL[ecLevel]);
    // Fn 180 — store data: cn=0x31, fn=0x50, m=0x30; pL/pH = storeLen, low byte first.
    this.parts.push(GS, 0x28, 0x6b, storeLen & 0xff, (storeLen >> 8) & 0xff, 0x31, 0x50, 0x30);
    for (const b of data) this.parts.push(b);
    // Fn 181 — print symbol: cn=0x31, fn=0x51, m=0x30; length pL=0x03.
    this.parts.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
    return this;
  }

  /**
   * Packs an already-computed square module matrix (`true` = dark) into a `GS v 0` raster image; the
   * caller does the QR encoding.
   */
  qrRaster(modules: boolean[][], opts: { moduleSize?: number } = {}): this {
    const { moduleSize = QR_DEFAULT_MODULE_SIZE } = opts;
    if (!Number.isInteger(moduleSize) || moduleSize < 1) {
      throw new RangeError(`qrRaster moduleSize must be an integer >= 1, got ${moduleSize}`);
    }
    const side = modules.length;
    if (side === 0 || modules.some((row) => row.length !== side)) {
      throw new RangeError(
        `qrRaster modules must be a non-empty square matrix (every row length === row count ${side})`,
      );
    }
    const pixelSide = side * moduleSize;
    this.pushRaster(
      Math.ceil(pixelSide / 8),
      pixelSide,
      packRows(
        pixelSide,
        pixelSide,
        (x, y) => modules[Math.floor(y / moduleSize)]![Math.floor(x / moduleSize)]!,
      ),
    );
    return this;
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

/** Rows of `dot`, MSB first, each padded with zero bits to a whole byte. */
function packRows(
  widthDots: number,
  heightDots: number,
  dot: (x: number, y: number) => boolean,
): Uint8Array {
  const stride = Math.ceil(widthDots / 8);
  const data = new Uint8Array(stride * heightDots);
  for (let y = 0; y < heightDots; y++) {
    for (let x = 0; x < widthDots; x++) {
      if (dot(x, y)) data[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return data;
}

/** Without a setting the builder sends everything but text: a drawer pulse needs no paper width. */
export function esc(setting: EscSetting): EscBuilder & { readonly grid: TextGrid };
export function esc(): EscBuilder;
export function esc(setting?: EscSetting): EscBuilder {
  return new EscBuilder(setting);
}
