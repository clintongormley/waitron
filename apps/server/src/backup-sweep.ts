// The scheduled backup worker. Each tick copies the venue database to a staging file, packs it with
// the manifest, module non-DB state and state secrets into one archive, encrypts that ONCE under the
// recovery key, puts the same ciphertext to every destination, and prunes each destination.
//
// A failing tick is logged and the loop goes on, and a destination that throws does not cost the
// others their copy. A destination that HANGS stalls the tick: `backend.put` is handed no signal,
// so an abort cannot interrupt it.

import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@waitron/db";
import { recordBackupOutcome, type BackupOutcomeHolder } from "./alert-sources.js";
import type { WaitronModule } from "@waitron/module";
import { assembleArchiveEntries, collectStateParts } from "./archive-entries.js";
import { encryptArtifactAsync } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import { buildManifest, type BackupManifest } from "./backup-manifest.js";
import type { BackupSchedule } from "./backup-config.js";
import { MAX_SLEEP_MS, nextFireMs, type ScheduleClock } from "./backup-schedule.js";
import type { DeploymentEnvironment } from "./config.js";
import { codeOf } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import {
  BACKUP_KEY_PREFIX,
  backupArchiveKey,
  backupArchiveTimestamp,
  dumpFileName,
} from "./backup-keys.js";
import type { StorageBackend } from "./storage-backend.js";
import "./errors.js";

export type ManifestBuilder = (deps: {
  readonly db: Database;
  readonly modules: readonly WaitronModule[];
  readonly environment: DeploymentEnvironment;
  readonly now: Date;
}) => Promise<BackupManifest>;

export interface BackupSweepDeps {
  backends: StorageBackend[];
  /** Read only for the manifest; the copy goes through {@link BackupSweepDeps.archive}. */
  db: Database;
  modules: readonly WaitronModule[];
  environment: DeploymentEnvironment;
  resolvers: Record<string, string>;
  stateDir: string;
  recoveryKey: string;
  /** Created each tick; the plaintext copy staged here is removed before the tick returns. */
  stagingDir: string;
  schedule: BackupSchedule;
  /** How many of the newest artifacts each destination keeps. */
  retain: number;
  /** An artifact older than this many days is deleted even within the count cap. */
  retainDays: number;
  /** Node-stable, so a fleet spreads its `auto` backups across a window rather than firing together. */
  jitterSeed: string;
  /** Read fresh each cycle, and only for a `wall-clock` schedule. */
  readClock: () => Promise<ScheduleClock>;
  signal: AbortSignal;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Fires only on a tick where at least one destination stored the archive. */
  onStored?: () => void;
  /** Read by the backups alert source, so a failed store shows before the freshness threshold. */
  outcomes?: BackupOutcomeHolder;
  log: Logger;
  /**
   * Must leave either a whole copy at `outFile` or nothing, so a truncated copy is never encrypted
   * as a good artifact; the store's `archiveTo` renames its working file into place when done.
   */
  archive: (outFile: string) => Promise<void>;
  buildManifest?: ManifestBuilder;
  now?: () => Date;
}

/**
 * One backup. A failure to build the manifest or collect state throws before the database copy, and
 * no partial archive is ever put to a destination.
 */
export async function runOnce(
  deps: Omit<BackupSweepDeps, "schedule" | "sleep" | "jitterSeed" | "readClock">,
): Promise<void> {
  const nowMs = (deps.now ?? (() => new Date()))().getTime();
  const buildBackupManifest = deps.buildManifest ?? buildManifest;
  const stamp = (deps.now ?? (() => new Date()))();
  const dumpName = dumpFileName(stamp);
  const staged = join(deps.stagingDir, dumpName);
  let dumped = false;
  try {
    // Collected before the copy, so a broken state folder fails the tick without copying the
    // whole database.
    const [manifest, parts] = await Promise.all([
      buildBackupManifest({
        db: deps.db,
        modules: deps.modules,
        environment: deps.environment,
        now: stamp,
      }),
      collectStateParts({
        stateDir: deps.stateDir,
        modules: deps.modules,
        resolvers: deps.resolvers,
      }),
    ]);

    await mkdir(deps.stagingDir, { recursive: true });
    await deps.archive(staged);
    dumped = true;
    // The whole venue database in plaintext, created under the process umask.
    await chmod(staged, 0o600);
    const dumpBytes = await readFile(staged);
    const entries = assembleArchiveEntries(manifest, dumpBytes, parts);
    const ciphertext = await encryptArtifactAsync(packArchive(entries), deps.recoveryKey);
    const key = backupArchiveKey(stamp);
    let anyStored = false;
    await Promise.allSettled(
      deps.backends.map(async (backend) => {
        // Separate from the whole try: a prune fault must not record a stored archive as failed.
        let stored = false;
        try {
          await backend.put(key, ciphertext);
          stored = true;
          anyStored = true;
          if (deps.outcomes)
            recordBackupOutcome(deps.outcomes, backend.id, true, stamp.toISOString());
          await pruneBackend(backend, deps.retain, deps.retainDays, nowMs);
          deps.log("info", "backup.destination_completed", { destination: backend.id, key });
        } catch (err) {
          // `codeOf` maps only AppErrors; the errno is a fixed symbol, never the path or message.
          deps.log("warn", "backup.destination_failed", {
            destination: backend.id,
            errorCode: codeOf(err),
            errno: (err as NodeJS.ErrnoException).code,
          });
          if (deps.outcomes && !stored)
            recordBackupOutcome(deps.outcomes, backend.id, false, stamp.toISOString());
        }
      }),
    );
    if (anyStored) deps.onStored?.();
  } finally {
    if (dumped) await rm(staged, { force: true });
  }
}

/** Deletes an artifact past EITHER cap: beyond the `retain` newest (`list` is newest-first), or older
 * than `retainDays` by the stamp in its key, never the file's mtime. */
export async function pruneBackend(
  backend: StorageBackend,
  retain: number,
  retainDays: number,
  nowMs: number,
): Promise<void> {
  const objects = await backend.list(BACKUP_KEY_PREFIX);
  const maxAgeMs = retainDays * 24 * 60 * 60 * 1000;
  const toDelete = objects.filter(
    (obj, i) => i >= retain || nowMs - backupArchiveTimestamp(obj.key).getTime() > maxAgeMs,
  );
  await Promise.all(toDelete.map((obj) => backend.delete(obj.key)));
}

/**
 * Takes a copy at once, then sleeps toward each next fire in chunks of at most `MAX_SLEEP_MS`, so a
 * clock jump is noticed within the hour. A failed tick is logged with its code, never its message,
 * which could carry a path; an abort mid-tick is a cancellation, not a failure.
 */
export async function runBackupSweep(deps: BackupSweepDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  if (deps.signal.aborted) return;
  await tick(deps);
  while (!deps.signal.aborted) {
    // Inside the try: a `readClock` rejection must not end the backup loop.
    let fireAt: number;
    try {
      const clock =
        deps.schedule.kind === "wall-clock"
          ? await deps.readClock()
          : { timeZone: "UTC", dayCutover: "00:00" };
      fireAt = nextFireMs(deps.schedule, clock, now(), deps.jitterSeed);
    } catch (err) {
      if (deps.signal.aborted) break;
      deps.log("warn", "backup.schedule_failed", { errorCode: codeOf(err) });
      await deps.sleep(MAX_SLEEP_MS, deps.signal);
      continue;
    }
    // `fireAt` is fixed for the cycle, so a time zone or cutover change lands at the next fire.
    // Never recompute it mid-wait: an interval schedule's next fire is `now + ms`, so each wake
    // would push it out again.
    while (!deps.signal.aborted && now().getTime() < fireAt) {
      const chunk = Math.min(MAX_SLEEP_MS, fireAt - now().getTime());
      await deps.sleep(chunk, deps.signal);
    }
    if (deps.signal.aborted) break;
    await tick(deps);
  }
}

async function tick(deps: BackupSweepDeps): Promise<void> {
  try {
    await runOnce(deps);
  } catch (err) {
    if (deps.signal.aborted) return;
    deps.log("warn", "backup.failed", { errorCode: codeOf(err) });
  }
}
