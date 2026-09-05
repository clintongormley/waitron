import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BackupDestination, StorageBackend, StoredObject } from "./storage-backend.js";

/**
 * v1 storage backend: a local directory. `put` writes to `<target>.partial` then `rename`s onto the
 * final key, the same temp-then-rename idiom as `dumpAtomic` (`pg-dump.ts`) — so a fan-out write that
 * dies mid-write never leaves a half-written key visible under its real name.
 */
export class LocalFsBackend implements StorageBackend {
  constructor(
    readonly id: string,
    private readonly dir: string,
  ) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = join(this.dir, key);
    const partial = `${target}.partial`;
    try {
      await writeFile(partial, bytes, { mode: 0o600 });
      await rename(partial, target);
    } catch (err) {
      // Best-effort cleanup: a failure here (e.g. EACCES on a read-only mount) must never replace
      // the real write/rename error below — the same posture `dumpAtomic` takes (`pg-dump.ts`).
      await rm(partial, { force: true }).catch(() => {});
      throw err;
    }
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
      if (!name.startsWith(prefix) || name.endsWith(".partial")) continue;
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
    // Compile-time exhaustiveness guard: adding an `s3`/`sftp` kind to `BackupDestination` without a
    // case above makes `dest.kind` non-`never` here and fails typecheck, rather than silently
    // returning `undefined` from a fell-through switch. Structurally unreachable today (only
    // `local-fs` exists), so v8-ignored — there is no runtime input that reaches it.
    /* v8 ignore start */
    default: {
      const _never: never = dest.kind;
      throw new Error(`unknown backup destination kind: ${String(_never)}`);
    }
    /* v8 ignore stop */
  }
}
