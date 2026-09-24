import { describe, expect, it } from "vitest";
import { generateSync } from "otplib";
import { generateTotpSecret, totpAuthUri, verifyTotp } from "./totp.js";

describe("totp", () => {
  it("verifies a token generated from the same secret", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(generateSync({ secret }), secret)).toBe(true);
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
  it("fails closed when otplib throws on a missing secret", () => {
    // `secret` is `string` by TYPE only; a value from an untyped boundary can reach this at runtime.
    expect(verifyTotp("123456", null as unknown as string)).toBe(false);
  });
  it("builds an otpauth uri naming the issuer", () => {
    const uri = totpAuthUri(generateTotpSecret(), "ada@example.com");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("issuer=Waitron");
  });
});
