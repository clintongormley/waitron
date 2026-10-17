import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fileIo from "./artifact-file-io.js";
import { decryptArtifact, encryptArtifact } from "./artifact-cipher.js";
import { decryptArtifactFile, encryptArtifactFile } from "./artifact-cipher-file.js";
import { createHash } from "node:crypto";
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
  it("removes partial ciphertext on iterator failure and never deletes an existing destination", async () => {
    const dir = await scratch();
    const path = join(dir, "out");
    const failure = new Error("reader failed");
    async function* broken() {
      yield Buffer.alloc(70000);
      throw failure;
    }
    await expect(encryptArtifactFile(broken(), path, "right")).rejects.toBe(failure);
    expect(await readdir(dir)).toEqual([]);
    await writeFile(path, "old");
    await expect(
      encryptArtifactFile(chunks(Buffer.from("new")), path, "right"),
    ).rejects.toMatchObject({ code: "EEXIST" });
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
    await expect(
      encryptArtifactFile(stopsAfterFirst(), path, "right", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(pulled).toBe(2);
    // Header, tag placeholder and the first chunk's ciphertext (70000 bytes is two chunks); nothing
    // after the abort.
    const written = writes.mock.calls.reduce((sum, [, bytes]) => sum + bytes.length, 0);
    expect(written).toBe(33 + 16 + 70000);
    expect(await readdir(dir)).toEqual([]);
  });
  it("stops before finishing when its signal aborts after the last chunk, and leaves no ciphertext", async () => {
    const dir = await scratch();
    const path = join(dir, "out");
    const controller = new AbortController();
    async function* abortsAfterLast() {
      yield Buffer.alloc(100);
      controller.abort();
    }
    await expect(
      encryptArtifactFile(abortsAfterLast(), path, "right", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
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
    await expect(
      encryptArtifactFile(plaintext(), join(dir, "out"), "right", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(pulled).toBe(false);
    expect(await readdir(dir)).toEqual([]);
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
