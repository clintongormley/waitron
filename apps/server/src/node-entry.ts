import {
  httpPortFrom,
  landingConfigFrom,
  needsConnectionBootstrap,
  serveRecovery,
  type RecoveryServeOptions,
} from "./recovery-listener.js";
export { serveRecovery, recoveryTlsFiles } from "./recovery-listener.js";
export type { RecoveryServeOptions } from "./recovery-listener.js";
export { startServerOrFirstSetupResolution } from "./first-setup-launch.js";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { AppError, isAppError, MAX_CAUSE_DEPTH } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import {
  isVenueHolderFresh,
  lockVenueDatabase,
  openVenueDatabase,
  readVenueHolder,
  resolveLogDir,
  setVenueHolderIdentity,
  type VenueHolder,
  type VenueLock,
} from "@waitron/db";
import { manifestSets } from "@waitron/migrations";
import { assertNotAhead as assertDatabaseNotAhead } from "@waitron/provisioning";
import { DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT, startServer } from "./boot.js";
import { loadBoxEnv } from "./box-env.js";
import { DEFAULT_HTTP_HOST, resolveConfigDir } from "./config.js";
import { isUnset } from "./env-value.js";
import { createLogger, type Logger } from "./logger.js";
import { createRotatingFileSink } from "./log-file.js";
import { withRecoveryLock } from "./recovery-lock.js";
import {
  afterFailure,
  cleared,
  fullDiskAtStart,
  readRecoveryState,
  stayedUpClear,
  updateRecoveryState,
  withFailureCode,
  withoutAttempt,
  writeRecoveryState,
  type RecoveryState,
} from "./recovery-state.js";
import { BOOT_INCOMPLETE, HOLDER_STALLED, recoveryApp } from "./recovery-surface.js";
import { installShutdownHandlers } from "./run-server.js";
import { runStagedRestore, type StagedRestoreDeps } from "./restore-request.js";
import { runStagedReset, type StagedResetDeps } from "./reset-request.js";
import { clearReplacedDatabases } from "./restore.js";
import { loadCloudOrigin } from "./cloud-client.js";
import { createCloudRecoveryClient } from "./cloud-recovery.js";
import { fullDiskFailure, startFailureCode } from "./boot-failure.js";
import { errnoOf } from "./errno.js";
import type { Statfs } from "./free-bytes.js";
import { START_FREE_SPACE_FLOOR, freeSpaceAtStart, lowestFreeBytes } from "./start-space.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { redactSecrets } from "./redact-secrets.js";
import "./errors.js";

/** How long a boot must survive before its failure counter is cleared (spec §9.2). */
const STAYED_UP_MS = 120_000;

export interface EntryDeps {
  /** The arguments the process was started with, after the script's own path. */
  args: readonly string[];
  /** The process environment, before the box's own env files are merged under it. */
  baseEnv: NodeJS.ProcessEnv;
  stateDir: string;
  /** Resolved by the caller, because the entrypoint never runs `loadConfig`: a box reaches recovery
   *  precisely when its configuration is what is broken. */
  venueDir: string;
  runStagedRestore?: (deps: StagedRestoreDeps) => Promise<boolean>;
  runStagedReset?: (deps: StagedResetDeps) => Promise<boolean>;
  /** Defaults to the real `assertNotAhead` below, never a no-op: it is a guard, and a no-op default
   *  is lost silently by any caller that forgets the dependency. */
  assertNotAhead?: (venueDir: string, migrationsRoot: string) => Promise<void>;
  /** Defaults to the real `clearReplacedDatabases` (restore.ts), never a no-op, for the same reason. */
  clearReplacedDatabases?: (venueDir: string, log: Logger) => Promise<void>;
  /** Defaults to the real `lockVenueDatabase`, never a no-op: the clearing is safe only while the
   *  folder is held. */
  lockVenue?: (venueDir: string) => Promise<VenueLock>;
  /**
   * The installer's channel — the container's stdout (`docker logs`). Its no-op default, unlike
   * `assertNotAhead`'s, is safe because it is diagnostic output, not a guard: omitting it changes
   * no outcome.
   */
  reportFailure?: (text: string) => void;
  loadBoxEnv: (base: NodeJS.ProcessEnv, stateDir: string) => Promise<NodeJS.ProcessEnv>;
  readRecoveryState: (stateDir: string) => Promise<RecoveryState>;
  writeRecoveryState: (stateDir: string, state: RecoveryState) => Promise<void>;
  /** Held around every change to `recovery.json`; defaults to the real cross-process lock. */
  withRecoveryLock?: <T>(stateDir: string, body: () => Promise<T>) => Promise<T>;
  /** Reads the holder file beside `venue.lock`; defaults to the real reader. */
  readVenueHolder?: (venueDir: string) => VenueHolder | null;
  now?: () => Date;
  startServer: (
    env: NodeJS.ProcessEnv,
    base?: NodeJS.ProcessEnv,
  ) => Promise<{ close(): Promise<void> }>;
  serveRecovery: (app: Hono, opts: RecoveryServeOptions) => Promise<unknown>;
  installShutdownHandlers: (server: { close(): Promise<void> }) => void;
  /** Runs `onStayedUp` once the process has survived `ms` — see the counter rule in `runEntry`. */
  scheduleStayedUp: (ms: number, onStayedUp: () => void) => void;
  log: Logger;
  /** Where the recovery page reads its log tail from, and where each start records itself. */
  logDir?: string;
  /**
   * Where the migration sets live. Never `null`: null means "resolve from the bundle's own
   * directory", which fails a real container's first boot with `migrations.set_missing`. `runEntry`
   * hands this one value to both the staged restore and the ahead check.
   */
  migrationsRoot?: string;
  exit?: (code: number) => void;
  /** Below this many free bytes the start deletes what it can make again; defaults to
   *  `START_FREE_SPACE_FLOOR`. */
  freeSpaceFloor?: number;
  /** Reads a folder's filesystem; defaults to the real `statfs`. */
  statfs?: Statfs;
}

/* v8 ignore start -- the real process binding; every test supplies its own `exit` instead */
const DEFAULT_EXIT = (code: number): void => process.exit(code);
/* v8 ignore stop */

/**
 * One change to `recovery.json`, read and written under the recovery lock, so no change is computed
 * from a count read before another process wrote.
 */
function changeState(
  deps: EntryDeps,
  change: (current: RecoveryState) => RecoveryState,
): Promise<{ before: RecoveryState; after: RecoveryState }> {
  return updateRecoveryState(
    {
      lock: deps.withRecoveryLock ?? withRecoveryLock,
      read: deps.readRecoveryState,
      write: deps.writeRecoveryState,
    },
    deps.stateDir,
    change,
  );
}

/**
 * Persist the escalation state, logging a write failure rather than letting it become the outcome:
 * on the failure path the boot's own error is what matters, and in the stayed-up callback a
 * floating rejection would kill a healthy server. The pre-boot counter, and the write-back before
 * it, are the writes not routed through here, and are allowed to throw: a box whose count cannot be
 * written can never escalate. A full disk found below the free-space floor serves the page instead
 * (`countWritable`).
 */
async function persistState(
  deps: EntryDeps,
  change: (current: RecoveryState) => RecoveryState,
): Promise<void> {
  try {
    await changeState(deps, change);
  } catch (error) {
    deps.log("warn", "recovery.state_write_failed", {
      errorCode: codeOf(error),
      errno: errnoOf(error) ?? null,
    });
  }
}

/** An `AppError`'s params as one line, or a placeholder when they will not serialise. */
function paramsLine(params: unknown): string {
  try {
    return `params: ${JSON.stringify(params)}`;
  } catch {
    return "params: (not serialisable)";
  }
}

/**
 * What a failed boot reports, to the installer's channel and to the log file the recovery page
 * reads: the outer error's name, message and stack, then each wrapped `cause` by name and message
 * down to `MAX_CAUSE_DEPTH` levels in all, and an `AppError`'s params at whichever of those levels
 * carries them, all through `redactSecrets`.
 */
function failureDetail(error: unknown): string {
  const lines: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    const prefix = depth === 0 ? "" : "caused by: ";
    if (current instanceof Error) {
      lines.push(`${prefix}${current.name}: ${current.message}`);
      if (depth === 0) lines.push(current.stack ?? "(no stack)");
      if (isAppError(current)) lines.push(paramsLine(current.params));
    } else {
      lines.push(`${prefix}non-error thrown: ${String(current)}`);
    }
    if (typeof current !== "object" || current === null) break;
    const cause: unknown = (current as { cause?: unknown }).cause;
    if (cause === undefined || cause === current) break;
    current = cause;
  }
  return redactSecrets(lines.join("\n"));
}

/**
 * A logger onto the recovery page's log file, for the lines written before the server's own logger
 * exists or after it has gone. It appends and never rotates: this start may be a second copy refused
 * beside a running server, whose sink rotates the same file by a size it keeps in memory. A failed
 * write is reported once on `log` and never thrown, because this runs on the failure path, whose
 * outcome it must not change.
 */
function pageLog(logDir: string, now: () => Date, log: Logger): Logger {
  return createLogger(
    createRotatingFileSink({ dir: logDir, maxBytes: Number.POSITIVE_INFINITY, maxFiles: 1 }, () =>
      log("warn", "log.file_unavailable"),
    ),
    now,
  );
}

/** What the installer's channel gets for a start given arguments. The first argument is printed
 *  because it normally names the command, though it too can carry a secret `redactSecrets` does not
 *  mask; the later ones are not printed. */
function argumentsRefused(args: readonly string[]): string {
  const more = args.length - 1;
  const rest = more === 0 ? "" : ` and ${more} more argument${more === 1 ? "" : "s"}, not shown`;
  return redactSecrets(
    [
      `server.entry_arguments_refused: this program takes no arguments, and was given: ${args[0]}${rest}`,
      "To run an operator command, override the entrypoint:",
      "  docker compose run --rm --entrypoint node app /app/<command>.js <arguments>",
    ].join("\n"),
  );
}

/**
 * Refuse a venue database carrying migrations this image does not ship.
 *
 * Judging a database nothing has migrated yet is safe because the comparison runs in one direction
 * only: `unknownHashes` (`packages/provisioning/src/schema-ahead.ts`) reports hashes the database
 * carries and the image has no file for, so an ordinary upgrade is not refused. A set whose journal
 * table does not exist is skipped, so a virgin venue directory passes.
 *
 * Closed in a `finally` because `startServer` opens the same directory for the life of the process.
 */
export async function assertNotAhead(venueDir: string, migrationsRoot: string): Promise<void> {
  const store = await openVenueDatabase(venueDir);
  try {
    await assertDatabaseNotAhead(store.venue, manifestSets(), migrationsRoot);
  } finally {
    await store.close();
  }
}

/**
 * One container start: decide the level, bring the venue directory into shape, hand the server its
 * environment, and start it — or serve the recovery page instead.
 *
 * These orderings keep recovery from changing a database it cannot admit:
 *
 * 1. First-setup resolution precedes recovery-level handling and staged work. Its inspection is
 *    read-only; the recovery level still precedes ordinary database opens.
 * 2. The failure counter is written before ordinary boot's first step, never only in a failure handler:
 *    a boot that hangs never throws, and would restart-loop without ever reaching the page.
 * 3. It clears only from the stayed-up callback — `startServer` resolved and the process then
 *    survived `STAYED_UP_MS`. Clearing on "started" alone would let a module throwing seconds in
 *    reset the counter on every attempt.
 * 4. The ahead check runs after `runStagedRestore` and `runStagedReset`, which replace or remove
 *    the venue files, and before `startServer`, which migrates and then queries the schema. It
 *    judges a database nothing has migrated yet, which the one-directional comparison in
 *    `assertNotAhead` makes safe.
 * 5. After the staged restore, the start holds the venue folder from clearing set-aside folders
 *    until `startServer` settles or an earlier step throws, so another process's placement cannot
 *    run in between: one that failed with the old database set aside would leave no `venue.db`,
 *    this start's opens would create an empty one, and the next start would delete the folder
 *    holding the only copy. The clearing runs before the ahead check because that check's open
 *    creates a missing `venue.db`.
 * 6. Below the floor, the start deletes what it can make again before first-setup resolution, whose
 *    inspection opens the database.
 * 7. Still below it, or below it in the folders first-setup resolution chose instead, the start
 *    writes the count back unchanged before resolution's app or the page is served: a finished
 *    setup's inspection fails on a full disk and would serve resolution (plan F4), and its
 *    admission takes the venue lock before the count.
 *
 * `startServer` resolving is the signal rather than a healthy `/health`, because `/health` is 503
 * on a setup box by design, so a health-gated reset would drive every unprovisioned box into
 * recovery.
 */
export async function runEntry(deps: EntryDeps): Promise<void> {
  // `docker compose run app <command>` appends `<command>` here. Booting instead would start a
  // second server, and with the app stopped for a restore nothing holds the venue folder to refuse
  // it. Checked before the level is read, so a box at the recovery level refuses too, and before
  // the counter is written, so a mistyped command is not a failed start.
  if (deps.args.length > 0) {
    (deps.reportFailure ?? (() => {}))(argumentsRefused(deps.args));
    throw new AppError("server.entry_arguments_refused", {});
  }

  const now = deps.now ?? (() => new Date());
  const floor = deps.freeSpaceFloor ?? START_FREE_SPACE_FLOOR;
  const space = await freeSpaceAtStart({
    stateDir: deps.stateDir,
    venueDir: deps.venueDir,
    logDir: deps.logDir ?? join(deps.stateDir, "logs"),
    floor,
    now,
    statfs: deps.statfs,
    lockVenue: deps.lockVenue ?? lockVenueDatabase,
    readVenueHolder: deps.readVenueHolder ?? readVenueHolder,
    log: deps.log,
  });

  const admission = await resolveFirstSetupEntry(
    deps,
    deps.baseEnv,
    () => (deps.exit ?? DEFAULT_EXIT)(0),
    deps.log,
  );
  const transportEnv = await loadBoxEnv(deps.baseEnv, admission.roots.stateDir);
  const transportPort = httpPortFrom(transportEnv);
  const transport: RecoveryServeOptions = {
    stateDir: admission.roots.stateDir,
    port: transportPort,
    log: deps.log,
    httpHost: isUnset(transportEnv.WAITRON_HTTP_HOST)
      ? DEFAULT_HTTP_HOST
      : transportEnv.WAITRON_HTTP_HOST,
    landing: landingConfigFrom(transportEnv, admission.roots.stateDir, transportPort),
    onRepaired: async () => {
      (deps.exit ?? DEFAULT_EXIT)(0);
    },
    operatorTls:
      !isUnset(transportEnv.WAITRON_TLS_CERT_FILE) || !isUnset(transportEnv.WAITRON_TLS_KEY_FILE),
  };
  if (await needsConnectionBootstrap(transport, transportEnv)) {
    await deps.serveRecovery(new Hono(), { ...transport, bootstrapOnly: true });
    return;
  }

  const rooted: EntryDeps = {
    ...deps,
    stateDir: admission.roots.stateDir,
    venueDir: admission.roots.venueDir,
    baseEnv: {
      ...deps.baseEnv,
      WAITRON_STATE_DIR: admission.roots.stateDir,
      WAITRON_VENUE_DIR: admission.roots.venueDir,
    },
  };
  const dirs = [rooted.stateDir, rooted.venueDir];
  const moved = rooted.stateDir !== deps.stateDir || rooted.venueDir !== deps.venueDir;
  const belowFloor =
    space.belowFloor || (moved && ((await lowestFreeBytes(dirs, deps.statfs)) ?? floor) < floor);
  let check: CountCheck;
  if (belowFloor && !(check = await countWritable(rooted)).written) {
    const exit = deps.exit ?? DEFAULT_EXIT;
    await deps.serveRecovery(
      recoveryApp({
        state: fullDiskAtStart(await deps.readRecoveryState(rooted.stateDir), now()),
        uncounted: true,
        logDir: deps.logDir ?? join(rooted.stateDir, "logs"),
        onRetry: async () => {
          await persistState(rooted, cleared);
          exit(0);
        },
        freeSpace: () => lowestFreeBytes(dirs, deps.statfs),
        log: deps.log,
      }),
      transport,
    );
    deps.log("warn", "recovery.serving_disk_full", { freeBytes: check.freeBytes });
    return;
  }

  if (admission.kind === "resolution") {
    const port = httpPortFrom(deps.baseEnv);
    await deps.serveRecovery(admission.app, {
      stateDir: admission.roots.stateDir,
      port,
      httpHost: isUnset(deps.baseEnv.WAITRON_HTTP_HOST)
        ? DEFAULT_HTTP_HOST
        : deps.baseEnv.WAITRON_HTTP_HOST,
      log: deps.log,
      landing: landingConfigFrom(deps.baseEnv, admission.roots.stateDir, port),
      onRepaired: transport.onRepaired,
      operatorTls: transport.operatorTls,
    });
    return;
  }

  const selected = admission.roots.binding === null ? deps : rooted;
  return admission.run((venueHeld) => runAdmittedEntry(selected, transport, venueHeld));
}

type CountCheck = { written: true } | { written: false; freeBytes: number | null };

/**
 * Writes `recovery.json` back unchanged through the count's own path. Only a failure a full disk
 * explains, judged on free space read after it, is answered; any other is thrown.
 */
async function countWritable(deps: EntryDeps): Promise<CountCheck> {
  try {
    await changeState(deps, (current) => current);
    return { written: true };
  } catch (error) {
    deps.log("warn", "recovery.state_write_failed", {
      errorCode: codeOf(error),
      errno: errnoOf(error) ?? null,
    });
    const freeBytes = await lowestFreeBytes([deps.stateDir, deps.venueDir], deps.statfs);
    if (fullDiskFailure(error, freeBytes)) return { written: false, freeBytes };
    throw error;
  }
}

const recordedCodes = new WeakMap<object, string>();

/**
 * The code a failed attempt classified its failure as, or undefined for a failure outside one.
 * Reading free space again is no substitute: the deletion after a full disk can leave room, which
 * would name the same failure something other than a full disk.
 */
export function recordedStartFailureCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? recordedCodes.get(error) : undefined;
}

/** `venueHeld`: the caller holds `deps.venueDir`'s lock for the whole call. */
async function runAdmittedEntry(
  deps: EntryDeps,
  transport: RecoveryServeOptions,
  venueHeld: boolean,
): Promise<void> {
  // Outside the recovery lock: it decides only whether this start boots or serves the page. Every change
  // below re-reads under the lock, so a write made since is kept rather than overwritten.
  const state = await deps.readRecoveryState(deps.stateDir);
  const logDir = deps.logDir ?? join(deps.stateDir, "logs");
  const exit = deps.exit ?? DEFAULT_EXIT;
  const now = deps.now ?? (() => new Date());

  if (state.level === "recovery") {
    deps.log("warn", "recovery.serving", {
      failures: state.failures,
      lastErrorCode: state.lastErrorCode,
    });
    const httpPort = httpPortFrom(deps.baseEnv);
    await deps.serveRecovery(
      recoveryApp({
        state,
        logDir,
        // The exit is the whole retry: Docker's restart policy performs the restart.
        onRetry: async () => {
          await persistState(deps, cleared);
          exit(0);
        },
        freeSpace: () => lowestFreeBytes([deps.stateDir, deps.venueDir], deps.statfs),
        log: deps.log,
      }),
      {
        stateDir: deps.stateDir,
        port: httpPort,
        log: deps.log,
        landing: landingConfigFrom(deps.baseEnv, deps.stateDir, httpPort),
        onRepaired: async () => {
          exit(0);
        },
        operatorTls: transport.operatorTls,
      },
    );
    return;
  }

  // Written before the first step that can fail, so a boot that hangs is counted. Accepted
  // consequence: an attempt cut short counts too — three power-cycles during a long cold restore
  // land a box on the page, where the retry button clears it.
  const attempt = await changeState(deps, (current) =>
    afterFailure(current, BOOT_INCOMPLETE, now()),
  );
  const page = pageLog(logDir, now, deps.log);
  // Marks where this attempt's lines begin, so the page never presents an earlier run's as its own.
  page("info", "server.boot_started");

  let server: { close(): Promise<void> };
  try {
    const migrationsRoot = deps.migrationsRoot ?? DEFAULT_MIGRATIONS_ROOT;

    const recoveryOrigin = loadCloudOrigin(deps.baseEnv);
    await (deps.runStagedRestore ?? runStagedRestore)({
      stateDir: deps.stateDir,
      venueDir: deps.venueDir,
      migrationsRoot,
      log: deps.log,
      recoverySecret: deps.baseEnv.WAITRON_NODE_RECOVERY_KEY,
      recoveryOperationPath: deps.baseEnv.WAITRON_RECOVERY_OPERATION_FILE,
      onManagedCloudRestored: async (binding) => {
        if (recoveryOrigin)
          await createCloudRecoveryClient({
            stateDir: deps.stateDir,
            origin: recoveryOrigin,
            environment: "preproduction",
          }).markRestored(binding);
      },
    });
    await (deps.runStagedReset ?? runStagedReset)({
      stateDir: deps.stateDir,
      venueDir: deps.venueDir,
      log: deps.log,
    });

    // Ordering 5 in the doc comment above.
    const hold = await (deps.lockVenue ?? lockVenueDatabase)(deps.venueDir);
    try {
      await (deps.clearReplacedDatabases ?? clearReplacedDatabases)(deps.venueDir, deps.log);

      // Unchecked, an ahead database would surface as an unclassified driver error in whatever
      // query first touched the changed schema.
      await (deps.assertNotAhead ?? assertNotAhead)(deps.venueDir, migrationsRoot);

      const env = await deps.loadBoxEnv(deps.baseEnv, deps.stateDir);
      // The raw base env goes alongside the merged `env`: boot re-reads the box-env files on every
      // backup reload and needs the unmerged base to tell a file-sourced value from an env-sourced
      // one.
      server = await deps.startServer(env, deps.baseEnv);
    } finally {
      hold.release();
    }
    if (recoveryOrigin) {
      void createCloudRecoveryClient({
        stateDir: deps.stateDir,
        origin: recoveryOrigin,
        environment: "preproduction",
      })
        .reportRestored()
        .catch(() => {});
    }
  } catch (error) {
    // Both channels first, so the real reason survives even if the state write fails.
    const detail = failureDetail(error);
    (deps.reportFailure ?? (() => {}))(detail);
    const code = await startFailureCode(error, [deps.stateDir, deps.venueDir], deps.statfs);
    page("error", "server.boot_failed", { errorCode: code, detail });
    if (code === "storage.disk_full") {
      await freeSpaceAtStart({
        stateDir: deps.stateDir,
        venueDir: deps.venueDir,
        logDir,
        floor: deps.freeSpaceFloor ?? START_FREE_SPACE_FLOOR,
        force: true,
        venueHeld,
        now,
        statfs: deps.statfs,
        lockVenue: deps.lockVenue ?? lockVenueDatabase,
        readVenueHolder: deps.readVenueHolder ?? readVenueHolder,
        log: deps.log,
      });
    }
    if (typeof error === "object" && error !== null) recordedCodes.set(error, code);
    const at = now();
    if (code === "provisioning.database_in_use") {
      await recordRefusal(deps, attempt, at);
    } else {
      // The pre-boot count stands — one attempt is one failure, not two — now with the code.
      await persistState(deps, (current) => withFailureCode(current, code, at));
    }
    throw error;
  }

  deps.installShutdownHandlers(server);
  deps.scheduleStayedUp(STAYED_UP_MS, () => void persistState(deps, stayedUpClear));
}

/**
 * Another process holds the venue folder. Its holder file (written by `@waitron/store` beside
 * `venue.lock`) says whether it is alive. A fresh heartbeat is a live holder, usually the running
 * server with this start a second copy beside it: this start's count comes back off. A stale,
 * missing or unreadable file counts, so a folder held by something stuck reaches the page. Missing
 * counts because the holder writes its file in the step that takes the lock and removes it just
 * before letting the lock go (`packages/store/src/venue-lock.ts`).
 *
 * Stale is `VENUE_HOLDER_STALE_MS`, shorter than the watchdog's `WATCHDOG_KILL_MS` on purpose; the
 * reason is at `WATCHDOG_KILL_MS` (`packages/store/src/venue-liveness.ts`).
 */
async function recordRefusal(
  deps: EntryDeps,
  attempt: { before: RecoveryState; after: RecoveryState },
  at: Date,
): Promise<void> {
  const holder = (deps.readVenueHolder ?? readVenueHolder)(deps.venueDir);
  if (holder !== null && isVenueHolderFresh(holder, at)) {
    deps.log("warn", "recovery.venue_held", { holderKind: holder.kind });
    await persistState(deps, (current) => withoutAttempt(current, attempt.before, attempt.after));
    return;
  }
  deps.log("warn", "recovery.venue_holder_stalled", {
    holderKind: holder?.kind ?? null,
    lockedAt: holder?.lockedAt ?? null,
    heartbeatAt: holder?.heartbeatAt ?? null,
  });
  await persistState(deps, (current) => withFailureCode(current, HOLDER_STALLED, at, holder?.kind));
}

/* v8 ignore start -- the real process wiring: `process.env`, a timer and `process.exit`. Every
   decision lives in `runEntry` above, which takes each of these as a dependency; this half is
   exercised by a container boot, not by a unit test — the shape `bin-recovery.ts` and
   `run-server.ts`'s `DEFAULT_DEPS` both use. */
function bootThisProcess(): Promise<void> {
  const env = { ...process.env };
  const stateDir = resolveConfigDir(env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
  setVenueHolderIdentity("server", env, stateDir);
  // `loadConfig`'s own expressions for `venueDir` and `migrationsRoot`, repeated rather than read
  // through `loadConfig`, because a broken config is what lands a box here.
  const venueDir = resolveConfigDir(env.WAITRON_VENUE_DIR, join(stateDir, "venue"));
  const migrationsRoot = isUnset(env.WAITRON_MIGRATIONS_DIR)
    ? DEFAULT_MIGRATIONS_ROOT
    : env.WAITRON_MIGRATIONS_DIR;
  const log = createLogger(
    (line) => void process.stdout.write(line),
    () => new Date(),
  );
  return runEntry({
    args: process.argv.slice(2),
    baseEnv: env,
    stateDir,
    venueDir,
    logDir: resolveLogDir(env, stateDir),
    migrationsRoot,
    runStagedRestore,
    reportFailure: (text) => void process.stdout.write(`${text}\n`),
    loadBoxEnv,
    readRecoveryState,
    writeRecoveryState,
    startServer,
    serveRecovery,
    installShutdownHandlers,
    // `unref` so the timer alone never holds the process open: the listener the server bound is
    // what keeps it alive, and a process that dies before the threshold has not stayed up.
    scheduleStayedUp: (ms, onStayedUp) => void setTimeout(onStayedUp, ms).unref(),
    log,
    exit: DEFAULT_EXIT,
  }).catch(async (error: unknown) => {
    // The code alone: for a failed attempt, `runEntry`'s catch has already reported the detail.
    log("error", "server.boot_failed", {
      errorCode:
        recordedStartFailureCode(error) ?? (await startFailureCode(error, [stateDir, venueDir])),
    });
    process.exit(1);
  });
}

/**
 * Run only when this file is the process's own entry point, never when it is imported.
 * `realpathSync` because a symlinked bin resolves to a different path than `import.meta.url`.
 */
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await bootThisProcess();
}
/* v8 ignore stop */
