import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { S3FileStore } from "@waitron/stream";
import { AppError } from "@waitron/shared";
import "@waitron/stream";
import "./errors.js";
import { checkedKey } from "./local-fs-backend.js";
import type { StorageBackend, StorageCall, StoredObject } from "./storage-backend.js";

/** The most `put` sends or `get` holds. Archives travel by `putFile` and `getFile`, never these. */
export const SMALL_OBJECT_MAX_BYTES = 16 * 1024 * 1024;

function tooLarge(): AppError {
  return new AppError("backup.destination_object_too_large", { maxBytes: SMALL_OBJECT_MAX_BYTES });
}

/** As the file store reports a cancelled upload. */
function putCancelled(key: string): AppError {
  return new AppError("backup.destination_request_failed", {
    operation: "put",
    key,
    status: null,
    name: "AbortError",
  });
}

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
    if (bytes.byteLength > SMALL_OBJECT_MAX_BYTES) throw tooLarge();
    if (call.signal.aborted) throw putCancelled(key);
    const dir = await mkdtemp(join(tmpdir(), "waitron-s3-put-"));
    try {
      const path = join(dir, "object");
      try {
        await writeFile(path, bytes, { mode: 0o600, signal: call.signal });
      } catch (error) {
        if (call.signal.aborted) throw putCancelled(key);
        throw error;
      }
      await this.files.putFile(key, path, call);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
      if (total > SMALL_OBJECT_MAX_BYTES) throw tooLarge();
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
