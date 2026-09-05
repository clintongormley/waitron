import { AppError } from "@waitron/shared";
import { resolveSafeEntryPath } from "./state-secrets.js";
import "./errors.js";

/**
 * Validates ONE archive entry name against `destRoot` before the caller writes anything, and
 * returns the resolved absolute path it is safe to write to. A thin restore-side wrapper over the
 * shared {@link resolveSafeEntryPath} (`state-secrets.ts`) — the SAME two-layer lexical+symlink
 * guard `unpackBundleToDir` uses — applied to a whole archive's entry names (`db.dump`,
 * `media/<file>`, `secrets/<path>`) rather than the fixed `RECOVERY_FILES` set. GCM/tar integrity
 * proves the archive's BYTES are authentic, never that its entry NAMES stay inside `destRoot`, so a
 * crafted-but-authentic archive must still be refused here before any write.
 *
 * `destRoot` must already exist (or be creatable as an ancestor of the entry's parent) for the
 * guard's `realpath` to succeed — the restore CLI creates it before validating any entry, matching
 * `unpackBundleToDir`'s own `mkdir(destDir)`-before-guard ordering.
 *
 * Throws `restore.unsafe_entry_path: { name }` for either layer — this caller's long-standing code
 * (CLAUDE.md §3), mapped from the shared guard's failure via the `onUnsafe` callback. Never writes
 * file contents — that stays the caller's job once this returns the safe path.
 */
export async function assertSafeEntryName(name: string, destRoot: string): Promise<string> {
  return resolveSafeEntryPath(name, destRoot, () => {
    throw new AppError("restore.unsafe_entry_path", { name });
  });
}

/**
 * Validates every entry `name` in an archive listing against `destRoot`, in order, failing on the
 * FIRST unsafe one — so a caller can gate a whole restore ("validate every entry before writing
 * any of them") with one call, rather than re-implementing the loop at each call site.
 */
export async function assertSafeEntryNames(
  names: readonly string[],
  destRoot: string,
): Promise<void> {
  for (const name of names) {
    await assertSafeEntryName(name, destRoot);
  }
}
