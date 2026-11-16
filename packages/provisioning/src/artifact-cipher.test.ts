import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptArtifact,
  decryptArtifactAsync,
  encryptArtifact,
  encryptArtifactAsync,
  encryptArtifactWithSalt,
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

  const saltOf = (framed: Buffer) => framed.subarray(5, 21);

  it("draws a fresh salt for every seal, synchronous or off the main thread", async () => {
    const plaintext = randomBytes(64);
    const first = encryptArtifact(plaintext, "pw-000000000000");
    const second = encryptArtifact(plaintext, "pw-000000000000");
    const third = await encryptArtifactAsync(plaintext, "pw-000000000000");
    const fourth = await encryptArtifactAsync(plaintext, "pw-000000000000");
    expect(saltOf(first).equals(saltOf(second))).toBe(false);
    expect(saltOf(third).equals(saltOf(fourth))).toBe(false);
  });

  it("seals under a given salt into a frame the ordinary reader opens", () => {
    const plaintext = randomBytes(4096);
    const salt = randomBytes(16);
    const framed = encryptArtifactWithSalt(plaintext, "recovery-key-123", salt);
    expect(saltOf(framed).equals(salt)).toBe(true);
    expect(decryptArtifact(framed, "recovery-key-123").equals(plaintext)).toBe(true);
    expect(() => decryptArtifact(framed, "wrong-passphrase")).toThrowError(
      expect.objectContaining({ code: "recovery.passphrase_invalid" }),
    );
  });

  it("still draws a fresh IV under a repeated salt, so two seals differ byte for byte", () => {
    const plaintext = randomBytes(64);
    const salt = randomBytes(16);
    const first = encryptArtifactWithSalt(plaintext, "pw-000000000000", salt);
    const second = encryptArtifactWithSalt(plaintext, "pw-000000000000", salt);
    expect(saltOf(first).equals(saltOf(second))).toBe(true);
    expect(first.subarray(21, 33).equals(second.subarray(21, 33))).toBe(false);
    expect(first.equals(second)).toBe(false);
  });

  it("refuses a salt that is not 16 bytes, which the reader could not find again", () => {
    expect(() =>
      encryptArtifactWithSalt(randomBytes(8), "pw-000000000000", randomBytes(15)),
    ).toThrow(RangeError);
  });
});

it("opens off-thread before completing, preserving the frame and refusal answers", async () => {
  const plain = Buffer.from("archive payload");
  const framed = encryptArtifact(plain, "exact passphrase ");
  const order: string[] = [];
  const timer = new Promise<void>((resolve) =>
    setTimeout(() => {
      order.push("timer");
      resolve();
    }, 0),
  );
  const opened = Promise.resolve(decryptArtifactAsync(framed, "exact passphrase ")).then(
    (bytes) => {
      order.push("opened");
      return bytes;
    },
  );
  const [bytes] = await Promise.all([opened, timer]);
  expect(bytes).toEqual(plain);
  expect(order).toEqual(["timer", "opened"]);
  await expect(decryptArtifactAsync(framed, "exact passphrase")).rejects.toMatchObject({
    code: "recovery.passphrase_invalid",
  });
  framed[framed.length - 1] ^= 1;
  await expect(decryptArtifactAsync(framed, "exact passphrase ")).rejects.toMatchObject({
    code: "recovery.passphrase_invalid",
  });
  for (const [frame, reason] of [
    [Buffer.alloc(4), "too_short"],
    [Buffer.alloc(49), "bad_magic"],
    [Buffer.concat([Buffer.from("WBK1"), Buffer.from([99]), Buffer.alloc(44)]), "bad_version"],
  ] as const) {
    await expect(decryptArtifactAsync(frame, "pw")).rejects.toMatchObject({
      code: "backup.artifact_invalid",
      params: { reason },
    });
  }
});
