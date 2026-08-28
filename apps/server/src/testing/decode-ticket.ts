/**
 * Decode an ESC/POS ticket payload (a `print_jobs.payload`) back to its Latin-1 text, for the
 * content assertions the kitchen-printing suites make. The escpos builder
 * (`packages/printing/src/escpos.ts`) encodes text as TRUE ISO-8859-1 — `Buffer.from(s, "latin1")`,
 * one byte per code point 0x00-0xFF — so `Buffer.from(bytes).toString("latin1")` is its exact
 * inverse and the canonical decode.
 *
 * Deliberately NOT `new TextDecoder("latin1")`: under the WHATWG Encoding Standard the label
 * "latin1" decodes as windows-1252, which re-maps bytes 0x80-0x9F to different code points. That is
 * harmless for the ASCII and accented-Latin content these tickets carry (both decoders agree there),
 * but it is not a true round-trip of the encoder, so this helper picks the byte-exact form.
 *
 * Accepts either the `Uint8Array` PGlite hands back from a bytea column or a `Buffer`; `Buffer.from`
 * copies either into a fresh Buffer before decoding.
 */
export function decodeTicket(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString("latin1");
}

/**
 * True iff `needle` occurs as a contiguous subsequence of `haystack`. The byte-exact counterpart to
 * {@link decodeTicket}'s text search: the ESC/POS suites use it to assert a raw byte fragment (the
 * drawer-kick pulse, a `qr()` command) is present in — or absent from — an enqueued payload, where a
 * Latin-1 text decode would mangle the control bytes. An empty `needle` is vacuously present.
 */
export function bytesInclude(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
