import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import {
  MIN_PASSPHRASE_LENGTH,
  encryptBundle,
  decryptBundle,
  type BundleFiles,
} from "./recovery-bundle.js";

const FILES: BundleFiles = {
  "secrets.env": "WAITRON_CREDENTIALS_KEY=abc\nWAITRON_CREDENTIALS_KEY_VERSION=1\n",
  "tls/ca.crt": "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
};
const PASS = "correct horse battery"; // ≥ MIN_PASSPHRASE_LENGTH

describe("recovery-bundle envelope", () => {
  it("round-trips the file map through encrypt→decrypt", () => {
    const out = decryptBundle(encryptBundle(FILES, PASS), PASS);
    expect(out).toEqual(FILES);
  });

  it("produces a fresh salt+iv each call (ciphertext is not deterministic)", () => {
    expect(encryptBundle(FILES, PASS)).not.toBe(encryptBundle(FILES, PASS));
  });

  it("rejects a passphrase shorter than the minimum", () => {
    const short = "x".repeat(MIN_PASSPHRASE_LENGTH - 1);
    expect(() => encryptBundle(FILES, short)).toThrow(
      new AppError("recovery.passphrase_too_short", { min: MIN_PASSPHRASE_LENGTH }),
    );
  });

  it("fails decryption on the wrong passphrase (GCM auth) with recovery.passphrase_invalid", () => {
    const env = encryptBundle(FILES, PASS);
    expect(() => decryptBundle(env, PASS + "!")).toThrow(
      new AppError("recovery.passphrase_invalid", {}),
    );
  });

  it("fails on a tampered ciphertext with recovery.passphrase_invalid", () => {
    const env = JSON.parse(encryptBundle(FILES, PASS));
    const ct = Buffer.from(env.ct, "base64");
    ct[0] ^= 0xff;
    env.ct = ct.toString("base64");
    expect(() => decryptBundle(JSON.stringify(env), PASS)).toThrow(
      new AppError("recovery.passphrase_invalid", {}),
    );
  });

  it("rejects a non-JSON envelope with recovery.bundle_invalid", () => {
    expect(() => decryptBundle("not json", PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "not_json" }),
    );
  });

  it("rejects a malformed envelope shape with recovery.bundle_invalid", () => {
    expect(() => decryptBundle(JSON.stringify({ v: 1 }), PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "malformed" }),
    );
  });

  it("rejects an envelope whose KDF cost is out of bounds (DoS guard)", () => {
    const env = JSON.parse(encryptBundle(FILES, PASS));
    env.kdf.N = 2 ** 30; // absurd scrypt cost
    expect(() => decryptBundle(JSON.stringify(env), PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "malformed" }),
    );
  });

  it("rejects an (N,r) pair that passes both bounds but breaches scrypt maxmem", () => {
    // N=2^20 and r=32 each pass their individual bound (N not > MAX_SCRYPT_N; r not > 32), but
    // 128*N*r ≈ 4GB exceeds maxmem — scryptSync would throw a RAW error without the guard.
    const env = JSON.parse(encryptBundle(FILES, PASS));
    env.kdf.N = 2 ** 20;
    env.kdf.r = 32;
    expect(() => decryptBundle(JSON.stringify(env), PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "malformed" }),
    );
  });

  it("rejects an envelope with a truncated iv (Invalid IV length) as bundle_invalid", () => {
    const env = JSON.parse(encryptBundle(FILES, PASS));
    env.iv = "AA"; // decodes to 1 byte, not 12
    expect(() => decryptBundle(JSON.stringify(env), PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "malformed" }),
    );
  });

  it("rejects an envelope with a truncated tag (Invalid auth tag length) as bundle_invalid", () => {
    const env = JSON.parse(encryptBundle(FILES, PASS));
    env.tag = "AA"; // decodes to 1 byte, not 16
    expect(() => decryptBundle(JSON.stringify(env), PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "malformed" }),
    );
  });

  it("rejects an authentic bundle whose plaintext is a JSON array, not a string-map", () => {
    // GCM-authentic (we sealed it) but the plaintext is `[1,2,3]`, which would throw a raw error out
    // of unpackBundleToDir. The post-decrypt shape guard must turn it into the contract error.
    const env = encryptBundle([1, 2, 3] as unknown as BundleFiles, PASS);
    expect(() => decryptBundle(env, PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "malformed" }),
    );
  });

  it("rejects an authentic bundle whose plaintext has a non-string value", () => {
    const env = encryptBundle({ a: 123 } as unknown as BundleFiles, PASS);
    expect(() => decryptBundle(env, PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "malformed" }),
    );
  });

  it("rejects an over-long iv on STRING length, before decoding it (DoS guard)", () => {
    const env = JSON.parse(encryptBundle(FILES, PASS));
    // Discriminating case: 16 base64 chars (= exactly 12 iv bytes) padded with 1000 newlines, which
    // Buffer.from(..., "base64") IGNORES — so the decoded length is still 12 and the exact `!== 12`
    // check would PASS. Only the string-length cap (>64) rejects it, proving the guard fires on the
    // STRING length before any Buffer.from allocation. Without the cap this would decrypt to a GCM
    // auth failure (passphrase_invalid), not malformed.
    env.iv = "AAAAAAAAAAAAAAAA" + "\n".repeat(1000);
    expect(Buffer.from(env.iv, "base64").length).toBe(12); // guards the premise of this test
    expect(() => decryptBundle(JSON.stringify(env), PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "malformed" }),
    );
  });

  it("rejects an over-large ct on STRING length, without decoding it (DoS guard)", () => {
    const env = JSON.parse(encryptBundle(FILES, PASS));
    // A ct longer than the base64 cap for 1 MiB. Deliberately NOT valid base64 ("!" is outside the
    // alphabet): the guard must fire on env.ct.length BEFORE any Buffer.from decode, so an invalid
    // string that is merely too long is still rejected as ct_too_large, never decoded.
    env.ct = "!".repeat(Math.ceil((1024 * 1024) / 3) * 4 + 1);
    expect(() => decryptBundle(JSON.stringify(env), PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "ct_too_large" }),
    );
  });
});
