import { describe, expect, it } from "vitest";
import { AppError, isAppError } from "@waitron/shared";
import { sniffImageType, validateImageBytes } from "./media.js";

// Magic-byte test vectors, taken from the real signatures (design §5b). Each carries a couple of
// trailing bytes so the sniffer sees "signature + payload", the shape a real file has.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
// "RIFF" (52 49 46 46), a 4-byte size, then "WEBP" (57 45 42 50) at offset 8, then payload.
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
]);
// A RIFF container that is NOT a WEBP — "RIFF····WAVE" — proves the second half of the WEBP guard.
const RIFF_WAVE = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d,
]);
// "GIF8" (47 49 46 38) — a recognisable but unsupported type, so `detected` can name it.
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const PLAIN_TEXT = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]); // "hello"
const EMPTY = new Uint8Array([]);

/** Run `fn`, return the thrown AppError, or fail if it did not throw one. */
function caught(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e) {
    if (isAppError(e)) return e;
    throw e;
  }
  throw new Error("expected the call to throw an AppError");
}

describe("sniffImageType", () => {
  it("recognises a JPEG signature", () => {
    expect(sniffImageType(JPEG)).toBe("jpg");
  });

  it("recognises a PNG signature", () => {
    expect(sniffImageType(PNG)).toBe("png");
  });

  it("recognises a WEBP signature (RIFF····WEBP)", () => {
    expect(sniffImageType(WEBP)).toBe("webp");
  });

  it("returns null for a RIFF container that is not WEBP", () => {
    expect(sniffImageType(RIFF_WAVE)).toBeNull();
  });

  it("returns null for a GIF signature", () => {
    expect(sniffImageType(GIF)).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(sniffImageType(PLAIN_TEXT)).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(sniffImageType(EMPTY)).toBeNull();
  });
});

describe("validateImageBytes", () => {
  it('accepts a JPEG buffer and returns "jpg"', () => {
    expect(validateImageBytes(JPEG)).toBe("jpg");
  });

  it('accepts a PNG buffer and returns "png"', () => {
    expect(validateImageBytes(PNG)).toBe("png");
  });

  it('accepts a WEBP buffer and returns "webp"', () => {
    expect(validateImageBytes(WEBP)).toBe("webp");
  });

  it("rejects a GIF buffer as media.unsupported_type, naming the detected type", () => {
    const err = caught(() => validateImageBytes(GIF));
    expect(err.code).toBe("media.unsupported_type");
    expect(err.params).toEqual({ detected: "gif" });
  });

  it("rejects a RIFF-but-not-WEBP buffer as media.unsupported_type", () => {
    const err = caught(() => validateImageBytes(RIFF_WAVE));
    expect(err.code).toBe("media.unsupported_type");
  });

  it("rejects plain text as media.unsupported_type, with no detected type", () => {
    const err = caught(() => validateImageBytes(PLAIN_TEXT));
    expect(err.code).toBe("media.unsupported_type");
    expect(err.params).toEqual({});
  });

  it("rejects an empty buffer as media.unsupported_type", () => {
    const err = caught(() => validateImageBytes(EMPTY));
    expect(err.code).toBe("media.unsupported_type");
    expect(err.params).toEqual({});
  });
});
