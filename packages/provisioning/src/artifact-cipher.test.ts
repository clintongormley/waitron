import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptArtifact,
  encryptArtifact,
  encryptArtifactAsync,
  KDF_BY_VERSION,
  VERSION,
} from "./artifact-cipher.js";
import { SCRYPT_PARAMS } from "./scrypt-kdf.js";

describe("artifact cipher", () => {
  it("roundtrips arbitrary binary under the right passphrase", () => {
    const plaintext = randomBytes(4096);
    const framed = encryptArtifact(plaintext, "recovery-key-123");
    expect(decryptArtifact(framed, "recovery-key-123").equals(plaintext)).toBe(true);
  });

  it("does not contain the plaintext (it is encrypted)", () => {
    const plaintext = Buffer.from("SELECT secret FROM sales", "utf8");
    const framed = encryptArtifact(plaintext, "pw-000000000000");
    expect(framed.includes(plaintext)).toBe(false);
  });

  it("rejects the wrong passphrase with recovery.passphrase_invalid", () => {
    const framed = encryptArtifact(randomBytes(64), "right-passphrase");
    expect(() => decryptArtifact(framed, "wrong-passphrase")).toThrowError(
      expect.objectContaining({ code: "recovery.passphrase_invalid" }),
    );
  });

  it("rejects a tampered ciphertext", () => {
    const framed = encryptArtifact(randomBytes(64), "pw-000000000000");
    framed[framed.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => decryptArtifact(framed, "pw-000000000000")).toThrowError(
      expect.objectContaining({ code: "recovery.passphrase_invalid" }),
    );
  });

  it("rejects a tampered header byte (AAD authentication)", () => {
    const framed = encryptArtifact(randomBytes(64), "pw-000000000000");
    framed[5] ^= 0xff; // first salt byte — inside the authenticated header, frame still well-formed
    expect(() => decryptArtifact(framed, "pw-000000000000")).toThrowError(
      expect.objectContaining({ code: "recovery.passphrase_invalid" }),
    );
  });

  it("rejects a frame with a bad magic/version", () => {
    expect(() => decryptArtifact(Buffer.alloc(49), "pw-000000000000")).toThrowError(
      expect.objectContaining({ code: "backup.artifact_invalid" }),
    );
  });

  // A 49-byte frame is exactly the header length and hits the magic check, so the too_short reason
  // needs its own case.
  it("rejects a frame shorter than the header", () => {
    expect(() => decryptArtifact(Buffer.alloc(10), "pw-000000000000")).toThrowError(
      expect.objectContaining({
        code: "backup.artifact_invalid",
        params: { reason: "too_short" },
      }),
    );
  });

  // Fails when SCRYPT_PARAMS changes in place without a VERSION bump and a new frozen entry, which
  // would break decryption of every existing artifact.
  it("pins the current version's KDF params to the live SCRYPT_PARAMS default", () => {
    expect(KDF_BY_VERSION[VERSION]).toEqual(SCRYPT_PARAMS);
  });

  // The magic check runs before the version check, so this needs a valid magic to reach it.
  it("rejects a frame with a valid magic but an unknown version", () => {
    const framed = encryptArtifact(randomBytes(64), "pw-000000000000");
    framed[4] = 99; // version byte, right after the 4-byte magic
    expect(() => decryptArtifact(framed, "pw-000000000000")).toThrowError(
      expect.objectContaining({
        code: "backup.artifact_invalid",
        params: { reason: "bad_version" },
      }),
    );
  });

  it("opens a frame sealed off the main thread with the same reader", async () => {
    const plaintext = randomBytes(4096);
    const framed = await encryptArtifactAsync(plaintext, "recovery-key-123");
    expect(decryptArtifact(framed, "recovery-key-123").equals(plaintext)).toBe(true);
    expect(() => decryptArtifact(framed, "wrong-passphrase")).toThrowError(
      expect.objectContaining({ code: "recovery.passphrase_invalid" }),
    );
  });

  it("frames an off-thread seal exactly as the synchronous one: same magic, version and length", async () => {
    const plaintext = randomBytes(64);
    const sync = encryptArtifact(plaintext, "pw-000000000000");
    const off = await encryptArtifactAsync(plaintext, "pw-000000000000");
    expect(off.subarray(0, 5).equals(sync.subarray(0, 5))).toBe(true);
    expect(off.length).toBe(sync.length);
    // Fresh salt and IV each time, so the two frames differ past the magic and version.
    expect(off.equals(sync)).toBe(false);
  });
});
