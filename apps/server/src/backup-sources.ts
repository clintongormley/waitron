import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import type { WaitronModule } from "@waitron/module";
import type { ArchiveEntry } from "./backup-archive.js";
import "./errors.js";

/** Bounds open files, so a store of thousands of blobs cannot exhaust file descriptors. */
const CONCURRENCY = 64;

/**
 * Each enabled module's declared non-DB sources as archive entries named `${source}/<filename>`.
 *
 * A declared source with no resolver, or an empty one, throws `backup.source_unresolved`: skipped,
 * it would drop that module's state from the backup silently, and `""` would otherwise reach the
 * missing-directory branch below. A directory that does not exist yet contributes nothing.
 * Entries are sorted, so the archive does not depend on `readdir`'s order.
 */
export async function collectModuleNonDbState(
  modules: readonly WaitronModule[],
  resolvers: Record<string, string>,
): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  for (const mod of modules) {
    for (const ref of mod.backup?.nonDbState ?? []) {
      if (ref.kind !== "content-addressed-dir") {
        // The capture below is right only for a flat content-addressed directory.
        const _never: never = ref.kind;
        throw new AppError("backup.source_kind_unsupported", { kind: _never });
      }
      const dir = resolvers[ref.source];
      if (!dir) {
        throw new AppError("backup.source_unresolved", { source: ref.source });
      }

      let dirents: import("node:fs").Dirent[];
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }

      // A stray subdirectory must not reach `readFile` or be captured as a blob.
      const names = dirents
        .filter((d) => d.isFile())
        .map((d) => d.name)
        .sort();
      for (let i = 0; i < names.length; i += CONCURRENCY) {
        const chunk = names.slice(i, i + CONCURRENCY);
        const blobs = await Promise.all(chunk.map((name) => readFile(join(dir, name))));
        chunk.forEach((name, j) => {
          entries.push({ name: `${ref.source}/${name}`, bytes: blobs[j]! });
        });
      }
    }
  }
  return entries;
}
