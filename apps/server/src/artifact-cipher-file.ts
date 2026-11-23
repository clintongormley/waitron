import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { open, unlink, type FileHandle } from "node:fs/promises";
import { AppError } from "@waitron/shared";
import {
  artifactHeaderBytes,
  backupKeyFrameHeader,
  backupKeyFrameKey,
  KDF_BY_VERSION,
  readArtifactHeader,
  VERSION,
  type ArtifactHeader,
  type BackupKeyFrameInput,
} from "./artifact-cipher.js";
import { FILE_CHUNK_BYTES, readExactly, writeAll } from "./artifact-file-io.js";
import { deriveKeyAsync, type ScryptParams } from "./scrypt-kdf.js";
import "./errors.js";

export function createArchiveKeySlot() {
  let held:
    { identity: string; key: Promise<Buffer>; timer: ReturnType<typeof setTimeout> } | undefined;
  const clear = () => {
    if (held === undefined) return;
    clearTimeout(held.timer);
    void held.key.then(
      (key) => key.fill(0),
      () => {},
    );
    held = undefined;
  };
  return {
    clear,
    async derive(passphrase: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
      const { N, r, p, keylen, maxmem } = params;
      const identity = JSON.stringify([passphrase, salt.toString("hex"), N, r, p, keylen, maxmem]);
      if (held?.identity !== identity) {
        clear();
        const key = deriveKeyAsync(passphrase, Buffer.from(salt), { ...params });
        const entry = { identity, key, timer: setTimeout(clear, 5 * 60_000) };
        entry.timer.unref();
        held = entry;
        void key.catch(() => {
          if (held === entry) clear();
        });
      }
      return Buffer.from(await held!.key);
    },
  };
}
export type ArchiveKeySlot = ReturnType<typeof createArchiveKeySlot>;
const archiveKeySlot = createArchiveKeySlot();

export async function encryptArtifactFile(
  plaintext: AsyncIterable<Uint8Array>,
  outPath: string,
  passphrase: string,
  signal?: AbortSignal,
): Promise<void> {
  await writeFrameFile(plaintext, outPath, signal, async () => {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const header = Buffer.concat([Buffer.from("WBK1"), Buffer.from([VERSION]), salt, iv]);
    return { header, iv, key: await deriveKeyAsync(passphrase, salt, KDF_BY_VERSION[VERSION]) };
  });
}

export async function encryptArtifactFileUnderBackupKey(
  plaintext: AsyncIterable<Uint8Array>,
  outPath: string,
  input: BackupKeyFrameInput,
  signal?: AbortSignal,
): Promise<void> {
  await writeFrameFile(plaintext, outPath, signal, () => {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const header = backupKeyFrameHeader(input, salt, iv);
    return Promise.resolve({ header, iv, key: backupKeyFrameKey(input.backupKey, salt) });
  });
}

/** `frame` gives the authenticated prefix (everything before the tag), the IV and the key. */
async function writeFrameFile(
  plaintext: AsyncIterable<Uint8Array>,
  outPath: string,
  signal: AbortSignal | undefined,
  frame: () => Promise<{ header: Buffer; iv: Buffer; key: Buffer }>,
): Promise<void> {
  signal?.throwIfAborted();
  const output = await open(outPath, "wx", 0o600);
  try {
    const { header, iv, key } = await frame();
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    key.fill(0);
    cipher.setAAD(header);
    await writeAll(output, header);
    await writeAll(output, Buffer.alloc(16));
    for await (const bytes of plaintext) {
      for (let offset = 0; offset < bytes.length; offset += FILE_CHUNK_BYTES) {
        signal?.throwIfAborted();
        await writeAll(output, cipher.update(bytes.subarray(offset, offset + FILE_CHUNK_BYTES)));
      }
    }
    signal?.throwIfAborted();
    await writeAll(output, cipher.final());
    await writeAll(output, cipher.getAuthTag(), header.length);
  } catch (error) {
    await unlink(outPath);
    throw error;
  } finally {
    await output.close();
  }
}

export async function decryptArtifactFile(
  artifactPath: string,
  outPath: string,
  passphrase: string,
  keySlot: ArchiveKeySlot = archiveKeySlot,
): Promise<string> {
  const headerBytes = artifactHeaderBytes(1);
  const input = await open(artifactPath, "r");
  try {
    const size = (await input.stat()).size;
    if (size < headerBytes) throw new AppError("backup.artifact_invalid", { reason: "too_short" });
    const header = await readExactly(input, headerBytes, 0);
    if (!header.subarray(0, 4).equals(Buffer.from("WBK1"))) {
      throw new AppError("backup.artifact_invalid", { reason: "bad_magic" });
    }
    const params = KDF_BY_VERSION[header[4]];
    if (params === undefined)
      throw new AppError("backup.artifact_invalid", { reason: "bad_version" });
    const key = await keySlot.derive(passphrase, header.subarray(5, 21), params);
    return await openFrameFile(input, size, header, header.subarray(21, 33), key, outPath);
  } catch (error) {
    keySlot.clear();
    throw error;
  } finally {
    await input.close();
  }
}

/** Opens a version 2 file; refuses a version 1 file as `bad_version` before deriving any key.
 * Returns the SHA-256 of the file's bytes, as `decryptArtifactFile` does. */
export async function decryptArtifactFileUnderBackupKey(
  artifactPath: string,
  outPath: string,
  backupKey: Uint8Array,
): Promise<string> {
  const input = await open(artifactPath, "r");
  try {
    const size = (await input.stat()).size;
    const found = await readHeaderOf(input, size);
    if (found.parsed.version !== 2) {
      throw new AppError("backup.artifact_invalid", { reason: "bad_version" });
    }
    const header = found.bytes;
    const key = backupKeyFrameKey(backupKey, header.subarray(17, 33));
    return await openFrameFile(input, size, header, header.subarray(33, 45), key, outPath);
  } finally {
    await input.close();
  }
}

/** The version and, for version 2, the master key id and N, read without opening the file. */
export async function readArtifactFileHeader(artifactPath: string): Promise<ArtifactHeader> {
  const input = await open(artifactPath, "r");
  try {
    return (await readHeaderOf(input, (await input.stat()).size)).parsed;
  } finally {
    await input.close();
  }
}

async function readHeaderOf(input: FileHandle, size: number) {
  const bytes = await readExactly(input, Math.min(size, artifactHeaderBytes(2)), 0);
  const parsed = readArtifactHeader(bytes);
  return { parsed, bytes: bytes.subarray(0, artifactHeaderBytes(parsed.version)) };
}

/** `header` is the whole header, tag last; the ciphertext follows it to the end of the file. The
 * key is zeroed once the decipher holds it. */
async function openFrameFile(
  input: FileHandle,
  size: number,
  header: Buffer,
  iv: Buffer,
  key: Buffer,
  outPath: string,
): Promise<string> {
  const digest = createHash("sha256").update(header);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  key.fill(0);
  decipher.setAAD(header.subarray(0, header.length - 16));
  decipher.setAuthTag(header.subarray(header.length - 16));
  const output = await open(outPath, "wx", 0o600);
  try {
    for (let position = header.length; position < size; position += FILE_CHUNK_BYTES) {
      const bytes = await readExactly(input, Math.min(FILE_CHUNK_BYTES, size - position), position);
      digest.update(bytes);
      await writeAll(output, decipher.update(bytes));
    }
    let final: Buffer;
    try {
      final = decipher.final();
    } catch {
      throw new AppError("recovery.passphrase_invalid", {});
    }
    await writeAll(output, final);
    return digest.digest("hex");
  } catch (error) {
    await unlink(outPath);
    throw error;
  } finally {
    await output.close();
  }
}
