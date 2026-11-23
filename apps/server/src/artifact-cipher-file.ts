import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { open, unlink, type FileHandle } from "node:fs/promises";
import { AppError } from "@waitron/shared";
import {
  ARTIFACT_TAG_BYTES,
  artifactHeaderBytes,
  backupKeyFrameKey,
  KDF_BY_VERSION,
  parseArtifactHeader,
  readArtifactHeader,
  startBackupKeyFrame,
  startPassphraseFrame,
  VERSION,
  type ArtifactHeader,
  type BackupKeyFrameInput,
  type FrameStart,
  type ParsedArtifactHeader,
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
    const { authenticated, salt, iv } = startPassphraseFrame();
    return {
      authenticated,
      iv,
      key: await deriveKeyAsync(passphrase, salt, KDF_BY_VERSION[VERSION]),
    };
  });
}

export async function encryptArtifactFileUnderBackupKey(
  plaintext: AsyncIterable<Uint8Array>,
  outPath: string,
  input: BackupKeyFrameInput,
  signal?: AbortSignal,
): Promise<void> {
  await writeFrameFile(plaintext, outPath, signal, () => startBackupKeyFrame(input));
}

async function writeFrameFile(
  plaintext: AsyncIterable<Uint8Array>,
  outPath: string,
  signal: AbortSignal | undefined,
  frame: () => FrameStart | Promise<FrameStart>,
): Promise<void> {
  signal?.throwIfAborted();
  const output = await open(outPath, "wx", 0o600);
  try {
    const { authenticated, iv, key } = await frame();
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    key.fill(0);
    cipher.setAAD(authenticated);
    await writeAll(output, authenticated);
    await writeAll(output, Buffer.alloc(ARTIFACT_TAG_BYTES));
    for await (const bytes of plaintext) {
      for (let offset = 0; offset < bytes.length; offset += FILE_CHUNK_BYTES) {
        signal?.throwIfAborted();
        await writeAll(output, cipher.update(bytes.subarray(offset, offset + FILE_CHUNK_BYTES)));
      }
    }
    await writeAll(output, cipher.final());
    await writeAll(output, cipher.getAuthTag(), authenticated.length);
    // After the last write, so an abort at any point leaves no file behind.
    signal?.throwIfAborted();
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
  const input = await open(artifactPath, "r");
  try {
    const size = (await input.stat()).size;
    const header = parseArtifactHeader(await readLongestHeader(input, size), VERSION);
    const key = await keySlot.derive(passphrase, header.salt, KDF_BY_VERSION[VERSION]);
    return await openFrameFile(input, size, header, key, outPath);
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
    const header = parseArtifactHeader(await readLongestHeader(input, size), 2);
    const key = backupKeyFrameKey(backupKey, header.salt);
    return await openFrameFile(input, size, header, key, outPath);
  } finally {
    await input.close();
  }
}

/** The version and, for version 2, the master key id and N, read without opening the file. */
export async function readArtifactFileHeader(artifactPath: string): Promise<ArtifactHeader> {
  const input = await open(artifactPath, "r");
  try {
    return readArtifactHeader(await readLongestHeader(input, (await input.stat()).size));
  } finally {
    await input.close();
  }
}

function readLongestHeader(input: FileHandle, size: number): Promise<Buffer> {
  return readExactly(input, Math.min(size, artifactHeaderBytes(2)), 0);
}

/** The ciphertext follows `header` to the end of the file. The key is zeroed once the decipher
 * holds it. */
async function openFrameFile(
  input: FileHandle,
  size: number,
  header: ParsedArtifactHeader,
  key: Buffer,
  outPath: string,
): Promise<string> {
  const digest = createHash("sha256").update(header.bytes);
  const decipher = createDecipheriv("aes-256-gcm", key, header.iv);
  key.fill(0);
  decipher.setAAD(header.authenticated);
  decipher.setAuthTag(header.tag);
  const output = await open(outPath, "wx", 0o600);
  try {
    for (let position = header.bytes.length; position < size; position += FILE_CHUNK_BYTES) {
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
