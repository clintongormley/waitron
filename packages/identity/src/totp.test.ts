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
    // otplib@13.4.1's guardrails THROW on a token that is not six digits ("Token must be 6 digits,
    // got 10"); verifyTotp's catch must swallow that and fail closed. (v12 returned false directly.)
    expect(verifyTotp("not-a-code", generateTotpSecret())).toBe(false);
  });
  it("rejects a malformed secret without throwing", () => {
    // otplib@13.4.1's Base32 plugin THROWS on a non-base32 secret ("Invalid Base32 string"); the
    // catch must fail closed. (v12 returned false directly.)
    expect(verifyTotp("123456", "!!!not-base32!!!")).toBe(false);
  });
  it("fails closed when otplib throws on a missing secret", () => {
    // `secret` is `string` by TYPE only; a value from an untyped boundary (a loosely-typed DB row,
    // JSON, `any`) can reach this at runtime. Probed against otplib@13.4.1: a null/undefined/empty
    // secret makes verifySync throw a guardrails error ("Secret is required") — the catch must
    // swallow it and fail closed, never surface the throw to a caller. This is one of THREE throwing
    // input classes the catch guards (a malformed base32 secret and a non-six-digit token are the
    // others); only a well-formed-but-wrong six-digit token returns false above without throwing.
    expect(verifyTotp("123456", null as unknown as string)).toBe(false);
  });
  it("builds an otpauth uri naming the issuer", () => {
    const uri = totpAuthUri(generateTotpSecret(), "ada@example.com");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("issuer=Waitron");
  });
});
