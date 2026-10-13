import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { BACKUP_KEY_PREFIX, parseBackupArchiveKey } from "./backup-keys.js";
import type { StorageBackend, StoredObject } from "./storage-backend.js";
import "./errors.js";

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

export const unreadDestination = (id: string, readErrorCode: string | null): DestinationStatus => ({
  id,
  lastBackupAt: null,
  ageSeconds: null,
  stale: true,
  readErrorCode,
});

export interface DestinationRead {
  /** Answers by the read limit, as timed out if the listing has not answered by then. */
  status: Promise<DestinationStatus>;
  /** Resolves once the listing itself has settled, which can be after `status` answers; it never
   * resolves for a listing that never settles. */
  settled: Promise<void>;
}

/** One destination's freshness. The listing is aborted at the limit, but a folder listing's
 * `readdir` takes no abort signal, so `status` does not wait for it to stop. */
export function readDestinationStatus(
  backend: StorageBackend,
  staleAfterMs: number,
  now: Date,
  readTimeoutMs: number = STATUS_READ_TIMEOUT_MS,
): DestinationRead {
  const controller = new AbortController();
  const timedOut = new AppError("backup.destination_timed_out", { timeoutMs: readTimeoutMs });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Before the abort, so a listing that fails on the abort answers as timed out, not uncoded.
      reject(timedOut);
      controller.abort(timedOut);
    }, readTimeoutMs);
  });
  const listing = backend.list(BACKUP_KEY_PREFIX, { signal: controller.signal });
  const settled = listing.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer),
  );
  // `Promise.race` subscribes to the listing, so a failure after the limit is handled, not lost.
  const status = Promise.race([listing, limit]).then(
    (objects) => freshness(backend.id, objects, staleAfterMs, now),
    (err) => unreadDestination(backend.id, codeOf(err)),
  );
  return { status, settled };
}

function freshness(
  id: string,
  objects: StoredObject[],
  staleAfterMs: number,
  now: Date,
): DestinationStatus {
  // The listing is newest-first.
  const newest = objects.find(({ key }) => parseBackupArchiveKey(key) !== null);
  if (newest === undefined) return unreadDestination(id, null);
  const ageMs = now.getTime() - newest.mtimeMs;
  return {
    id,
    lastBackupAt: new Date(newest.mtimeMs).toISOString(),
    ageSeconds: Math.floor(ageMs / 1000),
    stale: ageMs > staleAfterMs,
    readErrorCode: null,
  };
}
