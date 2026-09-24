/**
 * An ESC/POS command builder for `print_jobs.payload`; the rest of the package treats the payload as
 * opaque. The sequences follow the Epson ESC/POS reference; a physical printer is checked by hand.
 */

import {
  DEFAULT_CHARACTER_TABLE,
  encodeText,
  selectCharacterTable,
  type CharacterSet,
} from "./charset.js";

const ESC = 0x1b;
const GS = 0x1d;
/** Prints the buffered line and advances one line. */
const LF = 0x0a;

/**
 * Blank lines fed before the cut. The cutter sits above the print head: three lines left the Epson
 * TM-T88III's cut on the last printed line (test print, 2026-09-11); five has not been measured on
 * paper yet.
 */
export const FEED_BEFORE_CUT = 5;

/** A builder created without a character set, and `qr()`'s stored data, encode as Latin-1. */
const TEXT_ENCODING = "latin1";

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

export class EscBuilder {
  private readonly parts: number[] = [];

  constructor(
    private current?: CharacterSet,
    private currentTable: number | undefined = current === undefined
      ? undefined
      : DEFAULT_CHARACTER_TABLE[current],
  ) {}

  /** `ESC @` resets; `FS .` cancels Kanji mode so text stays single-byte. */
  init(): this {
    this.parts.push(ESC, 0x40);
    if (this.current !== undefined) {
      if (this.current !== "plain" && this.currentTable !== undefined)
        this.parts.push(...selectCharacterTable(this.currentTable));
      this.parts.push(0x1c, 0x2e);
    }
    return this;
  }

  charset(cs: CharacterSet, table: number | undefined = DEFAULT_CHARACTER_TABLE[cs]): this {
    this.current = cs;
    this.currentTable = table;
    if (cs !== "plain" && table !== undefined) this.parts.push(...selectCharacterTable(table));
    return this;
  }

  text(s: string): this {
    if (this.current === undefined) {
      for (const b of Buffer.from(s, TEXT_ENCODING)) this.parts.push(b);
    } else {
      for (const b of encodeText(s, this.current)) this.parts.push(b);
    }
    return this;
  }

  line(s?: string): this {
    if (s !== undefined) this.text(s);
    this.parts.push(LF);
    return this;
  }

  /** `ESC d n`. */
  feed(n = 1): this {
    this.parts.push(ESC, 0x64, n & 0xff);
    return this;
  }

  /** Full cut, `GS V 0`, wherever the paper is: a ticket ends with {@link feedAndCut} instead. */
  cut(): this {
    this.parts.push(GS, 0x56, 0x00);
    return this;
  }

  feedAndCut(): this {
    return this.feed(FEED_BEFORE_CUT).cut();
  }

  /** Pulse the cash drawer: `ESC p 0 25 250` — connector pin 2, 50ms on, 500ms off (units of 2ms). */
  kick(): this {
    this.parts.push(ESC, 0x70, 0x00, 0x19, 0xfa);
    return this;
  }

  /**
   * Native QR through the printer's own `GS ( k` engine (cn = 0x31 selects QR). The five functions
   * must be sent in this order: model, module size, EC level, store data, print. `text` is always
   * stored as Latin-1, whatever the builder's character set. The receipt's fiscal QR does not use
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
    const data = Buffer.from(text, TEXT_ENCODING);
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
   * caller does the QR encoding. `GS v 0 m xL xH yL yH d1…dk`: x is bytes per row, y is dots high,
   * rows are packed MSB-first with a set bit printing, and a row's last byte is zero-padded.
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
    const widthBytes = Math.ceil(pixelSide / 8);
    this.parts.push(
      GS,
      0x76,
      0x30,
      0x00,
      widthBytes & 0xff,
      (widthBytes >> 8) & 0xff,
      pixelSide & 0xff,
      (pixelSide >> 8) & 0xff,
    );
    for (let my = 0; my < side; my++) {
      const row = modules[my];
      for (let sy = 0; sy < moduleSize; sy++) {
        for (let bx = 0; bx < widthBytes; bx++) {
          let byte = 0;
          for (let bit = 0; bit < 8; bit++) {
            const mx = Math.floor((bx * 8 + bit) / moduleSize);
            if (mx < side && row[mx]) byte |= 0x80 >> bit;
          }
          this.parts.push(byte);
        }
      }
    }
    return this;
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

export function esc(charset?: CharacterSet, characterTable?: number): EscBuilder {
  return new EscBuilder(charset, characterTable);
}
