// The backup duty's lifecycle owner. It sits between boot and the scheduled sweep (`backup-sweep.ts`)
// so the duty can be (re)configured at runtime — enable from off, change destination, rotate the
// recovery key, or follow a promotion — WITHOUT restarting the process. `reload()` is the single
// entry point: it stops the running duty, closes its own database handle, RE-READS the config from
// disk (the box env files, via the injected `buildConfig`), opens the venue again, and — only on a
// singleton primary with a valid config it could open — starts a fresh sweep whose immediate first
// tick takes a copy under the new config.
//
// **It opens its OWN handle on the venue directory rather than reusing boot's.** The archive is
// `VACUUM INTO`, which SQLite refuses on a connection that has a transaction open. Measured on
// Node v26.7.0, `/tmp/f1-restore-probe/vacuum-concurrency.mjs`, re-run 2026-09-21: a SECOND
// connection archiving while the first holds an open `begin immediate` with an uncommitted insert
// SUCCEEDS, and the archive holds the committed row and not the uncommitted one; the control — the
// SAME connection that holds the transaction — answers `cannot VACUUM from within a transaction`,
// errcode 1, and writes no file.
//
// **What that no longer establishes, since `packages/store` gained a read connection per file.**
// It used to say here that on boot's handle every backup firing while a sale was mid-transaction
// would fail, intermittently, so the separate handle was a correctness requirement. That is no
// longer what happens: an archive issued from outside a running transaction body is routed to the
// file's read connection, where `VACUUM INTO` is allowed — measured 2026-09-23 on Node v26.7.0
// both ways round, the copy is written and holds the committed row alone, while the same statement
// on the write connection at that moment is still refused errcode 1
// (`packages/store/src/index.test.ts`, "archives the committed state while another caller's
// transaction is open"). What the separate handle still buys is the reload above: `reload()` closes
// it and opens the venue again under the freshly read config, and boot's handle is the one the
// server answers requests on, so this cannot close that.
//
// `current()` is a SYNC, config-derived snapshot (no I/O) for the routes and the status shell.
// `status()` adds the async freshness read (`readBackupStatus`) and `archiveUnderCurrentKey`, which
// reports whether THIS supervisor's own running sweep — which runs under the current key — has stored
// an archive to at least one destination since the last reload. It is an IN-PROCESS signal, set by the
// sweep's `onStored` callback (which fires ONLY when ≥1 destination stored on a tick), never inferred
// from a stored object's mtime: a restored/copied OLD-key archive can carry a fresh mtime, so mtime
// does not prove the key. `onStored` firing only on a real store also keeps the all-destinations-failed
// tick false (the Task 3 carry: `Promise.allSettled` swallows per-backend faults). The flag resets on
// each reload and on restart, self-healing on the immediate first dump after boot — sound, unlike mtime.

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
  /** Re-reads the box-env files from DISK each reload (B2) — closing over a boot-time value would make
   * hot-reload a no-op. ASYNC because it merges files off disk. */
  buildConfig: () => Promise<BackupConfig | undefined>;
  /** True iff any `WAITRON_BACKUP_*` var is non-empty in the RAW base env (provenance, spec §3.2). */
  isManagedByEnvironment: () => boolean;
  /** The live singleton role, read fresh each reload/status so a promotion is followed. */
  readSingletonRole: () => SingletonRole;
  /** The venue directory holding `venue.db` and `node.db` (`config.venueDir`). The supervisor opens
   * it ITSELF rather than taking boot's handle — see this file's header for what that buys now and
   * for the reason it used to give, which no longer holds. */
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
  /** DI for tests; defaults to `openVenueDatabase`. A test supplies this to count the handles the
   * supervisor opens and closes, or to hand back one whose `archiveTo` fails. */
  openVenue?: (directory: string) => Promise<VenueDatabase>;
  now?: () => Date;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Short hash prefix of a recovery key — an identity for "which key is running" that reveals nothing
 * about the key. `sha256(key)` truncated to 8 hex chars. */
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
   * tearing down anything it opened — rather than start (or leave) a worker after a stop. Without it a
   * shutdown `stop()` that interleaves with a route-triggered `reload()` at an await point could tear
   * down BEFORE `reload()` assigned a fresh worker/handle, leaving a sweep running after `stop()`
   * returned (Task 4 review carry, step 8b). */
  #stopped = false;
  /** True once the running sweep has stored an archive to ≥1 destination since the last reload — the
   * in-process proof that an artifact exists under the CURRENT key. Set by the sweep's `onStored`
   * callback, reset to false at the start of every `reload()`. `archiveUnderCurrentKey` is this flag. */
  #storedUnderCurrentKey = false;

  constructor(deps: BackupSupervisorDeps) {
    this.#deps = deps;
  }

  /**
   * (Re)configure the duty: stop the running sweep, close its database handle, re-read the config
   * from disk, open the venue again, and — only on a singleton primary whose venue opened — start a
   * fresh sweep (whose immediate first tick copies under the new config). Latched: a concurrent
   * reload throws `backup.reload_in_progress` rather than racing two teardowns.
   */
  async reload(): Promise<void> {
    if (this.#reloading) throw new AppError("backup.reload_in_progress", {});
    this.#reloading = true;
    try {
      // A fresh config/key takes effect this reload; the old sweep's stores no longer count, so the
      // in-process "stored under the current key" proof restarts at false and the new sweep re-earns it.
      this.#storedUnderCurrentKey = false;
      await this.#teardown();
      // A `stop()` may have run (fully, or concurrently) while we awaited the teardown. Bail before
      // reading config or starting anything — `#teardown` above already left no worker/handle.
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
        // A venue directory that will not open — missing, unreadable, or holding a file that is not
        // a database — leaves backup OFF without aborting boot: a broken backup duty must never
        // brick the till (§5), and a tick that cannot read the database must never ship a partial
        // archive as recovery-ready.
        //
        // There is no privilege probe here any longer, and the log tag says so. The probe this
        // replaced asked PostgreSQL's catalogue whether the connecting role could read the fiscal
        // tables; SQLite has no roles and no catalogue to ask, so that question has no subject.
        // What survives is the open, and `backup.disabled_open_failed` names exactly that.
        db = await openVenue(this.#deps.venueDir);
      } catch (err) {
        if (db !== undefined) await db.close().catch(() => {});
        this.#deps.log("error", "backup.disabled_open_failed", { errorCode: codeOf(err) });
        this.#config = undefined;
        return;
      }
      // A `stop()` landed while we opened the venue. Close what we just opened and bail WITHOUT
      // assigning `#db` or starting a worker — otherwise the sweep we are about to start would
      // outlive the `stop()` that already returned.
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
        // The copy runs on THIS handle — the one this supervisor opened — never on boot's.
        archive: (outFile) => venue.venue.archiveTo(outFile),
        recoveryKey: cfg.recoveryKey,
        schedule: cfg.schedule,
        retain: cfg.retain,
        retainDays: cfg.retainDays,
        jitterSeed: this.#deps.jitterSeed,
        readClock: this.#deps.readClock,
        outcomes: this.#deps.outcomes,
        signal: controller.signal,
        // Fired when a tick stored to ≥1 destination — the in-process proof an artifact exists under
        // the current key. A stale callback from a torn-down sweep cannot lie: reload() reset the flag
        // and this closure is bound to the sweep this reload started.
        onStored: () => {
          this.#storedUnderCurrentKey = true;
        },
        sleep: this.#deps.sleep ?? realSleep,
        now: this.#deps.now,
        log: this.#deps.log,
      });
      // The worker swallows its own per-tick faults; a settle-by-rejection here is unforeseen, logged
      // the same `codeOf`-classified way boot logs the other singleton workers.
      this.#worker.catch((err) =>
        this.#deps.log("error", "backup.worker_rejected", { errorCode: codeOf(err) }),
      );
    } finally {
      this.#reloading = false;
    }
  }

  /** SYNC config-derived snapshot — no I/O. */
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
    // Truthful: an archive exists under the CURRENT key iff THIS supervisor's running sweep stored one
    // since the last reload. Read from the in-process flag, never a stored object's mtime — a copied
    // old-key archive can carry a fresh mtime, and the flag only rises on a real ≥1-destination store.
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
