import { randomUUID } from "node:crypto";

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

/** The encrypted archive written to each destination. The nonce keeps two archives taken in the
 * same second, or a retried one, from overwriting each other. */
export function backupArchiveKey(now: Date, nonce: string = randomUUID()): string {
  return `${BACKUP_KEY_PREFIX}${basicIsoStamp(now)}-${nonce}.backup.enc`;
}

const ARCHIVE_KEY =
  /^waitron-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.backup\.enc$/;

/** A key {@link backupArchiveKey} could have minted, read back to the second; anything else is
 * null. The sweep reads an archive's age from this, never the file's mtime. */
export function parseBackupArchiveKey(key: string): { timestamp: Date; nonce: string } | null {
  const m = ARCHIVE_KEY.exec(key);
  if (m === null) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const timestamp = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Date.UTC rolls an impossible field over (month 13, 30 February), so it would no longer print
  // back as the same stamp.
  if (!key.startsWith(`${BACKUP_KEY_PREFIX}${basicIsoStamp(timestamp)}-`)) return null;
  return { timestamp, nonce: m[7] };
}
