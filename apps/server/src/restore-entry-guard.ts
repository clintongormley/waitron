import { mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { AppError } from "@waitron/shared";
import "./errors.js";

/**
 * Validates ONE archive entry name against `destRoot` before the caller writes anything, and
 * returns the resolved absolute path it is safe to write to. This is BR-3's restore-side twin of
 * `unpackBundleToDir`'s guard (`state-secrets.ts:63-74`) — same two layers, same reasoning, applied
 * to a whole archive's entry names (`db.dump`, `media/<file>`, `secrets/<path>`) rather than the
 * fixed `RECOVERY_FILES` set: GCM/tar integrity proves the archive's BYTES are authentic, never
 * that its entry NAMES stay inside `destRoot`, so a crafted-but-authentic archive must still be
 * refused here before any write.
 *
 * Layer 1 — LEXICAL: reject an absolute `name` outright (defence in depth — `join` alone would
 * fold a leading `/` into `destRoot` rather than escaping it, but a future caller that resolves
 * `name` directly without joining first must not be trusted to get that right), and reject when
 * `resolve(join(destRoot, name))` does not land under `resolve(destRoot)` (a `../../etc/x`-style
 * escape). This is cheap and catches the common case, but it is blind to symlinks.
 *
 * Layer 2 — SYMLINK-aware: `mkdir(dirname(target), { recursive: true })` is a no-op when that
 * directory already "exists" through a symlink, so a pre-existing `destRoot/tls -> /outside` link
 * lets a lexically-fine name like `tls/ca.crt` resolve to a target whose real, on-disk parent is
 * `/outside`. Only `realpath`ing the parent AFTER ensuring it exists reveals that. `destRoot` must
 * already exist (or be creatable as an ancestor of `dirname(target)`) for `realpath` to succeed —
 * the restore CLI creates it before validating any entry, matching `unpackBundleToDir`'s own
 * `mkdir(destDir)`-before-`realpath(destDir)` ordering.
 *
 * Throws `restore.unsafe_entry_path: { name }` for either layer. Never writes file contents —
 * that stays the caller's job once this returns the safe path.
 */
export async function assertSafeEntryName(name: string, destRoot: string): Promise<string> {
  const root = resolve(destRoot);
  const target = resolve(join(destRoot, name));
  if (isAbsolute(name) || !target.startsWith(root + sep)) {
    throw new AppError("restore.unsafe_entry_path", { name });
  }

  const parent = dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  // Lexical guard is blind to symlinks: `mkdir` on an existing `destRoot/tls -> /outside` symlink is
  // a no-op, so resolve the real parent and confirm it is still within destRoot before returning.
  const realRoot = await realpath(root);
  const realParent = await realpath(parent);
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
    throw new AppError("restore.unsafe_entry_path", { name });
  }

  return target;
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
