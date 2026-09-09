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
});
