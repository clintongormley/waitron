import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import type { WaitronModule } from "@waitron/module";
import type { ArchiveEntry } from "./backup-archive.js";
import "./errors.js";

/**
 * Turn every enabled module's declared `backup.nonDbState` source refs into actual archive
 * entries. v1 knows one `NonDbSource` kind, `"content-addressed-dir"`: the named directory's files,
 * each emitted verbatim as `${source}/<filename>` — content-addressed blobs need no restructuring,
 * their filename already carries their identity (the media store's `<sha>.jpg` naming).
 *
 * `resolvers` maps a module's declared source id (e.g. `"media"`) to the absolute directory the
 * composition root resolves it to (`{ media: config.mediaDir }`) — this function has no knowledge
 * of `config` itself, keeping it a pure fs+DI seam the way `backup-archive.ts` is pure in-memory.
 *
 * A module with no `backup`/`nonDbState` at all contributes nothing (most modules; only `core`
 * declares one today). A declared source with NO resolver entry is a fail-visible bug — a module
 * declaring state the composition root never wired up would otherwise vanish from the backup
 * silently — so it throws `backup.source_unresolved` rather than being skipped. A resolved
 * directory that does not exist on disk (ENOENT) is tolerated as empty: a fresh venue with no
 * product images yet is a valid, backup-worthy state, not an error.
 *
 * Entries are sorted by name — first within each source dir (so archive order does not depend on
 * `readdir`'s unspecified order), and the returned list is emitted in that same per-source order
 * for every module/source pair, so the whole archive is deterministic byte-for-byte across runs of
 * an unchanged media store.
 */
export async function collectModuleNonDbState(
  modules: readonly WaitronModule[],
  resolvers: Record<string, string>,
): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  for (const mod of modules) {
    for (const ref of mod.backup?.nonDbState ?? []) {
      if (ref.kind !== "content-addressed-dir") {
        // Exhaustiveness guard. `NonDbSource.kind` is a closed union with one member today; the
        // capture below (read the resolved dir's flat files) is correct only for
        // `"content-addressed-dir"`. A future kind added to the type without a branch here would
        // otherwise be given flat-dir treatment silently — so the `never` binding fails the build
        // until a branch is added, and the throw fails the backup visibly at runtime meanwhile.
        const _never: never = ref.kind;
        throw new AppError("backup.source_kind_unsupported", { kind: _never });
      }
      const dir = resolvers[ref.source];
      if (dir === undefined) {
        throw new AppError("backup.source_unresolved", { source: ref.source });
      }

      let dirents: import("node:fs").Dirent[];
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        // A source dir that has never been written to (e.g. no images uploaded yet) is a valid,
        // empty contribution — the same ENOENT-tolerant idiom `LocalFsBackend.list` uses.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }

      // A content-addressed store is flat by construction, but filter to regular files anyway
      // rather than assume it: a stray subdirectory must not reach `readFile` (EISDIR) or be
      // captured as if it were a blob.
      const names = dirents
        .filter((d) => d.isFile())
        .map((d) => d.name)
        .sort();
      // Read the (already-sorted) files concurrently. `Array.map` preserves index order, so zipping
      // the results back against `names` keeps the deterministic sorted archive order intact.
      const blobs = await Promise.all(names.map((name) => readFile(join(dir, name))));
      names.forEach((name, i) => {
        entries.push({ name: `${ref.source}/${name}`, bytes: blobs[i]! });
      });
    }
  }
  return entries;
}
