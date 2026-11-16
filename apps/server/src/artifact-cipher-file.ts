import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { AppError } from "@waitron/shared";
import { ARTIFACT_HEADER_BYTES, KDF_BY_VERSION, VERSION } from "./artifact-cipher.js";
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
  signal?.throwIfAborted();
  const output = await open(outPath, "wx", 0o600);
  try {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const header = Buffer.concat([Buffer.from("WBK1"), Buffer.from([VERSION]), salt, iv]);
    const key = await deriveKeyAsync(passphrase, salt, KDF_BY_VERSION[VERSION]);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
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
    await writeAll(output, cipher.getAuthTag(), 33);
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
    if (size < ARTIFACT_HEADER_BYTES)
      throw new AppError("backup.artifact_invalid", { reason: "too_short" });
    const header = await readExactly(input, ARTIFACT_HEADER_BYTES, 0);
    const digest = createHash("sha256").update(header);
    if (!header.subarray(0, 4).equals(Buffer.from("WBK1"))) {
      throw new AppError("backup.artifact_invalid", { reason: "bad_magic" });
    }
    const params = KDF_BY_VERSION[header[4]];
    if (params === undefined)
      throw new AppError("backup.artifact_invalid", { reason: "bad_version" });
    const key = await keySlot.derive(passphrase, header.subarray(5, 21), params);
    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(21, 33));
    key.fill(0);
    decipher.setAAD(header.subarray(0, 33));
    decipher.setAuthTag(header.subarray(33, ARTIFACT_HEADER_BYTES));
    const output = await open(outPath, "wx", 0o600);
    try {
      for (let position = ARTIFACT_HEADER_BYTES; position < size; position += FILE_CHUNK_BYTES) {
        const bytes = await readExactly(
          input,
          Math.min(FILE_CHUNK_BYTES, size - position),
          position,
        );
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
  } catch (error) {
    keySlot.clear();
    throw error;
  } finally {
    await input.close();
  }
}
