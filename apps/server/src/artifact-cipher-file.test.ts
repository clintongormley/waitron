import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as kdf from "./scrypt-kdf.js";
import * as fileIo from "./artifact-file-io.js";
import {
  decryptArtifact,
  decryptArtifactUnderBackupKey,
  encryptArtifact,
  encryptArtifactUnderBackupKey,
  KDF_BY_VERSION,
} from "./artifact-cipher.js";
import {
  decryptArtifactFile,
  decryptArtifactFileUnderBackupKey,
  encryptArtifactFile,
  encryptArtifactFileUnderBackupKey,
  createArchiveKeySlot,
  readArtifactFileHeader,
} from "./artifact-cipher-file.js";
import { createCipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
const dirs: string[] = [];
async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "cipher-file-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it.each([0, 196625])(
  "returns the digest of the exact authenticated input for %i payload bytes",
  async (size) => {
    const dir = await scratch();
    const artifact = encryptArtifact(Buffer.alloc(size, 193), "right");
    await writeFile(join(dir, "artifact"), artifact);
    const digest = await decryptArtifactFile(join(dir, "artifact"), join(dir, "out"), "right");
    expect(digest).toBe(createHash("sha256").update(artifact).digest("hex"));
    expect(await readFile(join(dir, "out"))).toEqual(Buffer.alloc(size, 193));
  },
);
async function* chunks(bytes: Buffer) {
  for (let off = 0; off < bytes.length; off += 32768) yield bytes.subarray(off, off + 32768);
}

it("digests the authenticated descriptor when the archive pathname is replaced during decryption", async () => {
  const dir = await scratch();
  const artifact = encryptArtifact(Buffer.alloc(196625, 193), "right");
  const replacement = encryptArtifact(Buffer.alloc(196625, 194), "right");
  const path = join(dir, "artifact");
  await writeFile(path, artifact);
  const real = fileIo.readExactly;
  vi.spyOn(fileIo, "readExactly").mockImplementation(async (...args) => {
    const bytes = await real(...args);
    if (args[2] === 0) {
      await rename(path, join(dir, "original"));
      await writeFile(path, replacement);
    }
    return bytes;
  });
  const digest = await decryptArtifactFile(path, join(dir, "out"), "right");
  expect(digest).toBe(createHash("sha256").update(artifact).digest("hex"));
  expect(await readFile(path)).toEqual(replacement);
  expect(await readFile(join(dir, "out"))).toEqual(Buffer.alloc(196625, 193));
});

describe("file artifact cipher", () => {
  it.each([0, 196625])("cross-opens byte and file codecs for %i bytes", async (size) => {
    const dir = await scratch();
    const payload = Buffer.alloc(size, 193);
    const path = join(dir, "artifact");
    const reads = vi.spyOn(fileIo, "readExactly");
    const writes = vi.spyOn(fileIo, "writeAll");
    await encryptArtifactFile(chunks(payload), path, "right");
    const artifact = await readFile(path);
    expect(artifact.subarray(0, 5)).toEqual(Buffer.from("57424b3101", "hex"));
    expect(artifact.length).toBe(size + 49);
    expect(decryptArtifact(artifact, "right").equals(payload)).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await writeFile(join(dir, "byte"), encryptArtifact(payload, "right"));
    await decryptArtifactFile(join(dir, "byte"), join(dir, "plaintext"), "right");
    expect((await readFile(join(dir, "plaintext"))).equals(payload)).toBe(true);
    expect((await stat(join(dir, "plaintext"))).mode & 0o777).toBe(0o600);
    expect(Math.max(...reads.mock.calls.map((call) => call[1]))).toBeLessThanOrEqual(65536);
    expect(Math.max(...writes.mock.calls.map((call) => call[1].length))).toBeLessThanOrEqual(65536);
  });
  it.each([5, 21, 33, 60])(
    "removes unauthenticated plaintext after tamper at %i",
    async (offset) => {
      const dir = await scratch();
      const artifact = encryptArtifact(Buffer.alloc(150000, 71), "right");
      artifact[offset] ^= 255;
      await writeFile(join(dir, "artifact"), artifact);
      await expect(
        decryptArtifactFile(join(dir, "artifact"), join(dir, "plaintext"), "right"),
      ).rejects.toMatchObject({ code: "recovery.passphrase_invalid" });
      expect(await readdir(dir)).toEqual(["artifact"]);
    },
  );
  it("rejects wrong key and truncated ciphertext with the existing authentication refusal", async () => {
    const dir = await scratch();
    const artifact = encryptArtifact(Buffer.alloc(150000, 71), "right");
    await writeFile(join(dir, "artifact"), artifact);
    await expect(
      decryptArtifactFile(join(dir, "artifact"), join(dir, "out"), "wrong"),
    ).rejects.toMatchObject({ code: "recovery.passphrase_invalid" });
    await writeFile(join(dir, "artifact"), artifact.subarray(0, -1));
    await expect(
      decryptArtifactFile(join(dir, "artifact"), join(dir, "out"), "right"),
    ).rejects.toMatchObject({ code: "recovery.passphrase_invalid" });
    expect(await readdir(dir)).toEqual(["artifact"]);
  });
  it.each([
    [Buffer.alloc(48), "too_short"],
    [Buffer.alloc(49), "bad_magic"],
    [Buffer.concat([Buffer.from("WBK1"), Buffer.from([99]), Buffer.alloc(44)]), "bad_version"],
  ])("rejects malformed frame %s", async (bytes, reason) => {
    const dir = await scratch();
    await writeFile(join(dir, "artifact"), bytes);
    await expect(
      decryptArtifactFile(join(dir, "artifact"), join(dir, "out"), "right"),
    ).rejects.toMatchObject({ code: "backup.artifact_invalid", params: { reason } });
    expect(await readdir(dir)).toEqual(["artifact"]);
  });
  it("cleans partial files on real file read and write refusals without translating I/O errors", async () => {
    const dir = await scratch();
    const artifact = encryptArtifact(Buffer.alloc(150000, 17), "right");
    await writeFile(join(dir, "artifact"), artifact);
    for (const side of ["read", "write"] as const) {
      const failure = Object.assign(new Error(side + " failed"), { code: "EIO" });
      if (side === "write") vi.spyOn(fileIo, "writeAll").mockRejectedValueOnce(failure);
      else {
        const real = fileIo.readExactly;
        vi.spyOn(fileIo, "readExactly").mockImplementation(async (...args) => {
          if (args[2] >= 49) throw failure;
          return real(...args);
        });
      }
      await expect(
        decryptArtifactFile(join(dir, "artifact"), join(dir, "out"), "right"),
      ).rejects.toBe(failure);
      expect(await readdir(dir)).toEqual(["artifact"]);
      vi.restoreAllMocks();
    }
    const failure = new Error("cipher output failed");
    vi.spyOn(fileIo, "writeAll").mockRejectedValueOnce(failure);
    await expect(
      encryptArtifactFile(chunks(Buffer.from("data")), join(dir, "out"), "right"),
    ).rejects.toBe(failure);
    expect(await readdir(dir)).toEqual(["artifact"]);
  });
  it("preserves file I/O refusals and existing plaintext destinations", async () => {
    const dir = await scratch();
    await writeFile(join(dir, "artifact"), encryptArtifact(Buffer.from("new"), "right"));
    await writeFile(join(dir, "out"), "old");
    await expect(
      decryptArtifactFile(join(dir, "artifact"), join(dir, "out"), "right"),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect((await readFile(join(dir, "out"))).toString()).toBe("old");
    await expect(
      decryptArtifactFile(join(dir, "missing"), join(dir, "other"), "right"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(dir)).toEqual(["artifact", "out"]);
  });
});

it("reuses only an authenticated archive key across contiguous opens", async () => {
  const dir = await scratch();
  const artifact = encryptArtifact(Buffer.from("private archive"), " spaced key ");
  const path = join(dir, "archive");
  await writeFile(path, artifact);
  const derive = vi.spyOn(kdf, "deriveKeyAsync");
  for (const name of ["preview", "stage"]) {
    await decryptArtifactFile(path, join(dir, name), " spaced key ");
    expect(await readFile(join(dir, name), "utf8")).toBe("private archive");
  }
  expect(derive).toHaveBeenCalledTimes(1);
  await expect(decryptArtifactFile(path, join(dir, "wrong"), "spaced key")).rejects.toMatchObject({
    code: "recovery.passphrase_invalid",
  });
  artifact[artifact.length - 1] ^= 1;
  await writeFile(path, artifact);
  await expect(
    decryptArtifactFile(path, join(dir, "tampered"), " spaced key "),
  ).rejects.toMatchObject({ code: "recovery.passphrase_invalid" });
  artifact[artifact.length - 1] ^= 1;
  await writeFile(path, artifact);
  await decryptArtifactFile(path, join(dir, "retry"), " spaced key ");
  expect(derive).toHaveBeenCalledTimes(4);
});

it("erases a retained key on replacement and expiry and matches every derivation input", async () => {
  const slot = createArchiveKeySlot();
  const derive = vi.spyOn(kdf, "deriveKeyAsync");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const salt = Buffer.alloc(16, 12);
    const params = { ...KDF_BY_VERSION[1]! };
    const first = await slot.derive("pass", salt, params);
    const retained = await derive.mock.results[0]!.value;
    expect(await slot.derive("pass", Buffer.from(salt), { ...params })).toEqual(first);
    expect(derive).toHaveBeenCalledTimes(1);
    for (const changed of [
      { ...params, N: 2 ** 16 },
      { ...params, r: 4 },
      { ...params, p: 2 },
      { ...params, keylen: 16 },
      { ...params, maxmem: 300 * 1024 * 1024 },
    ]) {
      await slot.derive("pass", salt, changed);
    }
    expect(derive).toHaveBeenCalledTimes(6);
    expect(retained).toEqual(Buffer.alloc(32));
    const last = await derive.mock.results[5]!.value;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(last).toEqual(Buffer.alloc(32));
    await slot.derive("pass", salt, { ...params, maxmem: 300 * 1024 * 1024 });
    expect(derive).toHaveBeenCalledTimes(7);
  } finally {
    slot.clear();
    vi.useRealTimers();
  }
});

describe("file artifact cipher, version 2 under a backup key", () => {
  const backupKey = randomBytes(32);
  const masterKeyId = Buffer.from("8899aabbccddeeff", "hex");
  const keyNumber = 3;
  const input = { backupKey, keyNumber, masterKeyId };

  it("names its master key id and N before it is opened", async () => {
    const dir = await scratch();
    const path = join(dir, "artifact");
    await encryptArtifactFileUnderBackupKey(chunks(Buffer.alloc(200000, 5)), path, input);
    expect(await readArtifactFileHeader(path)).toEqual({ version: 2, masterKeyId, keyNumber });
    await writeFile(join(dir, "v1"), encryptArtifact(Buffer.alloc(10), "right"));
    expect(await readArtifactFileHeader(join(dir, "v1"))).toEqual({ version: 1 });
    expect(await readdir(dir)).toEqual(["artifact", "v1"]);
  });

  it.each([
    [Buffer.alloc(3), "too_short"],
    [Buffer.alloc(61), "bad_magic"],
    [Buffer.concat([Buffer.from("WBK1"), Buffer.from([9]), Buffer.alloc(56)]), "bad_version"],
    [Buffer.concat([Buffer.from("WBK1"), Buffer.from([2]), Buffer.alloc(55)]), "too_short"],
  ])("reads no header from malformed frame %s", async (bytes, reason) => {
    const dir = await scratch();
    await writeFile(join(dir, "artifact"), bytes);
    await expect(readArtifactFileHeader(join(dir, "artifact"))).rejects.toMatchObject({
      code: "backup.artifact_invalid",
      params: { reason },
    });
  });

  it.each([0, 196625])(
    "round-trips %i bytes across chunks, cross-opening the in-memory codec",
    async (size) => {
      const dir = await scratch();
      const payload = randomBytes(size);
      const path = join(dir, "artifact");
      const writes = vi.spyOn(fileIo, "writeAll");
      await encryptArtifactFileUnderBackupKey(chunks(payload), path, input);
      const artifact = await readFile(path);
      expect(artifact.length).toBe(size + 61);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(decryptArtifactUnderBackupKey(artifact, backupKey).equals(payload)).toBe(true);
      const digest = await decryptArtifactFileUnderBackupKey(path, join(dir, "out"), backupKey);
      expect(digest).toBe(createHash("sha256").update(artifact).digest("hex"));
      expect((await readFile(join(dir, "out"))).equals(payload)).toBe(true);
      expect((await stat(join(dir, "out"))).mode & 0o777).toBe(0o600);
      await writeFile(join(dir, "memory"), encryptArtifactUnderBackupKey(payload, input));
      await decryptArtifactFileUnderBackupKey(join(dir, "memory"), join(dir, "out2"), backupKey);
      expect((await readFile(join(dir, "out2"))).equals(payload)).toBe(true);
      expect(Math.max(...writes.mock.calls.map((call) => call[1].length))).toBeLessThanOrEqual(
        65536,
      );
    },
  );

  it("refuses another backup key and leaves no plaintext", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, "artifact"),
      encryptArtifactUnderBackupKey(Buffer.alloc(150000, 71), input),
    );
    await expect(
      decryptArtifactFileUnderBackupKey(join(dir, "artifact"), join(dir, "out"), randomBytes(32)),
    ).rejects.toMatchObject({ code: "recovery.passphrase_invalid" });
    expect(await readdir(dir)).toEqual(["artifact"]);
  });

  it.each([
    ["master key id", 5],
    ["N", 13],
    ["salt", 17],
    ["iv", 33],
    ["tag", 45],
    ["ciphertext", 140000],
  ])("refuses a changed %s byte by authentication and removes the plaintext", async (_, offset) => {
    const dir = await scratch();
    const artifact = encryptArtifactUnderBackupKey(Buffer.alloc(150000, 71), input);
    artifact[offset] ^= 1;
    await writeFile(join(dir, "artifact"), artifact);
    await expect(
      decryptArtifactFileUnderBackupKey(join(dir, "artifact"), join(dir, "out"), backupKey),
    ).rejects.toMatchObject({ code: "recovery.passphrase_invalid" });
    expect(await readdir(dir)).toEqual(["artifact"]);
  });

  it.each([
    ["magic", 0, "bad_magic"],
    ["version", 4, "bad_version"],
  ])("refuses a changed %s byte as a malformed frame", async (_, offset, reason) => {
    const dir = await scratch();
    const artifact = encryptArtifactUnderBackupKey(Buffer.alloc(100, 71), input);
    artifact[offset] ^= 1;
    await writeFile(join(dir, "artifact"), artifact);
    await expect(
      decryptArtifactFileUnderBackupKey(join(dir, "artifact"), join(dir, "out"), backupKey),
    ).rejects.toMatchObject({ code: "backup.artifact_invalid", params: { reason } });
    expect(await readdir(dir)).toEqual(["artifact"]);
  });

  it("is refused by the version 1 opener before any key derivation, and the reverse", async () => {
    const dir = await scratch();
    await writeFile(join(dir, "v2"), encryptArtifactUnderBackupKey(Buffer.alloc(100), input));
    const scrypt = vi.spyOn(kdf, "deriveKeyAsync");
    const slot = createArchiveKeySlot();
    const slotDerive = vi.spyOn(slot, "derive");
    await expect(
      decryptArtifactFile(join(dir, "v2"), join(dir, "out"), "right", slot),
    ).rejects.toMatchObject({ code: "backup.artifact_invalid", params: { reason: "bad_version" } });
    expect(slotDerive).not.toHaveBeenCalled();
    expect(scrypt).not.toHaveBeenCalled();
    await writeFile(join(dir, "v1"), encryptArtifact(Buffer.alloc(100), "right"));
    await expect(
      decryptArtifactFileUnderBackupKey(join(dir, "v1"), join(dir, "out"), backupKey),
    ).rejects.toMatchObject({ code: "backup.artifact_invalid", params: { reason: "bad_version" } });
    expect(await readdir(dir)).toEqual(["v1", "v2"]);
  });

  it("refuses bad writer inputs and leaves no file", async () => {
    const dir = await scratch();
    for (const [change, field] of [
      [{ backupKey: randomBytes(16) }, "backup_key"],
      [{ masterKeyId: randomBytes(4) }, "master_key_id"],
      [{ keyNumber: 0 }, "key_number"],
    ] as const) {
      await expect(
        encryptArtifactFileUnderBackupKey(chunks(Buffer.from("x")), join(dir, "out"), {
          ...input,
          ...change,
        }),
      ).rejects.toMatchObject({ code: "backup.archive_key_invalid", params: { input: field } });
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses an authenticated file naming key number 0 as malformed, and leaves no plaintext", async () => {
    const dir = await scratch();
    // Sealed here rather than by the writer, which refuses N = 0.
    const sealedUnderKeyNumber = (n: number) => {
      const salt = randomBytes(16);
      const iv = randomBytes(12);
      const number = Buffer.alloc(4);
      number.writeUInt32BE(n);
      const header = Buffer.concat([
        Buffer.from("WBK1"),
        Buffer.from([2]),
        masterKeyId,
        number,
        salt,
        iv,
      ]);
      const key = Buffer.from(hkdfSync("sha256", backupKey, salt, "waitron.archive.v2", 32));
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(header);
      const ct = Buffer.concat([cipher.update("private"), cipher.final()]);
      return Buffer.concat([header, cipher.getAuthTag(), ct]);
    };
    await writeFile(join(dir, "one"), sealedUnderKeyNumber(1));
    await decryptArtifactFileUnderBackupKey(join(dir, "one"), join(dir, "opened"), backupKey);
    expect(await readFile(join(dir, "opened"), "utf8")).toBe("private");
    await writeFile(join(dir, "zero"), sealedUnderKeyNumber(0));
    const malformed = { code: "backup.artifact_invalid", params: { reason: "bad_key_number" } };
    await expect(readArtifactFileHeader(join(dir, "zero"))).rejects.toMatchObject(malformed);
    await expect(
      decryptArtifactFileUnderBackupKey(join(dir, "zero"), join(dir, "out"), backupKey),
    ).rejects.toMatchObject(malformed);
    expect(await readdir(dir)).toEqual(["one", "opened", "zero"]);
  });

  it("opens twice without scrypt or the passphrase key cache", async () => {
    const dir = await scratch();
    const path = join(dir, "artifact");
    await writeFile(path, encryptArtifactUnderBackupKey(Buffer.from("private"), input));
    const scrypt = vi.spyOn(kdf, "deriveKeyAsync");
    for (const name of ["a", "b"]) {
      await decryptArtifactFileUnderBackupKey(path, join(dir, name), backupKey);
      expect(await readFile(join(dir, name), "utf8")).toBe("private");
    }
    expect(scrypt).not.toHaveBeenCalled();
  });
});

const backupKeyInput = {
  backupKey: randomBytes(32),
  keyNumber: 3,
  masterKeyId: Buffer.from("8899aabbccddeeff", "hex"),
};
describe.each([
  {
    version: 1,
    authenticatedBytes: 33,
    encrypt: (plaintext: AsyncIterable<Uint8Array>, path: string, signal?: AbortSignal) =>
      encryptArtifactFile(plaintext, path, "right", signal),
    frame: (plaintext: Buffer) => encryptArtifact(plaintext, "right"),
    open: (artifact: string, out: string) => decryptArtifactFile(artifact, out, "right"),
  },
  {
    version: 2,
    authenticatedBytes: 45,
    encrypt: (plaintext: AsyncIterable<Uint8Array>, path: string, signal?: AbortSignal) =>
      encryptArtifactFileUnderBackupKey(plaintext, path, backupKeyInput, signal),
    frame: (plaintext: Buffer) => encryptArtifactUnderBackupKey(plaintext, backupKeyInput),
    open: (artifact: string, out: string) =>
      decryptArtifactFileUnderBackupKey(artifact, out, backupKeyInput.backupKey),
  },
])("file artifact writer, version $version", ({ authenticatedBytes, encrypt, frame, open }) => {
  it("removes partial ciphertext on iterator failure and never deletes an existing destination", async () => {
    const dir = await scratch();
    const path = join(dir, "out");
    const failure = new Error("reader failed");
    async function* broken() {
      yield Buffer.alloc(70000);
      throw failure;
    }
    await expect(encrypt(broken(), path)).rejects.toBe(failure);
    expect(await readdir(dir)).toEqual([]);
    await writeFile(path, "old");
    await expect(encrypt(chunks(Buffer.from("new")), path)).rejects.toMatchObject({
      code: "EEXIST",
    });
    await writeFile(join(dir, "artifact"), frame(Buffer.from("new")));
    await expect(open(join(dir, "artifact"), path)).rejects.toMatchObject({ code: "EEXIST" });
    expect((await readFile(path)).toString()).toBe("old");
  });
  it("stops at the next chunk once its signal aborts, and leaves no partial ciphertext", async () => {
    const dir = await scratch();
    const path = join(dir, "out");
    const controller = new AbortController();
    let pulled = 0;
    async function* stopsAfterFirst() {
      pulled += 1;
      yield Buffer.alloc(70000);
      controller.abort();
      pulled += 1;
      yield Buffer.alloc(70000);
      pulled += 1;
      yield Buffer.alloc(70000);
    }
    const writes = vi.spyOn(fileIo, "writeAll");
    await expect(encrypt(stopsAfterFirst(), path, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(pulled).toBe(2);
    // Header, tag placeholder and the first chunk's ciphertext (70000 bytes is two chunks); nothing
    // after the abort.
    const written = writes.mock.calls.reduce((sum, [, bytes]) => sum + bytes.length, 0);
    expect(written).toBe(authenticatedBytes + 16 + 70000);
    expect(await readdir(dir)).toEqual([]);
  });
  it("stops before finishing when its signal aborts after the last chunk, and leaves no ciphertext", async () => {
    const dir = await scratch();
    const controller = new AbortController();
    async function* abortsAfterLast() {
      yield Buffer.alloc(100);
      controller.abort();
    }
    await expect(
      encrypt(abortsAfterLast(), join(dir, "out"), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(dir)).toEqual([]);
  });
  it("fails and leaves no ciphertext when its signal aborts during the tag write", async () => {
    const dir = await scratch();
    const controller = new AbortController();
    const real = fileIo.writeAll;
    const tagWrites: number[] = [];
    vi.spyOn(fileIo, "writeAll").mockImplementation(async (file, bytes, position) => {
      await real(file, bytes, position);
      if (position === authenticatedBytes) {
        tagWrites.push(bytes.length);
        controller.abort();
      }
    });
    await expect(
      encrypt(chunks(Buffer.alloc(100)), join(dir, "out"), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(tagWrites).toEqual([16]);
    expect(await readdir(dir)).toEqual([]);
  });
  it("pulls no plaintext and leaves no file when its signal is already aborted", async () => {
    const dir = await scratch();
    const controller = new AbortController();
    controller.abort();
    let pulled = false;
    async function* plaintext() {
      pulled = true;
      yield Buffer.alloc(100);
    }
    await expect(encrypt(plaintext(), join(dir, "out"), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(pulled).toBe(false);
    expect(await readdir(dir)).toEqual([]);
  });
});
