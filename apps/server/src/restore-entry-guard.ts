import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
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
 * crafted-but-authentic archive must still be refused here before any write. The archive validator
 * rejects repeated destination paths and normalizes accepted names before identity reads or writes;
 * this single-entry guard permits aliases that stay inside the destination root.
 *
 * `destRoot` must already exist (or be creatable as an ancestor of the entry's parent) for the
 * guard's `realpath` to succeed — the restore CLI creates it before validating any entry, matching
 * `unpackBundleToDir`'s own `mkdir(destDir)`-before-guard ordering.
 *
 * `realDestRoot` lets a caller looping over many entries against the SAME `destRoot` (e.g.
 * `restoreMedia`'s chunked writes) pass a `realpath(resolve(destRoot))` computed ONCE up front,
 * rather than re-`realpath`ing the same root on every call. A single-entry caller omits it and this
 * computes it inline — one `realpath` either way, so nothing regresses for that shape.
 *
 * Throws `restore.unsafe_entry_path: { name }` for either layer — this caller's long-standing code
 * (CLAUDE.md §3), mapped from the shared guard's failure via the `onUnsafe` callback. Never writes
 * file contents — that stays the caller's job once this returns the safe path.
 */
export async function assertSafeEntryName(
  name: string,
  destRoot: string,
  realDestRoot?: string,
): Promise<string> {
  const realRoot = realDestRoot ?? (await realpath(resolve(destRoot)));
  return resolveSafeEntryPath(name, destRoot, realRoot, () => {
    throw new AppError("restore.unsafe_entry_path", { name });
  });
}
