import { describe, expect, it, vi } from "vitest";
import { generateSync } from "otplib";
import { generateTotpSecret, totpAuthUri, verifyTotp } from "./totp.js";

describe("totp", () => {
  it("verifies a token generated from the same secret", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(generateSync({ secret }), secret)).toBe(true);
  });
  it("rejects a wrong token", () => {
    // Any fixed code is valid for some secret at some time; at this secret and clock `000000` is.
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    const now = Date.parse("2027-04-14T12:04:00Z") / 1000;
    vi.useFakeTimers({ now: now * 1000 });
    try {
      expect(verifyTotp("000000", secret)).toBe(true);
      const accepted = new Set(
        [-60, -30, 0, 30, 60].map((offset) => generateSync({ secret, epoch: now + offset })),
      );
      const wrong = ["000000", "111111", "222222", "333333", "444444", "555555"].find(
        (code) => !accepted.has(code),
      )!;
      expect(verifyTotp(wrong, secret)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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
