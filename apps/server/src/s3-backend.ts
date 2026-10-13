import type { S3FileStore } from "@waitron/stream";
import { AppError } from "@waitron/shared";
import "@waitron/stream";
import {
  checkedKey,
  objectTooLarge,
  SMALL_OBJECT_MAX_BYTES,
  type StorageBackend,
  type StorageCall,
  type StoredObject,
} from "./storage-backend.js";

/**
 * A bucket destination: whole files stream through the file store; `put` and `get` are small-object
 * only. A key is one plain name, as in a folder destination, because `list` sees nothing deeper.
 */
export class S3Backend implements StorageBackend {
  constructor(
    readonly id: string,
    private readonly files: S3FileStore,
  ) {}

  async put(key: string, bytes: Uint8Array, call: StorageCall): Promise<void> {
    checkedKey(key);
    if (bytes.byteLength > SMALL_OBJECT_MAX_BYTES) throw objectTooLarge();
    await this.files.putBytes(key, bytes, call);
  }

  async putFile(key: string, path: string, call: StorageCall): Promise<void> {
    await this.files.putFile(checkedKey(key), path, call);
  }

  async getFile(key: string, outPath: string, call: StorageCall): Promise<void> {
    await this.files.getFile(checkedKey(key), outPath, call);
  }

  async get(key: string, call: StorageCall): Promise<Buffer> {
    checkedKey(key);
    const body = await this.files.readStream(key, call);
    const chunks: Buffer[] = [];
    let total = 0;
    // Leaving the loop early destroys the body.
    for await (const chunk of body) {
      const bytes = chunk as Buffer;
      total += bytes.length;
      if (total > SMALL_OBJECT_MAX_BYTES) throw objectTooLarge();
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, total);
  }

  /** As a folder destination: names directly inside the configured prefix, never deeper ones. */
  async list(prefix: string, call: StorageCall): Promise<StoredObject[]> {
    if (prefix.includes("/")) {
      throw new AppError("backup.destination_key_invalid", { field: "prefix" });
    }
    const listed = await this.files.list(prefix, call);
    return listed
      .filter(({ key }) => !key.includes("/"))
      .map(({ key, size, lastModified }) => ({ key, size, mtimeMs: lastModified.getTime() }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  async delete(key: string, call: StorageCall): Promise<void> {
    await this.deleteMany([key], call);
  }

  async deleteMany(keys: string[], call: StorageCall): Promise<void> {
    await this.files.deleteMany(keys.map(checkedKey), call);
  }

  close(): void {
    this.files.close();
  }
}
