// The backup duty's lifecycle owner, so the duty can be reconfigured at runtime WITHOUT restarting
// the process. `reload()` stops the running duty, closes its own database handle, re-reads the config
// from disk, opens the venue again, and — only on a singleton primary with a valid config it could
// open — starts a fresh sweep whose immediate first tick takes a copy under the new config.
//
// It opens its OWN handle on the venue directory rather than reusing boot's, because `reload()` closes
// it, and boot's handle is the one the server answers requests on.
//
// `archiveUnderCurrentKey` is an IN-PROCESS signal, true once any destination's upload in the
// current sweep has stored, never inferred from a stored object's mtime: a restored/copied
// OLD-key archive can carry a fresh mtime, so mtime does not prove the key.

import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { openVenueDatabase, type SingletonRole, type VenueDatabase } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { VENUE_FILE } from "@waitron/store";
import { AppError } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import { buildBackupBackend, type ResolvedBackupDestination } from "./backup-backends.js";
import type { BackupConfig, BackupSchedule } from "./backup-config.js";
import type { ScheduleClock } from "./backup-schedule.js";
import {
  readDestinationStatus,
  unreadDestination,
  type DestinationStatus,
} from "./backup-status.js";
import { runBackupSweep, type DestinationResult } from "./backup-sweep.js";
import type { BackupOutcomeHolder } from "./alert-sources.js";
import type { StorageBackend } from "./storage-backend.js";
import type { DeploymentEnvironment } from "./config.js";
import { realSleep } from "./loop.js";
import type { Logger } from "./logger.js";
import "./errors.js";

/** A SYNC, config-derived snapshot of the backup duty — no I/O. The routes and the box-status shell
 * read this; `status()` layers the async freshness on top. */
export interface BackupRuntimeStatus {
  enabled: boolean;
  isPrimary: boolean;
  managedByEnvironment: boolean;
  destinations: { id: string; dir: string }[];
  schedule: BackupSchedule | undefined;
  retention: { count: number; days: number } | undefined;
  /** Short hash PREFIX of the running recovery key — NEVER the key itself. */
  keyFingerprint: string | undefined;
  keyRotatedAt: string | undefined;
  /** The effective running recovery key, for `GET recovery-key`. Never logged. */
  recoveryKey: string | undefined;
}

/** A destination's freshness plus what the sweep under the reported settings did there:
 * `storedUnderCurrentKey` once it stored, and the latest upload and pruning codes. */
export type SupervisedDestinationStatus = DestinationStatus & {
  storedUnderCurrentKey: boolean;
  uploadErrorCode: string | null;
  pruneErrorCode: string | null;
};

export type SupervisedBackupStatus =
  { configured: false } | { configured: true; destinations: SupervisedDestinationStatus[] };

type SweepRecord = Omit<SupervisedDestinationStatus, keyof DestinationStatus>;

/** What one config's sweep has done, per destination. Replaced, never cleared, when a reload adopts
 * a config, so a status read holding the old one keeps the settings and the record together. */
type SweepRecords = Map<string, SweepRecord>;

const NO_RECORD: SweepRecord = {
  storedUnderCurrentKey: false,
  uploadErrorCode: null,
  pruneErrorCode: null,
};

export interface BackupSupervisorDeps {
  /** Re-reads the box-env files from DISK each reload — closing over a boot-time value would make
   * hot-reload a no-op. */
  buildConfig: () => Promise<BackupConfig | undefined>;
  /** True iff any `WAITRON_BACKUP_*` var is non-empty in the RAW base env. */
  isManagedByEnvironment: () => boolean;
  /** The live singleton role, read fresh each reload/status so a promotion is followed. */
  readSingletonRole: () => SingletonRole;
  /** `config.venueDir`. The supervisor opens it ITSELF rather than taking boot's handle — see this
   * file's header. */
  venueDir: string;
  modules: readonly WaitronModule[];
  environment: DeploymentEnvironment;
  stateDir: string;
  jitterSeed: string;
  /** The venue's wall clock (tz + business-day cutover). */
  readClock: () => Promise<ScheduleClock>;
  /** In-memory per-destination outcome holder the backups alert source reads. Passed straight to the
   * sweep so each destination's tick result is recorded; optional so tests that ignore alerts omit it. */
  outcomes?: BackupOutcomeHolder;
  log: Logger;
  /** DI for tests; defaults to `openVenueDatabase`. */
  openVenue?: (directory: string) => Promise<VenueDatabase>;
  onScheduled?: (at: number | null) => void;
  /** DI for tests; defaults to `buildBackupBackend`. */
  buildBackend?: (dest: ResolvedBackupDestination) => StorageBackend;
  /** DI for tests; defaults to `readDestinationStatus`'s own limit. */
  statusReadTimeoutMs?: number;
  now?: () => Date;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** The size of the venue database file, without its write-ahead file; a missing file counts as
 * empty. */
export async function venueStagingEstimate(venueDir: string): Promise<number> {
  try {
    return (await stat(join(venueDir, VENUE_FILE))).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return 0;
  }
}

export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export class BackupSupervisor {
  readonly #deps: BackupSupervisorDeps;
  readonly #buildBackend: (dest: ResolvedBackupDestination) => StorageBackend;
  #controller: AbortController | undefined;
  #worker: Promise<void> | undefined;
  #backends: StorageBackend[] = [];
  #db: VenueDatabase | undefined;
  #config: BackupConfig | undefined;
  #reloading = false;
  /** Set once by `stop()` (shutdown is terminal). `reload()` checks it after every `await` and bails —
   * tearing down anything it opened — rather than start (or leave) a worker after a stop. */
  #stopped = false;
  #sweep: SweepRecords = new Map();

  constructor(deps: BackupSupervisorDeps) {
    this.#deps = deps;
    this.#buildBackend = deps.buildBackend ?? buildBackupBackend;
  }

  /** Latched: a concurrent reload throws `backup.reload_in_progress` rather than racing two
   * teardowns. */
  async reload(): Promise<void> {
    if (this.#reloading) throw new AppError("backup.reload_in_progress", {});
    this.#reloading = true;
    try {
      await this.#teardown();
      // A `stop()` may have run while we awaited the teardown, which already left no worker/handle.
      if (this.#stopped) return;
      const cfg = await this.#deps.buildConfig();
      if (this.#stopped) return; // a stop() landed during buildConfig — don't adopt this config
      this.#config = cfg;
      this.#sweep = new Map();
      if (cfg === undefined || this.#deps.readSingletonRole() !== "primary") {
        // #config is kept so `current()` can report the destinations/schedule; enabled stays false
        // because `#db` is undefined (nothing was opened) — a non-primary reads disabled.
        this.#deps.log("info", "backup.disabled", {});
        return;
      }
      const openVenue = this.#deps.openVenue ?? openVenueDatabase;
      let db: VenueDatabase | undefined;
      try {
        // A venue directory that will not open leaves backup OFF rather than throwing out of reload.
        db = await openVenue(this.#deps.venueDir);
      } catch (err) {
        if (db !== undefined) await db.close().catch(() => {});
        this.#deps.log("error", "backup.disabled_open_failed", { errorCode: codeOf(err) });
        this.#config = undefined;
        return;
      }
      // A `stop()` landed while we opened the venue: bail WITHOUT assigning `#db` or starting a
      // worker, or the sweep would outlive the `stop()` that already returned.
      if (this.#stopped) {
        await db?.close().catch(() => {});
        return;
      }
      const venue = db;
      this.#db = venue;
      const controller = new AbortController();
      this.#controller = controller;
      this.#backends = cfg.destinations.map(this.#buildBackend);
      this.#worker = runBackupSweep({
        backends: this.#backends,
        db: venue.venue,
        modules: this.#deps.modules,
        environment: this.#deps.environment,
        resolvers: {},
        stateDir: this.#deps.stateDir,
        stagingDir: join(this.#deps.stateDir, "backup-staging"),
        archive: (outFile) => venue.venue.archiveTo(outFile),
        stagingEstimateBytes: () => venueStagingEstimate(this.#deps.venueDir),
        recoveryKey: cfg.recoveryKey,
        schedule: cfg.schedule,
        retain: cfg.retain,
        retainDays: cfg.retainDays,
        destinationTimeoutMs: cfg.destinationTimeoutMs,
        jitterSeed: this.#deps.jitterSeed,
        readClock: this.#deps.readClock,
        outcomes: this.#deps.outcomes,
        signal: controller.signal,
        onScheduled: this.#deps.onScheduled,
        onDestinationResult: (result) => {
          // A replaced sweep is aborted before `reload()` waits for it, and its in-flight tick can
          // still report a store under the OLD key during that wait.
          if (!controller.signal.aborted) this.#recordResult(result);
        },
        onUploaded: (id) => {
          if (!controller.signal.aborted) this.#recordUpload(id);
        },
        sleep: this.#deps.sleep ?? realSleep,
        now: this.#deps.now,
        log: this.#deps.log,
      });
      // The worker swallows its own per-tick faults; a settle-by-rejection here is unforeseen.
      this.#worker.catch((err) =>
        this.#deps.log("error", "backup.worker_rejected", { errorCode: codeOf(err) }),
      );
    } finally {
      this.#reloading = false;
    }
  }

  current(): BackupRuntimeStatus {
    const cfg = this.#config;
    const isPrimary = this.#deps.readSingletonRole() === "primary";
    return {
      enabled: cfg !== undefined && isPrimary && this.#db !== undefined,
      isPrimary,
      managedByEnvironment: this.#deps.isManagedByEnvironment(),
      destinations: cfg?.destinations.map((d) => ({ id: d.id, dir: d.dir })) ?? [],
      schedule: cfg?.schedule,
      retention: cfg === undefined ? undefined : { count: cfg.retain, days: cfg.retainDays },
      keyFingerprint: cfg === undefined ? undefined : keyFingerprint(cfg.recoveryKey),
      keyRotatedAt: cfg?.keyRotatedAt,
      recoveryKey: cfg?.recoveryKey,
    };
  }

  /** `current()` plus the async per-destination freshness read and the derived `archiveUnderCurrentKey`. */
  async status(): Promise<
    BackupRuntimeStatus & { backupStatus: SupervisedBackupStatus; archiveUnderCurrentKey: boolean }
  > {
    const base = this.current();
    const cfg = this.#config;
    // Taken with the settings: a reload during the read replaces `#sweep`, not this one.
    const sweep = this.#sweep;
    const archiveUnderCurrentKey = () => [...sweep.values()].some((r) => r.storedUnderCurrentKey);
    if (cfg === undefined || cfg.destinations.length === 0)
      return {
        ...base,
        backupStatus: { configured: false },
        archiveUnderCurrentKey: archiveUnderCurrentKey(),
      };
    const now = this.#now();
    const destinations = await Promise.all(
      cfg.destinations.map(async (dest) => ({
        ...(await this.#readDestination(dest, cfg.staleAfterMs, now)),
        ...(sweep.get(dest.id) ?? NO_RECORD),
      })),
    );
    return {
      ...base,
      backupStatus: { configured: true, destinations },
      archiveUnderCurrentKey: archiveUnderCurrentKey(),
    };
  }

  /** Answers by the read limit; the backend is closed only once its listing has settled. */
  #readDestination(
    dest: ResolvedBackupDestination,
    staleAfterMs: number,
    now: Date,
  ): Promise<DestinationStatus> {
    let backend: StorageBackend;
    try {
      backend = this.#buildBackend(dest);
    } catch (err) {
      return Promise.resolve(unreadDestination(dest.id, codeOf(err)));
    }
    const read = readDestinationStatus(backend, staleAfterMs, now, this.#deps.statusReadTimeoutMs);
    void read.settled.then(() => this.#closeBackends([backend]));
    return read.status;
  }

  /** Counted as stored before its pruning finishes; the pruning code stands until that pruning's
   * result arrives. */
  #recordUpload(id: string): void {
    this.#sweep.set(id, {
      storedUnderCurrentKey: true,
      uploadErrorCode: null,
      pruneErrorCode: this.#sweep.get(id)?.pruneErrorCode ?? null,
    });
  }

  /** A store stays counted for the rest of the sweep; an upload code is cleared only by a later
   * store, and a pruning code only by a later store whose pruning succeeded. */
  #recordResult(result: DestinationResult): void {
    const prev = this.#sweep.get(result.id);
    this.#sweep.set(result.id, {
      storedUnderCurrentKey: (prev?.storedUnderCurrentKey ?? false) || result.stored,
      uploadErrorCode: result.uploadErrorCode,
      pruneErrorCode: result.stored ? result.pruneErrorCode : (prev?.pruneErrorCode ?? null),
    });
  }

  async stop(): Promise<void> {
    // Terminal: set the flag FIRST, so a route-triggered `reload()` still in flight sees it at its
    // next await-checkpoint and bails instead of starting (or leaving) a worker after this teardown.
    this.#stopped = true;
    await this.#teardown();
  }

  /** Abort the sweep, await its settle, and close its database handle — the reload-safe teardown, so
   * a reconfigure never leaks the old connection nor leaves a tick running against a closing one. */
  async #teardown(): Promise<void> {
    this.#controller?.abort();
    if (this.#worker !== undefined) await this.#worker.catch(() => {});
    this.#closeBackends(this.#backends.splice(0));
    if (this.#db !== undefined) await this.#db.close().catch(() => {});
    this.#controller = undefined;
    this.#worker = undefined;
    this.#db = undefined;
  }

  #closeBackends(backends: StorageBackend[]): void {
    for (const backend of backends) {
      try {
        backend.close();
      } catch (err) {
        this.#deps.log("warn", "backup.destination_close_failed", {
          destination: backend.id,
          errorCode: codeOf(err),
        });
      }
    }
  }

  #now(): Date {
    return (this.#deps.now ?? (() => new Date()))();
  }
}
