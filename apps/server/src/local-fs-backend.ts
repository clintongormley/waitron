import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { AppError } from "@waitron/shared";
import "@waitron/stream";
import { stageFile } from "./fs-atomic.js";
import type { StorageBackend, StorageCall, StoredObject } from "./storage-backend.js";

// C0 controls, DEL and C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** One plain file name inside the destination folder, so no key reaches outside it. */
export function checkedKey(key: string): string {
  if (key === "" || key === "." || key === ".." || /[/\\]/.test(key) || CONTROL.test(key)) {
    throw new AppError("backup.destination_key_invalid", { field: "key" });
  }
  return key;
}

/**
 * A destination folder. A cancelled call is checked before and after each file-system step that
 * cannot itself be interrupted, and copies stream under the signal; a cancelled write never
 * replaces the object already stored.
 */
export class LocalFsBackend implements StorageBackend {
  constructor(
    readonly id: string,
    private readonly dir: string,
  ) {}

  #path(key: string): string {
    return join(this.dir, checkedKey(key));
  }

  async put(key: string, bytes: Uint8Array, { signal }: StorageCall): Promise<void> {
    const target = this.#path(key);
    signal.throwIfAborted();
    await mkdir(this.dir, { recursive: true });
    const staged = await stageFile(target, bytes, 0o600);
    try {
      signal.throwIfAborted();
      await rename(staged, target);
    } catch (err) {
      await rm(staged, { force: true });
      throw err;
    }
  }

  async putFile(key: string, path: string, { signal }: StorageCall): Promise<void> {
    await copyAtomic(path, this.#path(key), signal);
  }

  async getFile(key: string, outPath: string, { signal }: StorageCall): Promise<void> {
    await copyAtomic(this.#path(key), outPath, signal);
  }

  async get(key: string, { signal }: StorageCall): Promise<Buffer> {
    return readFile(this.#path(key), { signal });
  }

  async list(prefix: string, { signal }: StorageCall): Promise<StoredObject[]> {
    signal.throwIfAborted();
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    signal.throwIfAborted();
    const out: StoredObject[] = [];
    for (const name of names) {
      // Exclude `writeFileAtomic`'s in-progress temp (`<target>.tmp`): it starts with `waitron-` too,
      // so a leftover from a crash between write and rename would otherwise read as a finished backup.
      if (!name.startsWith(prefix) || name.endsWith(".tmp")) continue;
      let info;
      try {
        info = await stat(join(this.dir, name));
      } catch (err) {
        // A concurrent prune/delete can remove this entry between `readdir` and `stat` — skip a
        // vanished file rather than failing the whole listing over it.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      signal.throwIfAborted();
      if (info.isFile()) out.push({ key: name, size: info.size, mtimeMs: info.mtimeMs });
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  async delete(key: string, call: StorageCall): Promise<void> {
    await this.deleteMany([key], call);
  }

  async deleteMany(keys: string[], { signal }: StorageCall): Promise<void> {
    const paths = keys.map((key) => this.#path(key));
    for (const path of paths) {
      signal.throwIfAborted();
      await rm(path, { force: true });
    }
    signal.throwIfAborted();
  }
}

async function copyAtomic(source: string, target: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await mkdir(dirname(target), { recursive: true });
  // The private directory holds the copy until it is whole and protected.
  const scratch = await mkdtemp(join(dirname(target), ".backup-copy-"));
  try {
    const copied = join(scratch, "payload");
    await pipeline(createReadStream(source), createWriteStream(copied, { mode: 0o600 }), {
      signal,
    });
    await chmod(copied, 0o600);
    signal.throwIfAborted();
    await rename(copied, target);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
