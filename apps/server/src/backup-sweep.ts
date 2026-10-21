import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@waitron/db";
import { recordBackupOutcome, type BackupOutcomeHolder } from "./alert-sources.js";
import type { WaitronModule } from "@waitron/module";
import { assembleArchiveEntries, collectStateParts } from "./archive-entries.js";
import { encryptArtifactFile } from "./artifact-cipher-file.js";
import { ArchiveReadBudget } from "./archive-read-budget.js";
import { packArchiveStream, type ArchiveInputEntry } from "./backup-archive-file.js";
import { buildManifest, type BackupManifest } from "./backup-manifest.js";
import type { BackupSchedule } from "./backup-config.js";
import { MAX_SLEEP_MS, nextFireMs, type ScheduleClock } from "./backup-schedule.js";
import type { DeploymentEnvironment } from "./config.js";
import { errnoOf } from "./errno.js";
import { freeBytes, type Statfs } from "./free-bytes.js";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { Logger } from "./logger.js";
import {
  BACKUP_ENCRYPT_DIR_PREFIX,
  BACKUP_KEY_PREFIX,
  backupArchiveKey,
  dumpFileName,
  parseBackupArchiveKey,
} from "./backup-keys.js";
import { withDestinationCall } from "./backup-destination-call.js";
import type { StorageBackend, StorageCall } from "./storage-backend.js";
import "./errors.js";

export type ManifestBuilder = (deps: {
  readonly db: Database;
  readonly modules: readonly WaitronModule[];
  readonly environment: DeploymentEnvironment;
  readonly now: Date;
}) => Promise<BackupManifest>;

export interface DestinationResult {
  id: string;
  stored: boolean;
  uploadErrorCode: string | null;
  pruneErrorCode: string | null;
}

export interface BackupSweepDeps {
  backends: StorageBackend[];
  /** Read only for the manifest; the copy goes through {@link BackupSweepDeps.archive}. */
  db: Database;
  modules: readonly WaitronModule[];
  environment: DeploymentEnvironment;
  resolvers: Record<string, string>;
  stateDir: string;
  venueDir?: string;
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
  /**
   * Each destination's result, as soon as its own call settles; codes only. A destination whose call
   * finished is reported even when the run is stopped afterwards, so a caller tracking the current
   * key ignores results from a replaced sweep (as the supervisor does). A call that fails once the
   * run is stopped is not reported, even when its upload had already stored.
   */
  onDestinationResult?: (result: DestinationResult) => void;
  /** A destination's upload stored, reported at once, before its pruning runs; like
   * `onDestinationResult`, it can arrive from a run already stopped. That destination's later
   * `onDestinationResult` carries the pruning's outcome. */
  onUploaded?: (id: string) => void;
  /** How long one destination's upload and its pruning may run, together. */
  destinationTimeoutMs: number;
  onScheduled?: (at: number | null) => void;
  /** Read by the backups alert source, so a failed store, or a run that stopped before any
   * destination, shows before the freshness threshold. */
  outcomes?: BackupOutcomeHolder;
  log: Logger;
  /**
   * Must leave either a whole copy at `outFile` or nothing, so a truncated copy is never encrypted
   * as a good artifact; the store's `archiveTo` renames its working file into place when done.
   */
  archive: (outFile: string) => Promise<void>;
  buildManifest?: ManifestBuilder;
  now?: () => Date;
  /**
   * The venue database's current size. The staged copy and its ciphertext sit side by side in
   * `stagingDir`, so a tick refuses when free space there is under twice this before the copy, and
   * under the copy's own size after it. Advisory: nothing is reserved, and without this there is no
   * check.
   */
  stagingEstimateBytes?: () => Promise<number>;
  /** DI for tests; defaults to `node:fs/promises`'s `statfs`. */
  statfs?: Statfs;
}

/** Throws `backup.staging_space_low` when the staging folder's filesystem reports less than
 * `neededBytes` free; a filesystem that cannot report is let through. */
async function checkStagingSpace(
  deps: Pick<BackupSweepDeps, "stagingDir" | "statfs">,
  neededBytes: number,
): Promise<void> {
  const availableBytes = await freeBytes(deps.stagingDir, deps.statfs);
  if (availableBytes === null) return;
  if (availableBytes < neededBytes)
    throw new AppError("backup.staging_space_low", { neededBytes, availableBytes });
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
  let encryptedDir: string | undefined;
  const budget = new ArchiveReadBudget();
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
      collectStateParts(
        {
          stateDir: deps.stateDir,
          venueDir: deps.venueDir,
          modules: deps.modules,
          resolvers: deps.resolvers,
        },
        budget,
      ),
    ]);

    budget.addEntry("manifest.json", Buffer.byteLength(JSON.stringify(manifest)));
    budget.addEntry("db.dump", 0);
    await mkdir(deps.stagingDir, { recursive: true, mode: 0o700 });
    if (deps.stagingEstimateBytes)
      await checkStagingSpace(deps, 2 * (await deps.stagingEstimateBytes()));
    await deps.archive(staged);
    dumped = true;
    // The whole venue database in plaintext, created under the process umask.
    await chmod(staged, 0o600);
    if (deps.stagingEstimateBytes) await checkStagingSpace(deps, (await stat(staged)).size);
    const metadata = assembleArchiveEntries(manifest, null, parts);
    const entries: ArchiveInputEntry[] = [
      { kind: "bytes", entry: metadata[0] },
      { kind: "file", name: "db.dump", path: staged },
      ...metadata.slice(1).map((entry) => ({ kind: "bytes" as const, entry })),
    ];
    encryptedDir = await mkdtemp(join(deps.stagingDir, BACKUP_ENCRYPT_DIR_PREFIX));
    const ciphertext = join(encryptedDir, "artifact");
    await encryptArtifactFile(
      packArchiveStream(entries),
      ciphertext,
      deps.recoveryKey,
      deps.signal,
    );
    const key = backupArchiveKey(stamp);
    if (deps.outcomes) delete deps.outcomes.runStopped;
    // Every destination call has settled before `finally` removes the ciphertext they read.
    await Promise.allSettled(
      deps.backends.map(async (backend) => {
        let stored = false;
        let errorCode: string | null = null;
        try {
          await withDestinationCall(deps.signal, deps.destinationTimeoutMs, async (call) => {
            await backend.putFile(key, ciphertext, call);
            stored = true;
            deps.onUploaded?.(backend.id);
            if (deps.outcomes)
              recordBackupOutcome(deps.outcomes, backend.id, true, stamp.toISOString());
            await pruneBackend(backend, deps.retain, deps.retainDays, nowMs, call, key);
          });
          deps.log("info", "backup.destination_completed", { destination: backend.id, key });
        } catch (err) {
          if (deps.signal.aborted) return;
          // `codeOf` maps only AppErrors.
          errorCode = codeOf(err);
          const fields = { destination: backend.id, errorCode, errno: errnoOf(err) };
          if (stored) {
            deps.log("warn", "backup.destination_prune_failed", fields);
          } else {
            deps.log("warn", "backup.destination_failed", fields);
            if (deps.outcomes)
              recordBackupOutcome(deps.outcomes, backend.id, false, stamp.toISOString());
          }
        }
        deps.onDestinationResult?.({
          id: backend.id,
          stored,
          uploadErrorCode: stored ? null : errorCode,
          pruneErrorCode: stored ? errorCode : null,
        });
      }),
    );
  } catch (err) {
    // Only a step before the destination calls lands here: `Promise.allSettled` never rejects.
    if (!deps.signal.aborted && deps.outcomes)
      deps.outcomes.runStopped = { code: codeOf(err), at: stamp.toISOString() };
    throw err;
  } finally {
    if (encryptedDir) await rm(encryptedDir, { recursive: true, force: true });
    if (dumped) await rm(staged, { force: true });
  }
}

/** The limit S3 states for one multi-object delete, quoted at `DELETE_BATCH_KEYS` in
 * `packages/stream/src/s3-store.ts`; the bucket destination's `s3-file-store.ts` batches by the same
 * number. */
const DELETE_BATCH = 1000;

/** Deletes an archive past EITHER cap: beyond the `retain` newest, or older than `retainDays`, both
 * by the stamp in its key, never the file's mtime. Only a name {@link parseBackupArchiveKey} reads
 * is an archive; any other name is left where it is and does not take a kept slot. `justStored`,
 * the archive this run put, ranks first among archives sharing its stamp and is never deleted. */
export async function pruneBackend(
  backend: StorageBackend,
  retain: number,
  retainDays: number,
  nowMs: number,
  call: StorageCall,
  justStored?: string,
): Promise<void> {
  const archives = (await backend.list(BACKUP_KEY_PREFIX, call)).flatMap(({ key }) => {
    const parsed = parseBackupArchiveKey(key);
    return parsed === null ? [] : [{ key, ms: parsed.timestamp.getTime() }];
  });
  const rank = (key: string) => (key === justStored ? 1 : 0);
  archives.sort(
    (a, b) =>
      b.ms - a.ms || rank(b.key) - rank(a.key) || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0),
  );
  const maxAgeMs = retainDays * 24 * 60 * 60 * 1000;
  const toDelete = archives
    .filter(
      (archive, i) => archive.key !== justStored && (i >= retain || nowMs - archive.ms > maxAgeMs),
    )
    .map((archive) => archive.key);
  for (let i = 0; i < toDelete.length; i += DELETE_BATCH)
    await backend.deleteMany(toDelete.slice(i, i + DELETE_BATCH), call);
}

/**
 * Takes a copy at once, then sleeps toward each next fire in chunks of at most `MAX_SLEEP_MS`, so a
 * clock jump is noticed within the hour. A failed tick is logged with its code, never its message,
 * which could carry a path; an abort mid-tick is a cancellation, not a failure.
 */
export async function runBackupSweep(deps: BackupSweepDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  if (deps.signal.aborted) return;
  deps.onScheduled?.(null);
  try {
    await tick(deps);
    while (!deps.signal.aborted) {
      // Inside the try: a `readClock` rejection must not end the backup loop.
      let fireAt: number;
      try {
        const clock =
          deps.schedule.kind === "wall-clock"
            ? await deps.readClock()
            : { timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] };
        fireAt = nextFireMs(deps.schedule, clock, now(), deps.jitterSeed);
      } catch (err) {
        if (deps.signal.aborted) break;
        deps.log("warn", "backup.schedule_failed", { errorCode: codeOf(err) });
        await deps.sleep(MAX_SLEEP_MS, deps.signal);
        continue;
      }
      deps.onScheduled?.(fireAt);
      // `fireAt` is fixed for the cycle, so a time zone or cutover change lands at the next fire.
      // Never recompute it mid-wait: an interval schedule's next fire is `now + ms`, so each wake
      // would push it out again.
      while (!deps.signal.aborted && now().getTime() < fireAt) {
        const chunk = Math.min(MAX_SLEEP_MS, fireAt - now().getTime());
        await deps.sleep(chunk, deps.signal);
      }
      if (deps.signal.aborted) break;
      deps.onScheduled?.(null);
      await tick(deps);
    }
  } finally {
    deps.onScheduled?.(null);
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
