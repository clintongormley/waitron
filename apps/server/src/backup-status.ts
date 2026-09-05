import { BACKUP_KEY_PREFIX } from "./pg-dump.js";
import type { StorageBackend } from "./storage-backend.js";

/**
 * One freshness entry per configured backup destination. `lastBackupAt`/`ageSeconds` are `null` and
 * `stale: true` when that destination holds no artifact yet — a backup that has never landed there is
 * stale by definition, and must read as unhealthy rather than absent.
 */
export type DestinationStatus = {
  id: string;
  lastBackupAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
};

/**
 * The backup slice's box-status contribution, widened for BR-1 storage fan-out. `configured: false` is
 * the deliberate N/A placeholder used when no backup reader is wired (backup disabled). When a reader
 * IS present it reports `configured: true` with one `DestinationStatus` per destination — each read
 * independently, so one stale/empty destination is visible alongside the fresh ones rather than
 * collapsing them into a single summary.
 */
export type BackupStatus =
  { configured: false } | { configured: true; destinations: DestinationStatus[] };

/**
 * Summarise each backend's freshness. Scans `backend.list("waitron-")` (newest-first per the
 * `StorageBackend` contract), so it matches the sweep's encrypted `waitron-<stamp>.backup.enc` archives
 * — a PREFIX match, so it is suffix-agnostic (it matched BR-1's `.dump.enc` too), NOT the pre-BR-1
 * `waitron-*.dump` filter whose anchored `\.dump$` missed the `.enc` suffix and reported a working
 * backup permanently stale. With no backends (backup off) reports
 * `{ configured: false }`; a destination with no artifact yet reports null fields and `stale: true`.
 * `ageSeconds` is measured against `now` — the caller passes request time so freshness is per-request.
 * Any filesystem/backend fault propagates (fail-loud — the caller surfaces it, matching the box-status
 * replication reader's posture).
 */
export async function readBackupStatus(
  backends: StorageBackend[],
  staleAfterMs: number,
  now: Date,
): Promise<BackupStatus> {
  if (backends.length === 0) return { configured: false };

  // Each destination is read independently and concurrently — this is on the box-status request path,
  // so the destinations' `list` calls run in parallel rather than serially.
  const destinations = await Promise.all(
    backends.map((backend) => destinationStatus(backend, staleAfterMs, now)),
  );
  return { configured: true, destinations };
}

/** One destination's freshness. Scans `list(BACKUP_KEY_PREFIX)` (newest-first per the
 * `StorageBackend` contract); a destination with no artifact yet reports null fields and
 * `stale: true`. */
async function destinationStatus(
  backend: StorageBackend,
  staleAfterMs: number,
  now: Date,
): Promise<DestinationStatus> {
  const objects = await backend.list(BACKUP_KEY_PREFIX); // newest-first
  const newest = objects[0];
  if (newest === undefined) {
    return { id: backend.id, lastBackupAt: null, ageSeconds: null, stale: true };
  }
  const ageMs = now.getTime() - newest.mtimeMs;
  return {
    id: backend.id,
    lastBackupAt: new Date(newest.mtimeMs).toISOString(),
    ageSeconds: Math.floor(ageMs / 1000),
    stale: ageMs > staleAfterMs,
  };
}
