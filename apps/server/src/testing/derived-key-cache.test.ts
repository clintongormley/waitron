import { scryptSync } from "node:crypto";
import { decryptArtifact, encryptArtifact } from "@waitron/provisioning";
import { deriveKey, deriveKeyAsync, SCRYPT_PARAMS } from "../scrypt-kdf.js";
import { derivedKeyStats } from "./derived-key-cache.js";

function since(before: { requested: number; derived: number }) {
  const now = derivedKeyStats();
  return { requested: now.requested - before.requested, derived: now.derived - before.derived };
}

const salt = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const cheap = { ...SCRYPT_PARAMS, N: 2 ** 14 };
const plaintext = Buffer.from("venue configuration");

describe("the test-side derived-key cache", () => {
  let artifact: Buffer;

  it("derives a repeated archive key once", () => {
    const before = derivedKeyStats();
    artifact = encryptArtifact(plaintext, "right-pass");
    expect(decryptArtifact(artifact, "right-pass")).toEqual(plaintext);
    expect(decryptArtifact(artifact, "right-pass")).toEqual(plaintext);
    expect(since(before)).toEqual({ requested: 3, derived: 1 });
  });

  it("still refuses a wrong passphrase, deriving it for real", () => {
    const before = derivedKeyStats();
    expect(() => decryptArtifact(artifact, "wrong-pass")).toThrow(
      expect.objectContaining({ code: "recovery.passphrase_invalid" }),
    );
    expect(since(before).derived).toBe(1);
  });

  it("returns exactly what scrypt returns", async () => {
    const real = scryptSync("exact-pass", salt, 32, {
      N: 2 ** 17,
      r: 8,
      p: 1,
      maxmem: 256 * 1024 * 1024,
    });
    expect(deriveKey("exact-pass", salt)).toEqual(real);
    expect(deriveKey("exact-pass", salt)).toEqual(real);
    expect(await deriveKeyAsync("exact-async-pass", salt)).toEqual(
      scryptSync("exact-async-pass", salt, 32, {
        N: 2 ** 17,
        r: 8,
        p: 1,
        maxmem: 256 * 1024 * 1024,
      }),
    );
    expect(await deriveKeyAsync("exact-pass", salt)).toEqual(real);
  });

  it("keys each input separately", () => {
    const full = deriveKey("keyed-pass", salt);
    let before = derivedKeyStats();
    const lower = deriveKey("keyed-pass", salt, cheap);
    expect(since(before).derived).toBe(1);
    expect(lower).not.toEqual(full);

    before = derivedKeyStats();
    const otherSalt = deriveKey("keyed-pass", Buffer.alloc(16, 7), cheap);
    expect(since(before).derived).toBe(1);
    expect(otherSalt).not.toEqual(lower);

    before = derivedKeyStats();
    const otherR = deriveKey("keyed-pass", salt, { ...cheap, r: 4 });
    expect(since(before).derived).toBe(1);
    expect(otherR).not.toEqual(lower);

    before = derivedKeyStats();
    const shorter = deriveKey("keyed-pass", salt, { ...cheap, keylen: 16 });
    expect(since(before).derived).toBe(1);
    expect(shorter).toHaveLength(16);
  });

  it("a call that must throw still throws after a success", () => {
    expect(deriveKey("throw-pass", salt, cheap)).toHaveLength(32);
    expect(() => deriveKey("throw-pass", salt, { ...cheap, maxmem: 1024 })).toThrow();
  });

  it("a caller changing its key does not change the next caller's", () => {
    const first = deriveKey("mutate-pass", salt, cheap);
    const expected = Buffer.from(first);
    first.fill(0);
    const second = deriveKey("mutate-pass", salt, cheap);
    expect(second).toEqual(expected);
    expect(second.some((byte) => byte !== 0)).toBe(true);
    second.fill(0);
    expect(deriveKey("mutate-pass", salt, cheap)).toEqual(expected);
  });

  it("a caller changing its async key does not change the next caller's", async () => {
    const first = await deriveKeyAsync("mutate-async-pass", salt, cheap);
    const expected = Buffer.from(first);
    first.fill(0);
    const second = await deriveKeyAsync("mutate-async-pass", salt, cheap);
    expect(second).toEqual(expected);
    expect(second.some((byte) => byte !== 0)).toBe(true);
    second.fill(0);
    expect(await deriveKeyAsync("mutate-async-pass", salt, cheap)).toEqual(expected);
  });

  it("a failed derivation is not stored", async () => {
    const tooSmall = { ...cheap, maxmem: 1024 };
    let before = derivedKeyStats();
    await expect(deriveKeyAsync("fail-pass", salt, tooSmall)).rejects.toThrow();
    await expect(deriveKeyAsync("fail-pass", salt, tooSmall)).rejects.toThrow();
    expect(since(before)).toEqual({ requested: 2, derived: 2 });

    before = derivedKeyStats();
    expect(() => deriveKey("fail-pass", salt, tooSmall)).toThrow();
    expect(() => deriveKey("fail-pass", salt, tooSmall)).toThrow();
    expect(since(before)).toEqual({ requested: 2, derived: 2 });
  });
});
