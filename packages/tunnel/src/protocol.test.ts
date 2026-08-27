import { describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame, type Frame } from "./protocol.js";

describe("encodeFrame", () => {
  it("serialises a frame as one newline-terminated JSON line", () => {
    expect(encodeFrame({ t: "ack" }).toString()).toBe('{"t":"ack"}\n');
  });
});

describe("decodeFrame", () => {
  it("returns null when no complete line is buffered yet", () => {
    expect(decodeFrame(Buffer.from('{"t":"a'))).toBeNull();
  });

  it("returns the first frame and the empty rest for one exact line", () => {
    const r = decodeFrame(encodeFrame({ t: "ping" }));
    expect(r).not.toBeNull();
    expect(r!.frame).toEqual({ t: "ping" });
    expect(r!.rest.length).toBe(0);
  });

  it("returns ONLY the first frame, leaving the second in rest", () => {
    const buf = Buffer.concat([encodeFrame({ t: "ack" }), encodeFrame({ t: "go" })]);
    const r = decodeFrame(buf)!;
    expect(r.frame).toEqual({ t: "ack" });
    expect(r.rest.toString()).toBe('{"t":"go"}\n');
  });

  it("hands raw post-go bytes back untouched as rest (the splice leftover)", () => {
    // A TLS ClientHello starts 0x16 0x03; it must never be parsed as a frame.
    const tls = Buffer.from([0x16, 0x03, 0x01, 0x00, 0x2a]);
    const buf = Buffer.concat([encodeFrame({ t: "go" }), tls]);
    const r = decodeFrame(buf)!;
    expect(r.frame).toEqual({ t: "go" });
    expect(r.rest.equals(tls)).toBe(true);
  });

  it("accepts a frame split across two reads by re-decoding the concatenation", () => {
    const whole = encodeFrame({ t: "reject", code: "tunnel.registration_rejected" });
    const first = whole.subarray(0, 5);
    expect(decodeFrame(first)).toBeNull();
    const r = decodeFrame(Buffer.concat([first, whole.subarray(5)]))!;
    expect(r.frame).toEqual({ t: "reject", code: "tunnel.registration_rejected" } satisfies Frame);
  });
});
