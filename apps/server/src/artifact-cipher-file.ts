import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { AppError } from "@waitron/shared";
import { KDF_BY_VERSION, VERSION } from "./artifact-cipher.js";
import { FILE_CHUNK_BYTES, readExactly, writeAll } from "./artifact-file-io.js";
import { deriveKeyAsync } from "./scrypt-kdf.js";
import "./errors.js";

export async function encryptArtifactFile(
  plaintext: AsyncIterable<Uint8Array>,
  outPath: string,
  passphrase: string,
): Promise<void> {
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
        await writeAll(output, cipher.update(bytes.subarray(offset, offset + FILE_CHUNK_BYTES)));
      }
    }
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
): Promise<void> {
  const input = await open(artifactPath, "r");
  try {
    const size = (await input.stat()).size;
    if (size < 49) throw new AppError("backup.artifact_invalid", { reason: "too_short" });
    const header = await readExactly(input, 49, 0);
    if (!header.subarray(0, 4).equals(Buffer.from("WBK1"))) {
      throw new AppError("backup.artifact_invalid", { reason: "bad_magic" });
    }
    const params = KDF_BY_VERSION[header[4]];
    if (params === undefined)
      throw new AppError("backup.artifact_invalid", { reason: "bad_version" });
    const key = await deriveKeyAsync(passphrase, header.subarray(5, 21), params);
    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(21, 33));
    decipher.setAAD(header.subarray(0, 33));
    decipher.setAuthTag(header.subarray(33, 49));
    const output = await open(outPath, "wx", 0o600);
    try {
      for (let position = 49; position < size; position += FILE_CHUNK_BYTES) {
        const bytes = await readExactly(
          input,
          Math.min(FILE_CHUNK_BYTES, size - position),
          position,
        );
        await writeAll(output, decipher.update(bytes));
      }
      let final: Buffer;
      try {
        final = decipher.final();
      } catch {
        throw new AppError("recovery.passphrase_invalid", {});
      }
      await writeAll(output, final);
    } catch (error) {
      await unlink(outPath);
      throw error;
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}
