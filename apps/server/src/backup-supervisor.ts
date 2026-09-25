// The backup duty's lifecycle owner, so the duty can be reconfigured at runtime WITHOUT restarting
// the process. `reload()` stops the running duty, closes its own database handle, re-reads the config
// from disk, opens the venue again, and — only on a singleton primary with a valid config it could
// open — starts a fresh sweep whose immediate first tick takes a copy under the new config.
//
// It opens its OWN handle on the venue directory rather than reusing boot's, because `reload()` closes
// it, and boot's handle is the one the server answers requests on.
//
// `archiveUnderCurrentKey` is an IN-PROCESS signal, set by the sweep's `onStored` callback (which fires
// only when ≥1 destination stored on a tick), never inferred from a stored object's mtime: a
// restored/copied OLD-key archive can carry a fresh mtime, so mtime does not prove the key.

import { createHash } from "node:crypto";
import { join } from "node:path";
import { openVenueDatabase, type SingletonRole, type VenueDatabase } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import type { BackupConfig, BackupSchedule } from "./backup-config.js";
import type { ScheduleClock } from "./backup-schedule.js";
import { readBackupStatus, type BackupStatus } from "./backup-status.js";
import { runBackupSweep } from "./backup-sweep.js";
import type { BackupOutcomeHolder } from "./alert-sources.js";
import type { DeploymentEnvironment } from "./config.js";
import { buildBackend } from "./local-fs-backend.js";
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
  now?: () => Date;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export class BackupSupervisor {
  readonly #deps: BackupSupervisorDeps;
  #controller: AbortController | undefined;
  #worker: Promise<void> | undefined;
  #db: VenueDatabase | undefined;
  #config: BackupConfig | undefined;
  #reloading = false;
  /** Set once by `stop()` (shutdown is terminal). `reload()` checks it after every `await` and bails —
   * tearing down anything it opened — rather than start (or leave) a worker after a stop. */
  #stopped = false;
  /** True once the running sweep has stored an archive to ≥1 destination since the last reload — the
   * in-process proof that an artifact exists under the CURRENT key. Set by the sweep's `onStored`
   * callback, reset to false at the start of every `reload()`. `archiveUnderCurrentKey` is this flag. */
  #storedUnderCurrentKey = false;

  constructor(deps: BackupSupervisorDeps) {
    this.#deps = deps;
  }

  /** Latched: a concurrent reload throws `backup.reload_in_progress` rather than racing two
   * teardowns. */
  async reload(): Promise<void> {
    if (this.#reloading) throw new AppError("backup.reload_in_progress", {});
    this.#reloading = true;
    try {
      this.#storedUnderCurrentKey = false;
      await this.#teardown();
      // A `stop()` may have run while we awaited the teardown, which already left no worker/handle.
      if (this.#stopped) return;
      const cfg = await this.#deps.buildConfig();
      if (this.#stopped) return; // a stop() landed during buildConfig — don't adopt this config
      this.#config = cfg;
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
      this.#worker = runBackupSweep({
        backends: cfg.destinations.map(buildBackend),
        db: venue.venue,
        modules: this.#deps.modules,
        environment: this.#deps.environment,
        resolvers: {},
        stateDir: this.#deps.stateDir,
        stagingDir: join(this.#deps.stateDir, "backup-staging"),
        archive: (outFile) => venue.venue.archiveTo(outFile),
        recoveryKey: cfg.recoveryKey,
        schedule: cfg.schedule,
        retain: cfg.retain,
        retainDays: cfg.retainDays,
        jitterSeed: this.#deps.jitterSeed,
        readClock: this.#deps.readClock,
        outcomes: this.#deps.outcomes,
        signal: controller.signal,
        onStored: () => {
          this.#storedUnderCurrentKey = true;
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
    BackupRuntimeStatus & { backupStatus: BackupStatus; archiveUnderCurrentKey: boolean }
  > {
    const base = this.current();
    const cfg = this.#config;
    const now = this.#now();
    const backends = cfg?.destinations.map(buildBackend) ?? [];
    const backupStatus = await readBackupStatus(backends, cfg?.staleAfterMs ?? 0, now);
    return { ...base, backupStatus, archiveUnderCurrentKey: this.#storedUnderCurrentKey };
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
    if (this.#db !== undefined) await this.#db.close().catch(() => {});
    this.#controller = undefined;
    this.#worker = undefined;
    this.#db = undefined;
  }

  #now(): Date {
    return (this.#deps.now ?? (() => new Date()))();
  }
}
