import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  artifactHeaderBytes,
  decryptArtifact,
  decryptArtifactAsync,
  decryptArtifactUnderBackupKey,
  encryptArtifactUnderBackupKey,
  readArtifactHeader,
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

describe("artifact frame version 2, under a backup key", () => {
  const backupKey = randomBytes(32);
  const masterKeyId = Buffer.from("0011223344556677", "hex");
  const keyNumber = 7;
  const frame = (plaintext: Uint8Array = randomBytes(256)) =>
    encryptArtifactUnderBackupKey(plaintext, { backupKey, keyNumber, masterKeyId });

  it("names its master key id and N before it is opened", () => {
    const framed = frame();
    expect(readArtifactHeader(framed)).toEqual({ version: 2, masterKeyId, keyNumber });
    expect(framed.subarray(0, 17).toString("hex")).toBe("57424b3102001122334455667700000007");
  });

  it("reads a version 1 header as version 1 with nothing more to name", () => {
    expect(readArtifactHeader(encryptArtifact(randomBytes(8), "pw-000000000000"))).toEqual({
      version: 1,
    });
  });

  it("measures each version's header", () => {
    expect(artifactHeaderBytes(1)).toBe(49);
    expect(artifactHeaderBytes(2)).toBe(61);
    const plaintext = randomBytes(100);
    expect(frame(plaintext).length).toBe(100 + 61);
    expect(encryptArtifact(plaintext, "pw-000000000000").length).toBe(100 + 49);
  });

  it("round-trips under the same backup key, with a fresh salt and IV each time", () => {
    const plaintext = randomBytes(4096);
    const first = frame(plaintext);
    const second = frame(plaintext);
    expect(decryptArtifactUnderBackupKey(first, backupKey).equals(plaintext)).toBe(true);
    expect(first.subarray(17, 33).equals(second.subarray(17, 33))).toBe(false);
    expect(first.subarray(33, 45).equals(second.subarray(33, 45))).toBe(false);
    expect(first.includes(plaintext.subarray(0, 64))).toBe(false);
  });

  it("refuses another backup key", () => {
    expect(() => decryptArtifactUnderBackupKey(frame(), randomBytes(32))).toThrowError(
      expect.objectContaining({ code: "recovery.passphrase_invalid" }),
    );
  });

  it.each([
    ["master key id", 5],
    ["N", 13],
    ["salt", 17],
    ["iv", 33],
    ["tag", 45],
    ["ciphertext", 61],
  ])("refuses a changed %s byte by authentication", (_field, offset) => {
    const framed = frame();
    framed[offset] ^= 0x01;
    expect(() => decryptArtifactUnderBackupKey(framed, backupKey)).toThrowError(
      expect.objectContaining({ code: "recovery.passphrase_invalid" }),
    );
  });

  it.each([
    ["magic", 0, "bad_magic"],
    ["version", 4, "bad_version"],
  ])("refuses a changed %s byte as a malformed frame", (_field, offset, reason) => {
    const framed = frame();
    framed[offset] ^= 0x01;
    for (const read of [
      () => decryptArtifactUnderBackupKey(framed, backupKey),
      () => readArtifactHeader(framed),
    ]) {
      expect(read).toThrowError(
        expect.objectContaining({ code: "backup.artifact_invalid", params: { reason } }),
      );
    }
  });

  it("refuses a frame cut short of its header", () => {
    for (const framed of [frame().subarray(0, 60), Buffer.from("WBK1"), Buffer.alloc(0)]) {
      for (const read of [
        () => decryptArtifactUnderBackupKey(framed, backupKey),
        () => readArtifactHeader(framed),
      ]) {
        expect(read).toThrowError(
          expect.objectContaining({
            code: "backup.artifact_invalid",
            params: { reason: "too_short" },
          }),
        );
      }
    }
    expect(() =>
      readArtifactHeader(encryptArtifact(Buffer.alloc(0), "pw").subarray(0, 48)),
    ).toThrowError(expect.objectContaining({ params: { reason: "too_short" } }));
  });

  it("is refused by the passphrase openers, and a version 1 frame by the backup key opener", async () => {
    const badVersion = expect.objectContaining({
      code: "backup.artifact_invalid",
      params: { reason: "bad_version" },
    });
    expect(() => decryptArtifact(frame(), "pw-000000000000")).toThrowError(badVersion);
    await expect(decryptArtifactAsync(frame(), "pw-000000000000")).rejects.toEqual(badVersion);
    const v1 = encryptArtifact(randomBytes(64), "pw-000000000000");
    expect(() => decryptArtifactUnderBackupKey(v1, backupKey)).toThrowError(badVersion);
  });

  it("opens a frame built by plain node:crypto (HKDF-SHA256 then AES-256-GCM), the fixed vector", () => {
    // Built outside this module: hkdfSync("sha256", key 00..1f, salt a5×16, "waitron.archive.v2",
    // 32), then createCipheriv("aes-256-gcm") with iv 5a×12 and the 45 header bytes as AAD.
    const vector = Buffer.from(
      "57424b3102010203040506070801020304a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a55a5a5a5a5a5a5a5a5a5a5a5a" +
        "786ce0ad45ab732bb0b3f9c07f851b82deb81cc9a83eb4eb42eba8def7d2a1c056a340aea688c54959",
      "hex",
    );
    const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
    expect(decryptArtifactUnderBackupKey(vector, key).toString()).toBe("waitron archive v2 vector");
    expect(readArtifactHeader(vector)).toEqual({
      version: 2,
      masterKeyId: Buffer.from("0102030405060708", "hex"),
      keyNumber: 0x01020304,
    });
  });

  it("writes N as four unsigned big-endian bytes, up to the largest", () => {
    const framed = encryptArtifactUnderBackupKey(randomBytes(8), {
      backupKey,
      keyNumber: 0xffffffff,
      masterKeyId,
    });
    expect(framed.subarray(13, 17).toString("hex")).toBe("ffffffff");
    expect(readArtifactHeader(framed)).toMatchObject({ keyNumber: 0xffffffff });
    expect(decryptArtifactUnderBackupKey(framed, backupKey).length).toBe(8);
  });

  it.each([
    [{ backupKey: randomBytes(31) }, "backup_key"],
    [{ backupKey: randomBytes(33) }, "backup_key"],
    [{ masterKeyId: randomBytes(7) }, "master_key_id"],
    [{ masterKeyId: randomBytes(9) }, "master_key_id"],
    [{ keyNumber: 0 }, "key_number"],
    [{ keyNumber: -1 }, "key_number"],
    [{ keyNumber: 1.5 }, "key_number"],
    [{ keyNumber: 0x100000000 }, "key_number"],
  ])("refuses a writer input %o", (change, input) => {
    expect(() =>
      encryptArtifactUnderBackupKey(randomBytes(8), {
        backupKey,
        keyNumber,
        masterKeyId,
        ...change,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "backup.archive_key_invalid", params: { input } }),
    );
  });

  it("refuses an opener key that is not 32 bytes before trying it", () => {
    expect(() => decryptArtifactUnderBackupKey(frame(), randomBytes(24))).toThrowError(
      expect.objectContaining({
        code: "backup.archive_key_invalid",
        params: { input: "backup_key" },
      }),
    );
  });
});
