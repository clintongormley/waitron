import { describe, expect, it } from "vitest";
import { decryptTotpSecret, encryptTotpSecret } from "./mfa.js";

const current = { version: 7, key: Buffer.alloc(32, 7) };
const previous = { version: 6, key: Buffer.alloc(32, 6) };

describe("TOTP secret encryption", () => {
  it("stores the key version and decrypts through the matching ring member", () => {
    const stored = encryptTotpSecret("JBSWY3DPEHPK3PXP", previous);
    expect(stored).toMatch(/^v1\.6\./);
    expect(decryptTotpSecret(stored, { current, previous })).toEqual({
      secret: "JBSWY3DPEHPK3PXP",
      keyVersion: 6,
    });
  });

  it("rejects plaintext and ciphertext whose key version is unavailable", () => {
    expect(decryptTotpSecret("JBSWY3DPEHPK3PXP", { current })).toBeNull();
    expect(decryptTotpSecret(encryptTotpSecret("secret", previous), { current })).toBeNull();
  });

  it("refuses to encrypt with a key that is not 32 bytes, rather than producing weak ciphertext", () => {
    // AES-256-GCM needs exactly 32 bytes. A short key is a misconfigured key ring, and the throw
    // is what stops a person's TOTP secret being stored under it.
    expect(() =>
      encryptTotpSecret("JBSWY3DPEHPK3PXP", { version: 1, key: Buffer.alloc(16, 1) }),
    ).toThrow("TOTP encryption key must contain 32 bytes");
  });

  it("returns null for stored text that has the prefix but not the shape", () => {
    // Anything that is not five dot-separated parts, or whose version is not a whole number, is
    // not something this format can decrypt — a truncated column or a value from another writer.
    // Null means "cannot read this", which is how the caller reports an enrolment it cannot use.
    const stored = encryptTotpSecret("JBSWY3DPEHPK3PXP", current);
    expect(decryptTotpSecret(stored.split(".").slice(0, 4).join("."), { current })).toBeNull();
    expect(decryptTotpSecret(`${stored}.extra`, { current })).toBeNull();
    expect(decryptTotpSecret(stored.replace(/^v1\.7\./, "v1.seven."), { current })).toBeNull();
  });
});
