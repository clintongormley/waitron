import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import pg from "pg";
import { AppError } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import {
  DEFAULT_MIGRATIONS_ROOT,
  DEFAULT_STATE_ROOT,
  startLandingListener,
  startServer,
  type LandingListenerConfig,
} from "./boot.js";
import { loadBoxEnv } from "./box-env.js";
import { parseBoxAddresses } from "./box-reach.js";
import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_LANDING_PORT,
  DEFAULT_HTTP_PORT,
  MAX_HTTP_PORT,
  resolveConfigDir,
} from "./config.js";
import { isUnset } from "./env-value.js";
import { ensureInstance, type InstanceUrls } from "./instance-bootstrap.js";
import { createLogger, type Logger } from "./logger.js";
import {
  FRESH,
  afterFailure,
  readRecoveryState,
  writeRecoveryState,
  type RecoveryState,
} from "./recovery-state.js";
import { recoveryApp } from "./recovery-surface.js";
import { installShutdownHandlers } from "./run-server.js";
import { buildServeOptions, type TlsFiles } from "./tls.js";
import { mintedBoxLeaf } from "./box-secrets.js";
import "./errors.js";

/** The one database a node owns, matching the URLs `ensureInstance` writes into `instance.env`. */
const DATABASE = "waitron";

/** The superuser URL compose derives from the box's `POSTGRES_PASSWORD`. It reaches `ensureInstance`
 *  and NOTHING else — never the server (see `runEntry`). */
const BOOTSTRAP_URL = "WAITRON_BOOTSTRAP_DATABASE_URL";

/** How long a boot must survive before its failure counter is cleared (spec §9.2). */
const STAYED_UP_MS = 120_000;

const WAIT_ATTEMPTS = 60;
const WAIT_DELAY_MS = 1000;

/** The recovery-state marker for an attempt whose outcome is not known YET — written before the
 * server starts, so a boot that HANGS (and therefore never produces a real code) still leaves the
 * page something true to say. Not an `AppError` code: nothing throws it. A boot that does throw
 * overwrites it with `codeOf`'s classification. */
const BOOT_INCOMPLETE = "server.boot_incomplete";

export interface WaitDeps {
  /** One connect-and-query round trip, or a rejection. */
  connect: (url: string) => Promise<void>;
  delay: (ms: number) => Promise<void>;
  log: Logger;
  attempts?: number;
  delayMs?: number;
}

/**
 * Poll until Postgres accepts a connection — the shape of `dev-setup.ts`'s own loop, bounded so a
 * cluster that is never coming back escalates through the failure counter instead of pinning the
 * container in a wait forever.
 *
 * The caught value is dropped rather than chained as a `cause`: a `pg` connection failure carries
 * the host and can carry the connection string, and the code thrown here is rendered on the
 * unauthenticated recovery page.
 */
export async function waitForPostgres(url: string, deps: WaitDeps): Promise<void> {
  const attempts = deps.attempts ?? WAIT_ATTEMPTS;
  // Unbounded `for`, bounded by the throw: a `attempt <= attempts` header would give the function a
  // fall-through exit that returns "connected" without ever connecting.
  for (let attempt = 1; ; attempt++) {
    try {
      await deps.connect(url);
      return;
    } catch {
      if (attempt >= attempts) {
        throw new AppError("provisioning.database_unreachable", { attempts });
      }
      if (attempt === 1) deps.log("info", "instance.waiting_for_postgres", { attempts });
      await deps.delay(deps.delayMs ?? WAIT_DELAY_MS);
    }
  }
}

/**
 * The box's own leaf for the recovery page, or `undefined` when it has never minted one — the same
 * `mintedBoxLeaf` fallback the setup branch and the trading branches use, so all three present the
 * one leaf an already-trusting phone accepts. Kept as a named re-export because spec §9.3's "recovery
 * falls back to plain HTTP" limit is a fact about THIS surface, and `serveRecovery` below reads it.
 */
export function recoveryTlsFiles(stateDir: string): TlsFiles | undefined {
  return mintedBoxLeaf(stateDir);
}

export interface RecoveryServeOptions {
  stateDir: string;
  port: number;
  log: Logger;
  /** The plain-HTTP trust/landing listener's config, when recovery should serve the trust page beside
   * the HTTPS page (built by `landingConfigFrom` in the recovery path). Omitted → no landing listener,
   * which is how the direct-bind tests keep to one socket. */
  landing?: LandingListenerConfig;
  /** Injected for tests; defaults to the real `startLandingListener`. */
  startLanding?: (
    config: LandingListenerConfig,
    log: Logger,
  ) => { close(): Promise<void> } | undefined;
}

/**
 * Bind the recovery page on the box's own HTTPS port, presented with the box's existing leaf so an
 * already-trusting phone reaches it at the same URL with no new trust step. Beside it, serve the same
 * plain-HTTP trust/landing page trading mode does (when `opts.landing` is given): a phone that does
 * NOT yet trust the box's self-signed leaf hits the browser's cert interstitial before any recovery JS
 * runs, so it needs the plain-HTTP page to fetch the CA and its trust steps.
 *
 * Resolves when the socket is actually bound (`serve`'s `listeningListener`, not source order —
 * `serve()` returns before the bind, as `boot.ts`'s `startListening` records), and rejects if the
 * bind fails: the caller lets that escape, so a port it cannot take exits non-zero and Docker
 * restarts into the same decision rather than leaving a silent, page-less container up.
 */
export function serveRecovery(
  app: Hono,
  opts: RecoveryServeOptions,
): Promise<ReturnType<typeof serve>> {
  return new Promise((resolve, reject) => {
    const tls = recoveryTlsFiles(opts.stateDir);
    const server = serve(buildServeOptions({ fetch: app.fetch, port: opts.port }, tls), (info) => {
      opts.log("warn", "recovery.listening", { port: info.port, tls: tls !== undefined });
      // Best-effort, exactly as in trading mode: `startLandingListener` swallows its own bind failure
      // and returns undefined when there is nothing to serve (no minted leaf, or the port disabled),
      // so a missing or unbindable landing page never takes the recovery page down. Started only after
      // the HTTPS bind succeeds so the two do not race for the same port.
      const startLanding = opts.startLanding ?? startLandingListener;
      const landing = opts.landing ? startLanding(opts.landing, opts.log) : undefined;
      if (landing !== undefined) {
        // The recovery server outlives everything until the process exits (production never closes it),
        // so this fires only on a deliberate teardown — a test, or a future shutdown path.
        server.on("close", () => void landing.close().catch(() => {}));
      }
      resolve(server);
    });
    server.on("error", (error: NodeJS.ErrnoException) => {
      reject(new AppError("server.listen_failed", { port: opts.port, code: error.code ?? "" }));
    });
  });
}

/**
 * The plain-HTTP trust/landing listener's config for the recovery path, built from throw-free env
 * reads (recovery never runs `loadConfig` — a broken config is what lands a box here). `tls` is always
 * undefined: recovery presents the box's OWN minted leaf (`recoveryTlsFiles`), never an operator cert,
 * so the trust page is warranted exactly when a minted leaf exists — the check `startLandingListener`
 * then makes.
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
  // `0` disables the listener (kept, unlike httpPort); an unset or out-of-range value takes the
  // default rather than throwing, mirroring `httpPortFrom`.
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
  /** The process environment, before the box's own env files are merged under it. */
  baseEnv: NodeJS.ProcessEnv;
  stateDir: string;
  waitForPostgres: (url: string) => Promise<void>;
  ensureInstance: (opts: {
    bootstrapUrl: string;
    database: string;
    stateDir: string;
    log: Logger;
    migrationsRoot: string | null;
  }) => Promise<InstanceUrls>;
  loadBoxEnv: (base: NodeJS.ProcessEnv, stateDir: string) => Promise<NodeJS.ProcessEnv>;
  readRecoveryState: (stateDir: string) => Promise<RecoveryState>;
  writeRecoveryState: (stateDir: string, state: RecoveryState) => Promise<void>;
  startServer: (
    env: NodeJS.ProcessEnv,
    base?: NodeJS.ProcessEnv,
  ) => Promise<{ close(): Promise<void> }>;
  serveRecovery: (app: Hono, opts: RecoveryServeOptions) => Promise<unknown>;
  installShutdownHandlers: (server: { close(): Promise<void> }) => void;
  /** Runs `onStayedUp` once the process has survived `ms` — see the counter rule in `runEntry`. */
  scheduleStayedUp: (ms: number, onStayedUp: () => void) => void;
  log: Logger;
  /** Where the recovery page reads its log tail from; defaults to `config.ts`'s own default. */
  logDir?: string;
  /**
   * Where the migration sets live. Typed `string`, never `string | null`, although
   * `ensureInstance` accepts null: null means "resolve from the bundle's own directory", which is
   * exactly the value that fails a real container's first boot with `migrations.set_missing`. The
   * default is the same expression `startServer` passes, so the entrypoint and the server it starts
   * can never migrate from two different folders.
   */
  migrationsRoot?: string;
  exit?: (code: number) => void;
}

/** The bootstrap URL, refused rather than passed to the driver when it is unusable.
 *
 * Both checks are needed. `new Client({ connectionString: "" })` resolves to localhost with every
 * default (`pg@8.22.0`, the receipt on `provisioning.admin_uri_missing`), so an `VAR=` line would
 * otherwise silently provision whatever answers on localhost:5432 — and one database per
 * environment is a fiscal invariant. A value `new URL` cannot parse reaches `withDatabase`
 * (`ensureInstance`) as a bare `TypeError` instead of a classified code, which the recovery page
 * can only render as "unknown". */
function bootstrapUrlFrom(env: NodeJS.ProcessEnv): string {
  const raw = env[BOOTSTRAP_URL];
  if (isUnset(raw)) throw new AppError("server.config_missing", { variable: BOOTSTRAP_URL });
  try {
    new URL(raw);
  } catch {
    throw new AppError("provisioning.admin_uri_not_a_url", { variable: BOOTSTRAP_URL });
  }
  return raw;
}

/**
 * `WAITRON_HTTP_PORT`, or `config.ts`'s own default — resolved here rather than through
 * `loadConfig`, because a box reaches recovery precisely when its configuration may be what is
 * broken and a config that throws would take the page down with it. The bounds are `config.ts`'s
 * too, imported not copied: an out-of-range value reaches `listen` as a raw `ERR_SOCKET_BAD_PORT`,
 * and a box whose `WAITRON_HTTP_PORT` is `999999` is exactly a box that fails `loadConfig` three
 * times and lands here. Zero is out of range for the same reason the rest are: to `listen` it means
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
 * Persist the escalation state, REPORTING a write failure rather than letting it become the
 * outcome. Used everywhere the write is not the point of the moment: on the failure path the boot's
 * own error is what an operator needs, in the stayed-up callback a floating rejection would kill a
 * HEALTHY server two minutes after it booted, and in the retry a failed reset just means the page
 * comes back after the restart. The one write that is NOT routed through here is the pre-boot
 * counter, which is allowed to throw: a state volume that cannot be written is a box that can never
 * escalate, and the server would fail on the same volume moments later anyway.
 */
async function persistState(deps: EntryDeps, next: RecoveryState): Promise<void> {
  try {
    await deps.writeRecoveryState(deps.stateDir, next);
  } catch (error) {
    deps.log("warn", "recovery.state_write_failed", { errorCode: codeOf(error) });
  }
}

/**
 * One container start: decide the level, bring the cluster into shape, hand the server its
 * environment, and start it — or serve the recovery page instead.
 *
 * THREE orderings carry the whole design, and each is invisible in production if it is wrong:
 *
 * 1. The level is read FIRST, before anything touches Postgres. A database-side failure is exactly
 *    what puts a box in recovery, so deciding after the wait and the bootstrap would make the page
 *    unreachable in most of the cases it exists for (spec §9.3).
 * 2. The failure counter is written BEFORE the boot's FIRST step, never only in a failure handler
 *    and never only around `startServer`: a boot that HANGS never throws, and a counter written
 *    later covers none of the steps most likely to fail. Measured on the built bundle when it sat
 *    after them: five failing boots (no bootstrap URL, then a dead database) each exited 1 and left
 *    the state volume EMPTY — a box with an unreachable Postgres restart-looped every ~60 s and
 *    could never reach the page that exists for exactly that case.
 * 3. It CLEARS only from the stayed-up callback — `startServer` resolved AND the process then
 *    survived `STAYED_UP_MS`. Clearing on "started" alone is a measurement where pass and fail look
 *    alike: a module throwing five seconds in would reset the counter on every attempt.
 *
 * `startServer` resolving is the signal rather than a healthy `/health` probe because `/health` is
 * 503 on a setup box by design, so a health-gated reset would drive every unprovisioned box into
 * recovery.
 */
export async function runEntry(deps: EntryDeps): Promise<void> {
  const state = await deps.readRecoveryState(deps.stateDir);
  const logDir = deps.logDir ?? join(deps.stateDir, "logs");
  const exit = deps.exit ?? DEFAULT_EXIT;

  if (state.level === "recovery") {
    // The page's log tail is the SERVER's rotating file (`<logDir>/waitron.log`). A box escalated
    // before the server ever started — an `ensureInstance` or `waitForPostgres` failure — therefore
    // shows its `lastErrorCode` above an empty tail, because the entrypoint's own log goes to stdout
    // (`docker logs`) and nothing writes that file until `startServer` gets far enough. Stated, not
    // fixed: a second sink in the entrypoint is more moving parts on the one path that must not
    // fail, and the code plus `docker logs` carry the same information.
    deps.log("warn", "recovery.serving", {
      failures: state.failures,
      lastErrorCode: state.lastErrorCode,
    });
    const httpPort = httpPortFrom(deps.baseEnv);
    await deps.serveRecovery(
      recoveryApp({
        state,
        logDir,
        // The level argument is not written: `readRecoveryState` DERIVES the level from the count,
        // so a zero count IS "normal" and a hand-written level could not pin a box either way. The
        // exit is the whole retry — Docker's restart policy performs the restart (spec §9.3).
        onRetry: async () => {
          await persistState(deps, FRESH);
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

  // The counter covers the WHOLE attempt, so it is written before the first step that can fail.
  // Consequence, accepted: an attempt CUT SHORT counts too — three power-cycles during the up-to-60 s
  // Postgres wait land a box on the page, where the retry button clears it. A counter that only
  // counted completed failures could not count the boot that hangs, which is the case it exists for.
  await deps.writeRecoveryState(deps.stateDir, afterFailure(state, BOOT_INCOMPLETE, new Date()));

  let server: { close(): Promise<void> };
  try {
    const bootstrapUrl = bootstrapUrlFrom(deps.baseEnv);
    await deps.waitForPostgres(bootstrapUrl);
    const urls = await deps.ensureInstance({
      bootstrapUrl,
      database: DATABASE,
      stateDir: deps.stateDir,
      log: deps.log,
      migrationsRoot: deps.migrationsRoot ?? DEFAULT_MIGRATIONS_ROOT,
    });

    // AFTER `ensureInstance`, which has just written `instance.env` — that file is where the merged
    // environment's `DATABASE_URL` comes from.
    const env = await deps.loadBoxEnv(deps.baseEnv, deps.stateDir);
    // The server never holds superuser credentials: its owner connection is the MIGRATOR, the role
    // that owns the tables (`boot.ts`'s setup branch documents why). This object is the server's
    // WHOLE configuration — `startServer` reads what it is handed, not `process.env` — and the
    // process's own copy is scrubbed separately by the wiring at the bottom of this file, because
    // `loadBoxEnv` returns a new object and deleting from it leaves `process.env` untouched.
    delete env[BOOTSTRAP_URL];
    env.WAITRON_ADMIN_DATABASE_URL = urls.migrationsDatabaseUrl;

    // The RAW base env goes alongside the merged `env`: boot re-reads the box-env files off disk on
    // every backup reload (so the wizard's `backup.env` takes effect without a restart) and needs the
    // unmerged base to tell a file-sourced value from an env-sourced one (spec §3.2 provenance).
    server = await deps.startServer(env, deps.baseEnv);
  } catch (error) {
    // Same count as the pre-boot write — one attempt is one failure, not two — now carrying the
    // real classification for the page. Rethrown so the process exits non-zero and Docker restarts.
    await persistState(deps, afterFailure(state, codeOf(error), new Date()));
    throw error;
  }

  deps.installShutdownHandlers(server);
  deps.scheduleStayedUp(STAYED_UP_MS, () => void persistState(deps, FRESH));
}

/* v8 ignore start -- the real process wiring: `process.env`, the `pg` driver, a timer and
   `process.exit`. Every decision lives in `runEntry` above, which takes each of these as a
   dependency; this half is exercised by a container boot, not by a unit test — the shape
   `bin-recovery.ts` and `run-server.ts`'s `DEFAULT_DEPS` both use. */
async function connectOnce(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("select 1");
  } finally {
    await client.end().catch(() => {});
  }
}

function bootThisProcess(): Promise<void> {
  // Snapshot, THEN scrub: the entrypoint is the only thing that may hold the superuser URL, and
  // nothing after it — no module of the server, no library reading `process.env` directly — has any
  // business finding it. `loadBoxEnv` returns a new object, so deleting the key there would leave
  // this process's own copy intact.
  const env = { ...process.env };
  delete process.env[BOOTSTRAP_URL];
  const stateDir = resolveConfigDir(env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
  const log = createLogger(
    (line) => void process.stdout.write(line),
    () => new Date(),
  );
  return runEntry({
    baseEnv: env,
    stateDir,
    logDir: isUnset(env.WAITRON_LOG_DIR) ? join(stateDir, "logs") : env.WAITRON_LOG_DIR,
    // `config.ts`'s own fallback, verbatim (it stores this one unresolved), so the entrypoint and
    // the server it starts can never migrate from two different folders.
    migrationsRoot: isUnset(env.WAITRON_MIGRATIONS_DIR)
      ? DEFAULT_MIGRATIONS_ROOT
      : env.WAITRON_MIGRATIONS_DIR,
    waitForPostgres: (url) =>
      waitForPostgres(url, {
        connect: connectOnce,
        delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        log,
      }),
    ensureInstance,
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
    // `codeOf`, never the caught value: a `pg` failure's message can embed the connection string,
    // and an unhandled rejection would print the whole stack.
    log("error", "server.boot_failed", { errorCode: codeOf(error) });
    process.exit(1);
  });
}

/**
 * Run ONLY when this file is the process's own entry point (`node /app/node-entry.js`), never when
 * it is imported — its own unit test imports it for `runEntry`, and an unguarded call here would
 * open a `pg` connection and start a server from inside the test runner. `realpathSync` because a
 * symlinked bin resolves to a different path than `import.meta.url`. Both directions are measured:
 * the built `dist/node-entry.js` really does boot (it reaches `server.config_missing` with no
 * bootstrap URL set), and `node-entry.test.ts` imports this module without one.
 */
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await bootThisProcess();
}
/* v8 ignore stop */
