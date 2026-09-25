import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
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
import {
  BOX_HOSTNAME,
  DEFAULT_MIGRATIONS_ROOT,
  DEFAULT_STATE_ROOT,
  startLandingListener,
  startServer,
  type LandingListenerConfig,
} from "./boot.js";
import { loadBoxEnv } from "./box-env.js";
import { listBoxIpv4, parseBoxAddresses } from "./box-reach.js";
import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_LANDING_PORT,
  DEFAULT_HTTP_PORT,
  MAX_HTTP_PORT,
  resolveConfigDir,
} from "./config.js";
import { isUnset } from "./env-value.js";
import { createLogger, type Logger } from "./logger.js";
import { withRecoveryLock } from "./recovery-lock.js";
import {
  afterFailure,
  cleared,
  readRecoveryState,
  updateRecoveryState,
  withFailureCode,
  withoutAttempt,
  writeRecoveryState,
  type RecoveryState,
} from "./recovery-state.js";
import { BOOT_INCOMPLETE, HOLDER_STALLED, recoveryApp } from "./recovery-surface.js";
import { installShutdownHandlers } from "./run-server.js";
import { buildServeOptions, type TlsFiles } from "./tls.js";
import { mintedBoxLeaf } from "./box-secrets.js";
import { mountDiscovery } from "./discovery-api.js";
import { runStagedRestore, type StagedRestoreDeps } from "./restore-request.js";
import { clearReplacedDatabases } from "./restore.js";
import { loadCloudOrigin } from "./cloud-client.js";
import { createCloudRecoveryClient } from "./cloud-recovery.js";
import { classifyBootFailure } from "./boot-failure.js";
import { redactSecrets } from "./redact-secrets.js";
import "./errors.js";

/** How long a boot must survive before its failure counter is cleared (spec §9.2). */
const STAYED_UP_MS = 120_000;

/**
 * The box's own minted leaf for the recovery page, or `undefined` when it has never minted one, in
 * which case the page is served over plain HTTP.
 */
export function recoveryTlsFiles(stateDir: string): TlsFiles | undefined {
  return mintedBoxLeaf(stateDir);
}

export interface RecoveryServeOptions {
  stateDir: string;
  port: number;
  log: Logger;
  /** The plain-HTTP trust/landing listener's config. Omitted → no landing listener. */
  landing?: LandingListenerConfig;
  /** Defaults to the real `startLandingListener`. */
  startLanding?: (
    config: LandingListenerConfig,
    log: Logger,
  ) => { close(): Promise<void> } | undefined;
}

/**
 * Bind the recovery page on the box's own HTTPS port with the box's existing leaf, so an
 * already-trusting phone reaches it at the same URL. Beside it, when `opts.landing` is given and
 * `startLandingListener` binds one, the plain-HTTP trust/landing page: a phone that does not yet
 * trust the leaf hits the certificate interstitial before any recovery page loads.
 *
 * Resolves once the socket is bound and rejects if the bind fails; the caller lets that escape, so
 * the process exits non-zero rather than leaving a page-less container up.
 */
export function serveRecovery(
  app: Hono,
  opts: RecoveryServeOptions,
): Promise<ReturnType<typeof serve>> {
  return new Promise((resolve, reject) => {
    const tls = recoveryTlsFiles(opts.stateDir);
    const surface = new Hono();
    mountDiscovery(
      surface,
      {
        stateDir: opts.stateDir,
        hostname: BOX_HOSTNAME,
        port: opts.port,
        secure: tls !== undefined,
        listIpv4: () => opts.landing?.boxAddresses ?? listBoxIpv4(),
        discoveryEnabled: false,
      },
      opts.log,
    );
    surface.route("/", app);
    const server = serve(
      buildServeOptions({ fetch: surface.fetch, port: opts.port }, tls),
      (info) => {
        opts.log("warn", "recovery.listening", { port: info.port, tls: tls !== undefined });
        // Best-effort: `startLandingListener` logs its own bind failure rather than throwing, so an
        // unbindable landing page never takes the recovery page down.
        const startLanding = opts.startLanding ?? startLandingListener;
        const landing = opts.landing ? startLanding(opts.landing, opts.log) : undefined;
        if (landing !== undefined) {
          server.on("close", () => void landing.close().catch(() => {}));
        }
        resolve(server);
      },
    );
    server.on("error", (error: NodeJS.ErrnoException) => {
      reject(new AppError("server.listen_failed", { port: opts.port, code: error.code ?? "" }));
    });
  });
}

/**
 * The landing listener's config for the recovery path, built from env reads that never throw:
 * recovery never runs `loadConfig`, because a broken config is what lands a box here. `tls` is
 * always undefined because recovery presents only the box's own minted leaf, never an operator
 * certificate.
 */
function landingConfigFrom(
  env: NodeJS.ProcessEnv,
  stateDir: string,
  httpPort: number,
): LandingListenerConfig {
  let boxAddresses: string[] | undefined;
  try {
    boxAddresses = parseBoxAddresses(env.WAITRON_BOX_ADDRESSES);
  } catch {
    // A malformed WAITRON_BOX_ADDRESSES must not crash recovery; fall back to enumerating interfaces.
    boxAddresses = undefined;
  }
  const raw = env.WAITRON_HTTP_LANDING_PORT;
  // `0` is kept, unlike in `httpPortFrom`: it disables the listener.
  const landingPort = isUnset(raw) ? DEFAULT_HTTP_LANDING_PORT : Number.parseInt(raw, 10);
  return {
    landingPort:
      Number.isInteger(landingPort) && landingPort >= 0 && landingPort <= MAX_HTTP_PORT
        ? landingPort
        : DEFAULT_HTTP_LANDING_PORT,
    httpHost: isUnset(env.WAITRON_HTTP_HOST) ? DEFAULT_HTTP_HOST : env.WAITRON_HTTP_HOST,
    stateDir,
    httpPort,
    boxAddresses,
    tls: undefined,
  };
}

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
  /** Defaults to the real `assertNotAhead` below, never a no-op: it is a guard, and a no-op default
   *  is lost silently by any caller that forgets the dependency. */
  assertNotAhead?: (venueDir: string, migrationsRoot: string) => Promise<void>;
  /** Defaults to the real `clearReplacedDatabases` (restore.ts), never a no-op, for the same reason. */
  clearReplacedDatabases?: (venueDir: string, log: Logger) => Promise<void>;
  /** Holds the venue folder from the clearing until the server starts. Default `lockVenueDatabase`. */
  lockVenue?: (venueDir: string) => Promise<VenueLock>;
  /**
   * The installer's channel — the container's stdout (`docker logs`), never the `waitron.log` the
   * recovery page tails. It is the one place the caught error's own words may appear, and only
   * after `redactSecrets`. Its no-op default, unlike `assertNotAhead`'s, is safe because it is
   * diagnostic output, not a guard: omitting it changes no outcome.
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
  /** Where the recovery page reads its log tail from. */
  logDir?: string;
  /**
   * Where the migration sets live. Never `null`: null means "resolve from the bundle's own
   * directory", which fails a real container's first boot with `migrations.set_missing`. `runEntry`
   * hands this one value to both the staged restore and the ahead check.
   */
  migrationsRoot?: string;
  exit?: (code: number) => void;
}

/**
 * `WAITRON_HTTP_PORT`, or the default — resolved here rather than through `loadConfig`, whose throw
 * on a broken config would take the page down with it. Zero is refused because to `listen` it means
 * "any free port", which puts the page somewhere the operator cannot find it.
 */
function httpPortFrom(env: NodeJS.ProcessEnv): number {
  const port = Number.parseInt(env.WAITRON_HTTP_PORT ?? "", 10);
  return Number.isInteger(port) && port > 0 && port <= MAX_HTTP_PORT ? port : DEFAULT_HTTP_PORT;
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
 * floating rejection would kill a healthy server. The pre-boot counter is the one write not routed
 * through here, and is allowed to throw: a box whose count cannot be written can never escalate.
 */
async function persistState(
  deps: EntryDeps,
  change: (current: RecoveryState) => RecoveryState,
): Promise<void> {
  try {
    await changeState(deps, change);
  } catch (error) {
    deps.log("warn", "recovery.state_write_failed", { errorCode: codeOf(error) });
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
 * What the installer's channel gets for a failed boot: the outer error's name, message and stack,
 * then every wrapped `cause` by name and message, and an `AppError`'s params at whichever level
 * carries them — all through `redactSecrets`, because this is the one place the caught error's own
 * words may appear, and it is `docker logs`, never the page.
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
 * Four orderings carry the design, and each is invisible in production if it is wrong:
 *
 * 1. The level is read first, before anything opens the venue database: a database-side failure is
 *    exactly what puts a box in recovery.
 * 2. The failure counter is written before the boot's first step, never only in a failure handler:
 *    a boot that hangs never throws, and would restart-loop without ever reaching the page.
 * 3. It clears only from the stayed-up callback — `startServer` resolved and the process then
 *    survived `STAYED_UP_MS`. Clearing on "started" alone would let a module throwing seconds in
 *    reset the counter on every attempt.
 * 4. The ahead check runs after `runStagedRestore`, which replaces the venue files, and before
 *    `startServer`, which migrates and then queries the schema. It judges a database nothing has
 *    migrated yet, which the one-directional comparison in `assertNotAhead` makes safe.
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

  // Outside the lock: it decides only whether this start boots or serves the page. Every change
  // below re-reads under the lock, so a write made since is kept rather than overwritten.
  const state = await deps.readRecoveryState(deps.stateDir);
  const logDir = deps.logDir ?? join(deps.stateDir, "logs");
  const exit = deps.exit ?? DEFAULT_EXIT;
  const now = deps.now ?? (() => new Date());

  if (state.level === "recovery") {
    // A box escalated before the server ever started shows its `lastErrorCode` above an empty log
    // tail: the entrypoint logs to stdout (`docker logs`), and nothing writes the server's log file
    // until `startServer` gets far enough. Accepted rather than adding a second sink on the one
    // path that must not fail.
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
      }),
      {
        stateDir: deps.stateDir,
        port: httpPort,
        log: deps.log,
        landing: landingConfigFrom(deps.baseEnv, deps.stateDir, httpPort),
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

  let server: { close(): Promise<void> };
  try {
    const migrationsRoot = deps.migrationsRoot ?? DEFAULT_MIGRATIONS_ROOT;

    const recoveryOrigin = loadCloudOrigin(deps.baseEnv);
    await (deps.runStagedRestore ?? runStagedRestore)({
      stateDir: deps.stateDir,
      venueDir: deps.venueDir,
      migrationsRoot,
      log: deps.log,
      onManagedCloudRestored: async (binding) => {
        if (recoveryOrigin)
          await createCloudRecoveryClient({
            stateDir: deps.stateDir,
            origin: recoveryOrigin,
            environment: "preproduction",
          }).markRestored(binding);
      },
    });

    // Held from the clearing until the server's own store holds the folder, so no placement runs
    // in between: one that failed with its old database set aside would leave no `venue.db`, the
    // ahead check's open would create an empty one, and the next start would clear the only copy.
    const hold = await (deps.lockVenue ?? lockVenueDatabase)(deps.venueDir);
    try {
      // Before the ahead check, whose open creates a missing `venue.db`.
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
    // The installer's channel first, so the real reason survives even if the state write fails.
    (deps.reportFailure ?? (() => {}))(failureDetail(error));
    const code = classifyBootFailure(error);
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
  deps.scheduleStayedUp(STAYED_UP_MS, () => void persistState(deps, cleared));
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
  }).catch((error: unknown) => {
    // `classifyBootFailure`, never the caught value: a driver failure's message can embed a path or
    // a credential. The scrubbed text has already gone to stdout from `runEntry`'s catch.
    log("error", "server.boot_failed", { errorCode: classifyBootFailure(error) });
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
