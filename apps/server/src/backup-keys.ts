/**
 * How every backup artifact is named, and nothing else.
 *
 * This file used to be pg-dump.ts and used to hold the `pg_dump` shell-out and an atomic
 * temp-then-rename wrapper around it. Both are gone with PostgreSQL: a backup now copies the venue
 * database file through the engine's own `VACUUM INTO`, and the temp-then-rename discipline lives
 * in `packages/store/src/archive.ts`'s `archiveTo`, which already did it and additionally clears a
 * stale working file.
 *
 * **The key FORMAT did not change**, deliberately: `waitron-<basic-ISO>.backup.enc`. The sweep's
 * prune and the freshness reader both scan `list(BACKUP_KEY_PREFIX)` (`backup-sweep.ts`,
 * `backup-status.ts`), so artifacts written before the storage switch stay readable and prunable.
 */

/** The key-naming convention every backup artifact shares: `dumpFileName` builds names from it, and
 * both the sweep's prune (`backup-sweep.ts`) and the status reader (`backup-status.ts`) scan
 * `list(BACKUP_KEY_PREFIX)` for it. Single source of truth so the three cannot drift apart. */
export const BACKUP_KEY_PREFIX = "waitron-";

/** A filesystem-safe, lexically-sortable timestamp for `now`: basic ISO, no colons (Windows/tooling
 * safe) and second-precision, so a lexical sort of names built from it is a chronological sort, e.g.
 * `20260829T175501Z`. Shared by `dumpFileName` (the staging copy) and `backupArchiveKey` (the
 * fanned-out artifact), so the two cannot drift on how they stamp the SAME instant. */
function basicIsoStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

/** The pre-encryption STAGING filename for `now`: `waitron-<basic-ISO>.dump`, e.g.
 * `waitron-20260829T175501Z.dump`. This names only the plaintext copy of the venue database on
 * disk; the fanned-out artifact carries {@link backupArchiveKey}'s `.backup.enc` name instead (the
 * two share the same stamp so a run's staging file and its artifact line up). The `.dump` suffix is
 * kept for that pairing, not because the bytes are still a `pg_dump` archive — they are a SQLite
 * database file. */
export function dumpFileName(now: Date): string {
  return `${BACKUP_KEY_PREFIX}${basicIsoStamp(now)}.dump`;
}

/** The fanned-out artifact KEY for `now`: `waitron-<basic-ISO>.backup.enc` — the full encrypted
 * backup archive (manifest + db copy + module non-DB state + state secrets), distinct from the
 * `.dump` STAGING name above. Pruning and freshness both scan `list(BACKUP_KEY_PREFIX)` (backup-sweep.ts /
 * backup-status.ts), which is suffix-agnostic, so this key is pruned and read fresh like any
 * `waitron-*` object. */
export function backupArchiveKey(now: Date): string {
  return `${BACKUP_KEY_PREFIX}${basicIsoStamp(now)}.backup.enc`;
}

/** The inverse of {@link backupArchiveKey}'s stamp: the immutable backup INSTANT parsed back out of
 * a `waitron-<basic-ISO>.*` key, at the second precision `basicIsoStamp` carries (sub-seconds are
 * dropped by the stamp, so they cannot be recovered). The sweep's dual-retention prune reads an
 * artifact's age off THIS — the time baked into its own name — rather than the filesystem `mtimeMs`,
 * so a later clock change (a box's wall clock jumping back, a restore) can never resurrect a window
 * that was already past the age cap (spec §3.3). Throws on a key whose stamp is missing/malformed —
 * every real backup key carries one, so a bad key is a defect, not a value to guess an age for. */
export function backupArchiveTimestamp(key: string): Date {
  const m = /waitron-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(key);
  if (m === null) throw new Error(`backup key carries no parseable timestamp: ${key}`);
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}
