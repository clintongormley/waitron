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
});
