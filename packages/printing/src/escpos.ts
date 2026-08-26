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
