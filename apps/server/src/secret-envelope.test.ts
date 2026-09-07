import { describe, it, expect } from "vitest";
import { encryptSecretEnvelope, decryptSecretEnvelope } from "./secret-envelope.js";

// Hermetic crypto — PGlite/real PG not involved; no DB.
describe("secret envelope", () => {
  const pass = "a-sufficiently-long-passphrase"; // ≥ 12
  it("round-trips an arbitrary string", () => {
    const env = encryptSecretEnvelope(
      '{"pfxBase64":"QQ==","passphrase":"x","certKind":"sello"}',
      pass,
    );
    expect(decryptSecretEnvelope(env, pass)).toBe(
      '{"pfxBase64":"QQ==","passphrase":"x","certKind":"sello"}',
    );
  });
  it("throws recovery.passphrase_invalid for the wrong passphrase", () => {
    const env = encryptSecretEnvelope("secret", pass);
    expect(() => decryptSecretEnvelope(env, "another-long-passphrase")).toThrowError(
      /passphrase_invalid/,
    );
  });
  it("rejects a too-short passphrase on encrypt", () => {
    expect(() => encryptSecretEnvelope("x", "short")).toThrowError(/passphrase_too_short/);
  });
});
