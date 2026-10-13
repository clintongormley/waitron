import { codeOf } from "@waitron/server-kit";
import { withDestinationCall } from "./backup-destination-call.js";
import { BACKUP_KEY_PREFIX, parseBackupArchiveKey } from "./backup-keys.js";
import type { StorageBackend } from "./storage-backend.js";

export const STATUS_READ_TIMEOUT_MS = 30_000;

/**
 * A destination holding no artifact yet, or one that could not be read, reads `stale: true` with
 * null times: unhealthy, not absent. `readErrorCode` is the read's code, never its message.
 */
export type DestinationStatus = {
  id: string;
  lastBackupAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  readErrorCode: string | null;
};

export type BackupStatus =
  { configured: false } | { configured: true; destinations: DestinationStatus[] };

const NEVER_ABORTED = new AbortController().signal;

/** Each destination is read under its own limit, so one that fails or stalls never hides the rest. */
export async function readBackupStatus(
  backends: StorageBackend[],
  staleAfterMs: number,
  now: Date,
  readTimeoutMs: number = STATUS_READ_TIMEOUT_MS,
): Promise<BackupStatus> {
  if (backends.length === 0) return { configured: false };

  const destinations = await Promise.all(
    backends.map((backend) => destinationStatus(backend, staleAfterMs, now, readTimeoutMs)),
  );
  return { configured: true, destinations };
}

async function destinationStatus(
  backend: StorageBackend,
  staleAfterMs: number,
  now: Date,
  readTimeoutMs: number,
): Promise<DestinationStatus> {
  const unread = { id: backend.id, lastBackupAt: null, ageSeconds: null, stale: true };
  let objects;
  try {
    objects = await withDestinationCall(NEVER_ABORTED, readTimeoutMs, (call) =>
      backend.list(BACKUP_KEY_PREFIX, call),
    );
  } catch (err) {
    return { ...unread, readErrorCode: codeOf(err) };
  }
  // The listing is newest-first.
  const newest = objects.find(({ key }) => parseBackupArchiveKey(key) !== null);
  if (newest === undefined) return { ...unread, readErrorCode: null };
  const ageMs = now.getTime() - newest.mtimeMs;
  return {
    id: backend.id,
    lastBackupAt: new Date(newest.mtimeMs).toISOString(),
    ageSeconds: Math.floor(ageMs / 1000),
    stale: ageMs > staleAfterMs,
    readErrorCode: null,
  };
}
