import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { generateNodeKeyPair, signBytes, verifyBytes } from "./crypto.js";
import "./errors.js";

describe("crypto", () => {
  it("round-trips a signature", () => {
    const kp = generateNodeKeyPair();
    const sig = signBytes("hello", kp.privateKey);
    expect(verifyBytes("hello", sig, kp.publicKey)).toBe(true);
  });
  it("rejects a tampered message", () => {
    const kp = generateNodeKeyPair();
    const sig = signBytes("hello", kp.privateKey);
    expect(verifyBytes("hell0", sig, kp.publicKey)).toBe(false);
  });
  it("rejects a signature from a different key", () => {
    const a = generateNodeKeyPair();
    const b = generateNodeKeyPair();
    const sig = signBytes("hello", a.privateKey);
    expect(verifyBytes("hello", sig, b.publicKey)).toBe(false);
  });
  it("returns false (never throws) on a malformed signature", () => {
    const kp = generateNodeKeyPair();
    expect(verifyBytes("hello", "not-base64-sig!!", kp.publicKey)).toBe(false);
  });
  it("returns false (never throws) on a malformed public key", () => {
    const kp = generateNodeKeyPair();
    const sig = signBytes("hello", kp.privateKey);
    // A public key travels in adversarial wire data, so garbage must fail closed, not throw.
    expect(verifyBytes("hello", sig, "not-a-public-key")).toBe(false);
  });
  it("throws membership.key_invalid on malformed key material", () => {
    let code = "";
    try {
      signBytes("hello", "not-a-key");
    } catch (e) {
      if (e instanceof AppError) code = e.code;
    }
    expect(code).toBe("membership.key_invalid");
  });
});
