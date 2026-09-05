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
 * `StorageBackend` contract), so it matches the sweep's encrypted `waitron-<stamp>.dump.enc` artifacts
 * — NOT the pre-Task-5 `waitron-*.dump` filter, whose anchored `\.dump$` missed the `.enc` suffix and
 * reported a working backup permanently stale. With no backends (backup off) reports
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

  const destinations: DestinationStatus[] = [];
  for (const backend of backends) {
    const objects = await backend.list("waitron-"); // newest-first
    const newest = objects[0];
    if (newest === undefined) {
      destinations.push({ id: backend.id, lastBackupAt: null, ageSeconds: null, stale: true });
      continue;
    }
    const ageMs = now.getTime() - newest.mtimeMs;
    destinations.push({
      id: backend.id,
      lastBackupAt: new Date(newest.mtimeMs).toISOString(),
      ageSeconds: Math.floor(ageMs / 1000),
      stale: ageMs > staleAfterMs,
    });
  }
  return { configured: true, destinations };
}
