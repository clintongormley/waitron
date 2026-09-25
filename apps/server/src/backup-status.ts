import { BACKUP_KEY_PREFIX } from "./backup-keys.js";
import type { StorageBackend } from "./storage-backend.js";

/** A destination holding no artifact yet reads `stale: true` with null times: unhealthy, not absent. */
export type DestinationStatus = {
  id: string;
  lastBackupAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
};

export type BackupStatus =
  { configured: false } | { configured: true; destinations: DestinationStatus[] };

/** A backend fault propagates rather than reporting a status this cannot stand behind. */
export async function readBackupStatus(
  backends: StorageBackend[],
  staleAfterMs: number,
  now: Date,
): Promise<BackupStatus> {
  if (backends.length === 0) return { configured: false };

  const destinations = await Promise.all(
    backends.map((backend) => destinationStatus(backend, staleAfterMs, now)),
  );
  return { configured: true, destinations };
}

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
