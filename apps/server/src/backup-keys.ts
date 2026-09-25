/** The sweep's prune and the status reader both find artifacts by listing this prefix. */
export const BACKUP_KEY_PREFIX = "waitron-";

/** Basic ISO at second precision with no colons, e.g. `20260829T175501Z`, so a lexical sort of
 * names is a chronological sort. */
function basicIsoStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

/** The plaintext staging copy of the venue database, before encryption. */
export function dumpFileName(now: Date): string {
  return `${BACKUP_KEY_PREFIX}${basicIsoStamp(now)}.dump`;
}

/** The encrypted archive written to each destination. */
export function backupArchiveKey(now: Date): string {
  return `${BACKUP_KEY_PREFIX}${basicIsoStamp(now)}.backup.enc`;
}

/** The backup instant parsed back out of a key, to the second. The sweep reads an artifact's age
 * from this, never from the file's mtime. Throws on a key with no stamp: that is a defect, not an
 * age to guess. */
export function backupArchiveTimestamp(key: string): Date {
  const m = /waitron-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(key);
  if (m === null) throw new Error(`backup key carries no parseable timestamp: ${key}`);
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}
