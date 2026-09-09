// The backup duty's lifecycle owner. It sits between boot and the scheduled sweep (`backup-sweep.ts`)
// so the duty can be (re)configured at runtime — enable from off, change destination, rotate the
// recovery key, or follow a promotion — WITHOUT restarting the process. `reload()` is the single
// entry point: it stops the running duty, closes its DB pool, RE-READS the config from disk (the box
// env files, via the injected `buildConfig`), derives the read connection, probes it, and — only on a
// singleton primary with a valid config that passes the probe — starts a fresh sweep whose immediate
// first tick takes a dump under the new config.
//
// `current()` is a SYNC, config-derived snapshot (no I/O) for the routes and the status shell.
// `status()` adds the async freshness read (`readBackupStatus`) and a DERIVED `archiveUnderCurrentKey`
// — true iff a destination actually STORED an artifact at/after the last reload (when the current key
// took effect). It is derived from real stored state, never flagged off a "a tick ran" hook, so it
// cannot lie on a tick where every destination failed (the Task 3 carry: `Promise.allSettled` swallows
// per-backend faults, so a post-fan-out flag would claim an archive exists when nothing was stored).

import { createHash } from "node:crypto";
import { join } from "node:path";
import { createPostgresDb, type Database, type SingletonRole } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import { assertBackupCanReadFiscal } from "./backup-probe.js";
import type { BackupConfig, BackupSchedule } from "./backup-config.js";
import type { ScheduleClock } from "./backup-schedule.js";
import { readBackupStatus, type BackupStatus } from "./backup-status.js";
import { runBackupSweep } from "./backup-sweep.js";
import type { DeploymentEnvironment } from "./config.js";
import { buildBackend } from "./local-fs-backend.js";
import { realSleep } from "./loop.js";
import type { Logger } from "./logger.js";
import { realPgDump, type PgDumpRunner } from "./pg-dump.js";
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
  /** The fallback backup read connection: the box's own OWNER connection, used when the config names
   * no explicit `WAITRON_BACKUP_DATABASE_URL`. */
  adminDatabaseUrl: string;
  modules: readonly WaitronModule[];
  environment: DeploymentEnvironment;
  stateDir: string;
  mediaDir: string;
  jitterSeed: string;
  /** The venue's tenant-scoped wall clock (tz + business-day cutover). */
  readClock: () => Promise<ScheduleClock>;
  log: Logger;
  /** DI for tests; defaults to `createPostgresDb`. */
  openDb?: (url: string) => Promise<Database>;
  now?: () => Date;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  runDump?: PgDumpRunner;
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
  #db: Database | undefined;
  #config: BackupConfig | undefined;
  #reloading = false;
  /** Set once by `stop()` (shutdown is terminal). `reload()` checks it after every `await` and bails —
   * tearing down anything it opened — rather than start (or leave) a worker after a stop. Without it a
   * shutdown `stop()` that interleaves with a route-triggered `reload()` at an await point could tear
   * down BEFORE `reload()` assigned a fresh worker/pool, leaving a sweep running after `stop()`
   * returned (Task 4 review carry, step 8b). */
  #stopped = false;
  /** When the running duty last (re)started. `archiveUnderCurrentKey` reads TRUE only for an artifact
   * stored at/after this instant — i.e. under the config/key this reload put in force. */
  #reloadedAt: Date | undefined;

  constructor(deps: BackupSupervisorDeps) {
    this.#deps = deps;
  }

  /**
   * (Re)configure the duty: stop the running sweep, close its pool, re-read the config from disk,
   * derive + probe the read connection, and — only on a singleton primary with a config that passes
   * the probe — start a fresh sweep (whose immediate first tick dumps under the new config). Latched:
   * a concurrent reload throws `backup.reload_in_progress` rather than racing two teardowns.
   */
  async reload(): Promise<void> {
    if (this.#reloading) throw new AppError("backup.reload_in_progress", {});
    this.#reloading = true;
    try {
      await this.#teardown();
      // A `stop()` may have run (fully, or concurrently) while we awaited the teardown. Bail before
      // reading config or starting anything — `#teardown` above already left no worker/pool.
      if (this.#stopped) return;
      const cfg = await this.#deps.buildConfig();
      if (this.#stopped) return; // a stop() landed during buildConfig — don't adopt this config
      this.#config = cfg;
      this.#reloadedAt = this.#now();
      if (cfg === undefined || this.#deps.readSingletonRole() !== "primary") {
        // #config is kept so `current()` can report the destinations/schedule; enabled stays false
        // because `#db` is undefined (no probe passed) — a non-primary reads disabled.
        this.#deps.log("info", "backup.disabled", {});
        return;
      }
      // No explicit backup URL → derive the read connection from the box's own OWNER connection.
      const url = cfg.databaseUrl ?? this.#deps.adminDatabaseUrl;
      const openDb = this.#deps.openDb ?? createPostgresDb;
      let db: Database | undefined;
      try {
        // Opening the pool AND the probe are both inside the guard: a refused/unreachable connection
        // (openDb throws, `db` still undefined) is as much a "backup can't read" case as a probe that
        // rejects (db open). Either leaves backup OFF without aborting boot — a bad backup role must
        // never brick the till (§5) — and never ships a partial dump as recovery-ready.
        db = await openDb(url);
        await assertBackupCanReadFiscal(db);
      } catch (err) {
        if (db !== undefined) await db.close().catch(() => {});
        this.#deps.log("error", "backup.disabled_probe_failed", { errorCode: codeOf(err) });
        this.#config = undefined;
        return;
      }
      // A `stop()` landed while we opened the pool / ran the probe. Close the pool we just opened and
      // bail WITHOUT assigning `#db` or starting a worker — otherwise the sweep we are about to start
      // would outlive the `stop()` that already returned.
      if (this.#stopped) {
        await db?.close().catch(() => {});
        return;
      }
      this.#db = db;
      const controller = new AbortController();
      this.#controller = controller;
      this.#worker = runBackupSweep({
        backends: cfg.destinations.map(buildBackend),
        db,
        modules: this.#deps.modules,
        environment: this.#deps.environment,
        resolvers: { media: this.#deps.mediaDir },
        stateDir: this.#deps.stateDir,
        stagingDir: join(this.#deps.stateDir, "backup-staging"),
        databaseUrl: url,
        recoveryKey: cfg.recoveryKey,
        schedule: cfg.schedule,
        retain: cfg.retain,
        retainDays: cfg.retainDays,
        jitterSeed: this.#deps.jitterSeed,
        readClock: this.#deps.readClock,
        signal: controller.signal,
        sleep: this.#deps.sleep ?? realSleep,
        runDump: this.#deps.runDump ?? realPgDump,
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
    // Truthful: an archive exists under the CURRENT key iff a destination stored one at/after the last
    // reload (when the current key/config took effect). Derived from real stored state, so it is never
    // true on an all-destinations-failed tick.
    const since = this.#reloadedAt?.getTime() ?? Infinity;
    const archiveUnderCurrentKey =
      backupStatus.configured &&
      backupStatus.destinations.some(
        (d) => d.lastBackupAt !== null && Date.parse(d.lastBackupAt) >= since,
      );
    return { ...base, backupStatus, archiveUnderCurrentKey };
  }

  async stop(): Promise<void> {
    // Terminal: set the flag FIRST, so a route-triggered `reload()` still in flight sees it at its
    // next await-checkpoint and bails instead of starting (or leaving) a worker after this teardown.
    this.#stopped = true;
    await this.#teardown();
  }

  /** Abort the sweep, await its settle, and close its pool — the reload-safe teardown, so a reconfigure
   * never leaks the old pool nor leaves a tick running against a closing connection. */
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
