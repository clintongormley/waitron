import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptArtifact, encryptArtifact, KDF_BY_VERSION, VERSION } from "./artifact-cipher.js";
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

  // The header prefix (magic|version|salt|iv) is authenticated as GCM AAD, so tampering with a
  // header byte fails authentication exactly like a flipped ciphertext byte — it is NOT an
  // unauthenticated side-channel a tamperer can edit unnoticed. Flip a salt byte (offset 5, right
  // after magic+version) to a byte that still parses as a valid frame but no longer matches the AAD.
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

  // A 49-byte frame is exactly the header length, so it hits the magic check, not the length
  // guard — a truncated artifact (a corrupted download) is a distinct, realistic malformed-frame
  // shape and needs its own case to exercise the too_short reason at all.
  it("rejects a frame shorter than the header", () => {
    expect(() => decryptArtifact(Buffer.alloc(10), "pw-000000000000")).toThrowError(
      expect.objectContaining({
        code: "backup.artifact_invalid",
        params: { reason: "too_short" },
      }),
    );
  });

  // The current VERSION's frozen params must still equal the live SCRYPT_PARAMS today — they match
  // by construction. This FAILS the moment a future dev changes SCRYPT_PARAMS in place without
  // bumping VERSION and adding a new frozen entry, which is exactly the unsafe move that would
  // re-cost (and so break decryption of) every historical v1 artifact. The failure forces the safe
  // path: bump VERSION, add the new params, leave the pinned v1 literal untouched.
  it("pins the current version's KDF params to the live SCRYPT_PARAMS default", () => {
    expect(KDF_BY_VERSION[VERSION]).toEqual(SCRYPT_PARAMS);
  });

  // The magic check runs before the version check, so an all-zero frame (the test above) never
  // exercises KDF_BY_VERSION's own rejection path — the exact mechanism the self-describing-KDF
  // property depends on. A valid magic with an unrecognised version byte isolates it.
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
});
