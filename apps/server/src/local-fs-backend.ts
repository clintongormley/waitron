import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./fs-atomic.js";
import type { BackupDestination, StorageBackend, StoredObject } from "./storage-backend.js";

export class LocalFsBackend implements StorageBackend {
  constructor(
    readonly id: string,
    private readonly dir: string,
  ) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFileAtomic(join(this.dir, key), bytes, 0o600);
  }

  async putFile(key: string, path: string): Promise<void> {
    await copyAtomic(path, join(this.dir, key));
  }

  async getFile(key: string, outPath: string): Promise<void> {
    await copyAtomic(join(this.dir, key), outPath);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(join(this.dir, key));
  }

  async list(prefix: string): Promise<StoredObject[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
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
      if (info.isFile()) out.push({ key: name, size: info.size, mtimeMs: info.mtimeMs });
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  async delete(key: string): Promise<void> {
    await rm(join(this.dir, key), { force: true });
  }
}

export function buildBackend(dest: BackupDestination): StorageBackend {
  switch (dest.kind) {
    case "local-fs":
      return new LocalFsBackend(dest.id, dest.dir);
    // Compile-time exhaustiveness guard: a `BackupDestination` kind without a case above fails typecheck.
    /* v8 ignore start */
    default: {
      const _never: never = dest.kind;
      throw new Error(`unknown backup destination kind: ${String(_never)}`);
    }
    /* v8 ignore stop */
  }
}

async function copyAtomic(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  // copyFile preserves the source mode; the private directory contains it until chmod completes.
  const scratch = await mkdtemp(join(dirname(target), ".backup-copy-"));
  try {
    const copied = join(scratch, "payload");
    await copyFile(source, copied);
    await chmod(copied, 0o600);
    await rename(copied, target);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
