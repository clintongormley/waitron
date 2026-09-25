import { randomBytes, createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import {
  MIN_PASSPHRASE_LENGTH,
  encryptBundle,
  decryptBundle,
  type BundleFiles,
} from "./recovery-bundle.js";
import { deriveKey, SCRYPT_PARAMS } from "./scrypt-kdf.js";

const FILES: BundleFiles = {
  "secrets.env": "WAITRON_CREDENTIALS_KEY=abc\nWAITRON_CREDENTIALS_KEY_VERSION=1\n",
  "tls/ca.crt": "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
};
const PASS = "correct horse battery";

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
    env.kdf.N = 2 ** 30;
    expect(() => decryptBundle(JSON.stringify(env), PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "malformed" }),
    );
  });

  it("rejects an (N,r) pair that passes both bounds but breaches scrypt maxmem", () => {
    // Each passes its own bound; together 128*N*r is about 4 GB.
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
    // Base64 decoding ignores the newlines, so only the string-length cap can refuse this.
    env.iv = "AAAAAAAAAAAAAAAA" + "\n".repeat(1000);
    expect(Buffer.from(env.iv, "base64").length).toBe(12); // guards the premise of this test
    expect(() => decryptBundle(JSON.stringify(env), PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "malformed" }),
    );
  });

  it("decrypts a bundle whose envelope records a non-default, in-bounds scrypt cost (self-describing KDF)", () => {
    // A bundle must stay decryptable after SCRYPT_PARAMS is hardened.
    const lighterCost = {
      N: 2 ** 14,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      keylen: SCRYPT_PARAMS.keylen,
      maxmem: SCRYPT_PARAMS.maxmem,
    };
    expect(lighterCost.N).not.toBe(SCRYPT_PARAMS.N); // guards the premise of this test
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = deriveKey(PASS, salt, lighterCost);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(FILES), "utf8")),
      cipher.final(),
    ]);
    const envelope = {
      v: 1,
      kdf: {
        name: "scrypt",
        N: lighterCost.N,
        r: lighterCost.r,
        p: lighterCost.p,
        salt: salt.toString("base64"),
      },
      cipher: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ct: ct.toString("base64"),
    };
    expect(decryptBundle(JSON.stringify(envelope), PASS)).toEqual(FILES);
  });

  it("rejects an over-large ct on STRING length, without decoding it (DoS guard)", () => {
    const env = JSON.parse(encryptBundle(FILES, PASS));
    // Not valid base64, so only a check on the string length can report ct_too_large.
    env.ct = "!".repeat(Math.ceil((1024 * 1024) / 3) * 4 + 1);
    expect(() => decryptBundle(JSON.stringify(env), PASS)).toThrow(
      new AppError("recovery.bundle_invalid", { reason: "ct_too_large" }),
    );
  });
});

/** The error `fn` throws, so a test can pin its code AND params rather than only its message. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("recovery-bundle envelope — refusals past the shape check", () => {
  it("turns a key-derivation refusal on a shape-valid envelope into bundle_invalid (malformed)", () => {
    const env = JSON.parse(encryptBundle(FILES, PASS));
    // In every bound the shape check applies, but scrypt accepts only a power of two.
    env.kdf.N = 3;
    expect(thrown(() => decryptBundle(JSON.stringify(env), PASS))).toMatchObject({
      code: "recovery.bundle_invalid",
      params: { reason: "malformed" },
    });
  });

  it("rejects an authentic bundle whose plaintext is not JSON at all", () => {
    const cost = { ...SCRYPT_PARAMS, N: 2 ** 14 };
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", deriveKey(PASS, salt, cost), iv);
    const ct = Buffer.concat([cipher.update(Buffer.from("not json", "utf8")), cipher.final()]);
    const envelope = {
      v: 1,
      kdf: { name: "scrypt", N: cost.N, r: cost.r, p: cost.p, salt: salt.toString("base64") },
      cipher: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ct: ct.toString("base64"),
    };
    expect(thrown(() => decryptBundle(JSON.stringify(envelope), PASS))).toMatchObject({
      code: "recovery.bundle_invalid",
      params: { reason: "malformed" },
    });
  });
});
