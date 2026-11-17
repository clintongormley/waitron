import { sealText, openText, loadKeyRing } from "@waitron/credentials";
import { describe, expect, it } from "vitest";

const current = { version: 7, key: Buffer.alloc(32, 7) };
const previous = { version: 6, key: Buffer.alloc(32, 6) };

describe("TOTP secret encryption", () => {
  it("stores the key version and decrypts through the matching ring member", () => {
    const stored = sealText({ current: previous }, "totp", "JBSWY3DPEHPK3PXP");
    expect(stored).toMatch(/^v2\.6\./);
    expect(openText({ current, previous }, "totp", stored)).toEqual({
      value: "JBSWY3DPEHPK3PXP",
      keyVersion: 6,
    });
  });

  it("rejects plaintext and ciphertext whose key version is unavailable", () => {
    expect(openText({ current }, "totp", "JBSWY3DPEHPK3PXP")).toBeNull();
    expect(
      openText({ current }, "totp", sealText({ current: previous }, "totp", "secret")),
    ).toBeNull();
  });

  it("refuses a vault key that is not 32 bytes before sealing", () => {
    expect(() =>
      sealText(
        loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(16, 1).toString("base64") }),
        "totp",
        "JBSWY3DPEHPK3PXP",
      ),
    ).toThrow(expect.objectContaining({ code: "credentials.key_invalid" }));
  });

  it("returns null for stored text that has the prefix but not the shape", () => {
    // Not five dot-separated parts, or a version that is not a whole number.
    const stored = sealText({ current: current }, "totp", "JBSWY3DPEHPK3PXP");
    expect(openText({ current }, "totp", stored.split(".").slice(0, 4).join("."))).toBeNull();
    expect(openText({ current }, "totp", `${stored}.extra`)).toBeNull();
    expect(openText({ current }, "totp", stored.replace(/^v2\.7\./, "v2.seven."))).toBeNull();
  });

  it("returns null when the ciphertext does not authenticate under the key its version names", () => {
    // A different key under the same version, and an altered ciphertext under the right key, both
    // fail the GCM tag check.
    const stored = sealText({ current: current }, "totp", "JBSWY3DPEHPK3PXP");
    expect(
      openText({ current: { version: 7, key: Buffer.alloc(32, 8) } }, "totp", stored),
    ).toBeNull();
    const parts = stored.split(".");
    const tampered = Buffer.from(parts[4]!, "base64url");
    tampered[0] = tampered[0]! ^ 1;
    parts[4] = tampered.toString("base64url");
    expect(openText({ current }, "totp", parts.join("."))).toBeNull();
  });
});
