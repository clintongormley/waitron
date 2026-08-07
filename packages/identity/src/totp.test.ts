import { describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { generateTotpSecret, totpAuthUri, verifyTotp } from "./totp.js";

describe("totp", () => {
  it("verifies a token generated from the same secret", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(authenticator.generate(secret), secret)).toBe(true);
  });
  it("rejects a wrong token", () => {
    expect(verifyTotp("000000", generateTotpSecret())).toBe(false);
  });
  it("rejects a malformed token without throwing", () => {
    expect(verifyTotp("not-a-code", generateTotpSecret())).toBe(false);
  });
  it("rejects a malformed secret without throwing", () => {
    expect(verifyTotp("123456", "!!!not-base32!!!")).toBe(false);
  });
  it("fails closed when otplib throws on a non-string secret", () => {
    // The params are `string` by TYPE only; a value from an untyped boundary (a loosely-typed DB
    // row, JSON, `any`) can reach this at runtime. Probed against otplib@12.0.1: a non-string
    // secret makes the base32 decoder throw a TypeError — the catch must swallow it and fail
    // closed, never surface the throw to a caller. This is the sole input that reaches the catch;
    // malformed base32 STRINGS and non-numeric tokens return false above without throwing.
    expect(verifyTotp("123456", null as unknown as string)).toBe(false);
  });
  it("builds an otpauth uri naming the issuer", () => {
    const uri = totpAuthUri(generateTotpSecret(), "ada@example.com");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("issuer=Waitron");
  });
});
