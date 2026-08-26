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
    const bytes = [...esc().init().line("Mesa 4").feed(2).cut().kick().bytes()];
    expect(bytes).toEqual([
      0x1b,
      0x40, // init
      0x4d,
      0x65,
      0x73,
      0x61,
      0x20,
      0x34,
      0x0a, // "Mesa 4" + LF
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
});
