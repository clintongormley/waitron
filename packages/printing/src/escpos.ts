/**
 * A tiny, reusable ESC/POS command builder (design §3d) — the byte assembler Slice B (kitchen
 * tickets) and the later customer-receipt + cash-drawer consumers use to fill a `print_jobs.payload`.
 * The printing subsystem itself only MOVES the bytes (the payload is opaque to it); this builder is
 * how a consumer PRODUCES them.
 *
 * Chainable: every verb returns `this`, so `esc().init().line("Mesa 4").cut().bytes()` reads as the
 * ticket does. `.bytes()` materialises the accumulated commands into a fresh `Uint8Array`.
 *
 * The command constants below are the canonical ESC/POS sequences (the Epson TM/Star command set the
 * deli-hardware `ReceiptPrinter` targets). A physical printer is verified MANUALLY (design §5 — the
 * fake-sink approach); the guarantee this module carries is only that the bytes are DETERMINISTIC and
 * match those documented sequences, which escpos.test.ts pins byte for byte.
 */

/** ESC — the escape lead byte (0x1B) beginning most two/three-byte commands. */
const ESC = 0x1b;
/** GS — the group-separator lead byte (0x1D) beginning the cut command. */
const GS = 0x1d;
/** LF — line feed (0x0A): prints the buffered line and advances one line. */
const LF = 0x0a;

/**
 * Text encoding: ONE byte per character via Latin-1 (ISO-8859-1), so every code point 0x00-0xFF maps
 * to its own byte. ESC/POS printers are byte-oriented and interpret bytes through a selected code
 * page; picking that code page (CP437/CP858/…) is a CONSUMER concern, not the builder's, so the
 * builder does not UTF-8-encode — that would emit multi-byte sequences a single-byte code page would
 * mis-render. Pure-ASCII content (the common case) is unaffected either way.
 */
const TEXT_ENCODING = "latin1";

/**
 * QR error-correction level → the ESC/POS `GS ( k <Function 169>` parameter byte. Level M (0x31,
 * ~15 % recovery) is the default, mandated for the fiscal cotejo QR by Orden HAC/1177/2024 art.
 * 21.1. Byte values verified against the Epson ESC/POS TM-printer reference (GS ( k Function 169,
 * https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lparen_lk_fn169.html) and
 * cross-checked against the escpos-coffee reference implementation
 * (github.com/anastaciocintra/escpos-coffee, src/main/java/.../barcode/QRCode.java: M = 49).
 */
const QR_EC_LEVEL: Readonly<Record<"L" | "M" | "Q" | "H", number>> = {
  L: 0x30,
  M: 0x31,
  Q: 0x32,
  H: 0x33,
};

/**
 * Default QR module size in printer dots. At ~203 dpi (≈ 8 dots/mm) a Veri*Factu cotejo-URL QR
 * encodes to roughly version 6–9 (41–53 modules per side) at EC level M, so 6 dots/module prints a
 * symbol of 41 × 6 / 8 ≈ 30.8 mm … 53 × 6 / 8 ≈ 39.8 mm — inside the mandated 30–40 mm band (Orden
 * HAC/1177/2024 art. 21.1). The EXACT printed size depends on the QR version (content length) and is
 * verified MANUALLY on the real printer (design §5); the byte tests pin only the deterministic
 * command bytes, not the millimetres.
 */
const QR_DEFAULT_MODULE_SIZE = 6;

/**
 * The chainable builder returned by {@link esc}. Accumulates raw bytes; `bytes()` snapshots them.
 * Kept a class (not a bare closure) so the fluent chain has a nameable return type consumers can
 * annotate.
 */
export class EscBuilder {
  private readonly parts: number[] = [];

  /** Initialise the printer — `ESC @`. Resets modes to power-on defaults; the usual first command. */
  init(): this {
    this.parts.push(ESC, 0x40);
    return this;
  }

  /** Append the Latin-1 bytes of `s` with no terminator — raw text for the current line. */
  text(s: string): this {
    for (const b of Buffer.from(s, TEXT_ENCODING)) this.parts.push(b);
    return this;
  }

  /** Append `s` (if given) followed by a single LF — one printed line. `line()` alone emits a bare LF. */
  line(s?: string): this {
    if (s !== undefined) this.text(s);
    this.parts.push(LF);
    return this;
  }

  /** Feed `n` lines — `ESC d n`. `n` is a single byte (0-255); defaults to 1. */
  feed(n = 1): this {
    this.parts.push(ESC, 0x64, n & 0xff);
    return this;
  }

  /** Full cut — `GS V 0`. Severs the paper completely. */
  cut(): this {
    this.parts.push(GS, 0x56, 0x00);
    return this;
  }

  /**
   * Pulse the cash drawer — `ESC p 0 25 250` (connector pin 2, ~50ms on, ~500ms off; the on/off units
   * are 2ms). The drawer is a PRINTER capability driven over the same channel (deli-hardware §6), so
   * it lives in this builder rather than a separate device path.
   */
  kick(): this {
    this.parts.push(ESC, 0x70, 0x00, 0x19, 0xfa);
    return this;
  }

  /**
   * Native QR Code — the `GS ( k` two-dimensional-symbol command family (lead bytes 0x1D 0x28 0x6B,
   * cn = 0x31 = QR Code; each operation picked by its `fn` byte). The PRINTER'S own QR engine encodes
   * `text`, so this builder needs no QR-encoding library (see {@link qrRaster} for the dependency-free
   * raster fallback). Emits, in the order the printer requires: select model 2, set module size, set
   * error-correction level, store the data, print the symbol.
   *
   * `text` is stored verbatim as its Latin-1 bytes — the same single-byte convention {@link text}
   * uses — which is exactly right for the ASCII Veri*Factu cotejo URL. Default EC level M is mandated
   * for that fiscal QR (Orden HAC/1177/2024 art. 21.1); `moduleSize` defaults per
   * {@link QR_DEFAULT_MODULE_SIZE}.
   *
   * Byte layout verified against the Epson ESC/POS TM-printer reference (GS ( k Functions 165/167/
   * 169/180/181, https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lparen_lk_fn180.html
   * et seq.) and the escpos-coffee reference implementation (github.com/anastaciocintra/escpos-coffee).
   * A physical printer is verified MANUALLY (design §5); the guarantee here is deterministic bytes.
   */
  qr(text: string, opts: { ecLevel?: "L" | "M" | "Q" | "H"; moduleSize?: number } = {}): this {
    const { ecLevel = "M", moduleSize = QR_DEFAULT_MODULE_SIZE } = opts;
    // Fn 165 — select model: cn=0x31, fn=0x41, n1=0x32 (model 2), n2=0x00; length field pL=0x04.
    this.parts.push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    // Fn 167 — set module size: cn=0x31, fn=0x43, n=moduleSize dots (1-16); length pL=0x03.
    this.parts.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize & 0xff);
    // Fn 169 — select EC level: cn=0x31, fn=0x45, n per QR_EC_LEVEL; length pL=0x03.
    this.parts.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, QR_EC_LEVEL[ecLevel]);
    // Fn 180 — store data: cn=0x31, fn=0x50, m=0x30; length field = (data bytes + 3), the +3 covering
    // cn, fn and m. pL = low byte, pH = high byte.
    const data = Buffer.from(text, TEXT_ENCODING);
    const storeLen = data.length + 3;
    this.parts.push(GS, 0x28, 0x6b, storeLen & 0xff, (storeLen >> 8) & 0xff, 0x31, 0x50, 0x30);
    for (const b of data) this.parts.push(b);
    // Fn 181 — print symbol: cn=0x31, fn=0x51, m=0x30; length pL=0x03.
    this.parts.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
    return this;
  }

  /**
   * Raster fallback for printers whose firmware lacks the native `GS ( k` QR engine: packs an
   * ALREADY-COMPUTED square boolean module matrix (`true` = dark module) into a `GS v 0` raster
   * bit-image. It performs NO QR encoding — the caller supplies the matrix — so `@waitron/printing`
   * keeps its dependency-free "pure byte assembler" shape (no `qrcode` library). Not wired to a
   * consumer in this slice; `formatReceipt` uses the native {@link qr}.
   *
   * `GS v 0 m xL xH yL yH d1…dk` (lead bytes 0x1D 0x76 0x30): m=0 (normal); xL/xH = bytes per row =
   * ceil(pixelWidth / 8); yL/yH = pixel height. Each module expands to `moduleSize`×`moduleSize`
   * pixels; rows are packed MSB-first, a set bit meaning a dark (printed) pixel, and the final byte of
   * a row is zero-padded on the right. Verified against the ESC/POS `GS v 0` raster-bit-image
   * specification (Epson TM-printer reference / escpos.readthedocs.io imaging).
   */
  qrRaster(modules: boolean[][], opts: { moduleSize?: number } = {}): this {
    const { moduleSize = QR_DEFAULT_MODULE_SIZE } = opts;
    const side = modules.length; // square: side × side modules
    const pixelSide = side * moduleSize;
    const widthBytes = Math.ceil(pixelSide / 8);
    // GS v 0, m=0 (normal); width in bytes per row, then height in dots — each as low/high byte.
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
        // Each module row prints `moduleSize` identical pixel rows (vertical expansion).
        for (let bx = 0; bx < widthBytes; bx++) {
          let byte = 0;
          for (let bit = 0; bit < 8; bit++) {
            const mx = Math.floor((bx * 8 + bit) / moduleSize); // pixel x → module x
            if (mx < side && row[mx]) byte |= 0x80 >> bit; // dark module → set bit, MSB first
          }
          this.parts.push(byte);
        }
      }
    }
    return this;
  }

  /** Snapshot the accumulated commands as a FRESH `Uint8Array` — a copy, so the caller can hand it to
   * the outbox / a transport and keep building or mutate the result without disturbing this builder. */
  bytes(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

/** Start a new ESC/POS command chain. */
export function esc(): EscBuilder {
  return new EscBuilder();
}
